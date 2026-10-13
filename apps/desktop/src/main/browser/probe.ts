import type { BrowserProbeMarkup, BrowserProbeStrings, BrowserProbeTarget } from "../../shared/browserTypes";

/**
 * Message prefixes the injected probe prints through `console.log`. The tab's
 * `console-message` handler claims these before they reach the console feed.
 */
export const PROBE_MESSAGE_PREFIXES = [
  "__AR_INSPECT_RESULT__",
  "__AR_MARKUP_RESULT__",
  "__AR_INSPECT_CANCELLED__"
] as const;

/**
 * Name the injected script gives its own stack frames (`//# sourceURL=` at the
 * end of the payload). Devtools logs whose stack mentions it are the probe's own
 * bugs, not the previewed page's.
 */
export const PROBE_SOURCE_URL = "__ar_browser_probe__.js";

export type BrowserProbeMessage =
  | { kind: "inspect"; target: BrowserProbeTarget }
  | { kind: "markup"; markup: BrowserProbeMarkup }
  | { kind: "cancelled" };

export function isProbeMessage(text: string): boolean {
  return PROBE_MESSAGE_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/** `null` for anything that is not a probe payload (or does not parse as JSON). */
export function parseProbeMessage(text: string): BrowserProbeMessage | null {
  const prefix = PROBE_MESSAGE_PREFIXES.find((candidate) => text.startsWith(candidate));
  if (!prefix) return null;
  if (prefix === "__AR_INSPECT_CANCELLED__") return { kind: "cancelled" };
  try {
    const payload = JSON.parse(text.slice(prefix.length));
    if (prefix === "__AR_INSPECT_RESULT__") {
      return { kind: "inspect", target: payload as BrowserProbeTarget };
    }
    return { kind: "markup", markup: payload as BrowserProbeMarkup };
  } catch (error) {
    console.warn("[probe] bad payload", error);
    return null;
  }
}

/**
 * Injected script for the Built-in BrowserView.
 * Provides:
 * 1. 🎯 Universal Multi-Framework Inspect Tool (Vue 3 / Vue 2 / React Fiber / Native DOM).
 * 2. ✏️ Markup / Drawing annotation tool (overlay canvas to draw boxes and text notes).
 * 3. 🐞 Runtime error & Vite overlay monitor.
 */

export function buildBrowserProbeScript(strings: BrowserProbeStrings): string {
  return `
(function() {
  const PROBE_STRINGS = ${JSON.stringify(strings)};
  if (window.__AR_BROWSER_PROBE_INITIALIZED__) return;
  window.__AR_BROWSER_PROBE_INITIALIZED__ = true;

  console.log('[AgentResumeProbe] Universal Inspector Injected');

  let currentMode = 'off'; // 'off' | 'inspect' | 'markup'
  let highlightBox = null;
  let currentHoverEl = null;

  // --- Framework & Source Location Resolution ---

  // 组件库内部包装（ElOnlyChild / Wave / BaseTransition …）很多没有指向用户源码的
  // 元数据。所以不能停在"第一个有名字的组件"，要一路向上找到**第一个带可用源码位置**的，
  // 并且优先用户自己的文件（node_modules 里的路径对用户没有意义）。
  function isUserFile(f) { return !!f && f.indexOf('node_modules') === -1; }

  // 编译期注入的位置串，格式 "src/views/order/List.vue:42:5"（file:line:col）
  function parseLoc(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const parts = raw.split(':');
    if (!parts[0]) return null;
    const line = parseInt(parts[1], 10);
    return { file: parts[0], line: isNaN(line) ? null : line };
  }

  /**
   * 元素自身的精确源码位置。
   *
   * 属性可能是真的 DOM 属性（code-inspector 等），也可能被
   * vite-plugin-vue-inspector 从 props 里**摘掉**后转存到
   * vnode.props.__v_inspector（不可枚举，DOM 上看不见）——后者是它的默认行为，
   * 所以只查 DOM 属性是永远拿不到 Vue 行号的。
   */
  function readOwnLoc(el) {
    const fromAttr = parseLoc(
      el.getAttribute('data-v-inspector') ||
      el.getAttribute('data-loc') ||
      el.getAttribute('data-source') ||
      el.getAttribute('data-inspector-loc')
    );
    if (fromAttr) return fromAttr;
    const props = el.__vnode && el.__vnode.props;
    return props ? parseLoc(props.__v_inspector) : null;
  }

  // --- React 行号校正 ---
  //
  // @vitejs/plugin-react 会先给模块套一段 refresh wrapper，**之后**才轮到 esbuild 做 JSX
  // 转换；esbuild 写进 __source.lineNumber 的是「wrapper + 原文」坐标系的行号，于是 React
  // 的行号恒定多出 wrapper 的行数（本项目实测 +19）。
  //
  // 这个偏移**不能写死**：wrapper 随插件版本变，写死会在升级后静默偏掉。
  // 改为拿模块自己的 sourcemap 现算 —— 转换后模块里每个 __source 字面量都带着（偏移过的）
  // 行号，把它的生成行回映射到原始文件，差值就是该文件里恒定的偏移。
  const reactLineOffset = new Map(); // 绝对路径 -> 偏移 | false（算不出来）
  const reactOffsetJobs = new Map();

  const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  // 只要「某生成行第一个映射段指向的原始行」，所以不需要完整的 sourcemap consumer。
  function originalLineOfGenerated(mappings, targetLine) {
    let srcLine = 0, srcCol = 0, srcIdx = 0;
    const lines = mappings.split(';');
    for (let gl = 1; gl <= targetLine && gl <= lines.length; gl++) {
      const segs = lines[gl - 1].split(',');
      let genCol = 0;
      let hit = null;
      for (let si = 0; si < segs.length; si++) {
        const seg = segs[si];
        if (!seg) continue;
        const vals = [];
        let shift = 0, val = 0;
        for (let i = 0; i < seg.length; i++) {
          const d = B64_CHARS.indexOf(seg[i]);
          if (d < 0) continue;
          val += (d & 31) << shift;
          if (d & 32) { shift += 5; }
          // 符号位是最低位，量值就是 val >>> 1（别写成 ^ -(bit) 那套，那是另一种编码）
          else { vals.push(val & 1 ? -(val >>> 1) : (val >>> 1)); val = 0; shift = 0; }
        }
        genCol += vals[0] || 0;
        // 字段 1..3 是 source / line / column 的增量，必须一路累积才不失步
        if (vals.length >= 4) {
          srcIdx += vals[1]; srcLine += vals[2]; srcCol += vals[3];
          if (hit === null && genCol === 0) hit = srcLine;
        }
      }
      if (gl === targetLine) return hit;
    }
    return null;
  }

  function calibrateReactLineOffset(file) {
    if (reactLineOffset.has(file)) return Promise.resolve(reactLineOffset.get(file));
    if (reactOffsetJobs.has(file)) return reactOffsetJobs.get(file);

    const job = (async () => {
      try {
        // Vite dev 用 /@fs/ 暴露原始文件，取到的就是浏览器实际执行的那份转换产物
        const res = await fetch('/@fs' + encodeURI(file));
        if (!res.ok) return false;
        const text = await res.text();

        const m = text.match(/sourceMappingURL=data:application\\/json[^,\\n]*;base64,([A-Za-z0-9+/=]+)/);
        if (!m) return false;
        const bin = atob(m[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const map = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        if (!map || typeof map.mappings !== 'string') return false;

        const re = /lineNumber:\\s*(\\d+),\\s*\\n\\s*columnNumber:\\s*\\d+/g;
        const seen = [];
        let mm;
        while ((mm = re.exec(text)) !== null && seen.length < 6) {
          const genLine = text.slice(0, mm.index).split('\\n').length;
          const origLine = originalLineOfGenerated(map.mappings, genLine);
          if (origLine !== null) seen.push(parseInt(mm[1], 10) - (origLine + 1));
        }
        if (!seen.length) return false;
        // 同一文件里偏移必须处处一致；不一致说明推导有问题 —— 宁可不改，也不报一个错行号
        for (let i = 1; i < seen.length; i++) if (seen[i] !== seen[0]) return false;
        return seen[0];
      } catch (err) {
        return false;
      }
    })();

    reactOffsetJobs.set(file, job);
    job.then(function (v) {
      reactLineOffset.set(file, v);
      reactOffsetJobs.delete(file);
    });
    return job;
  }

  // 徽标用：算出偏移前先不显示行号，免得闪一个错的
  function correctedReactLine(meta) {
    if (meta.framework !== 'react' || !meta.sourceFile || meta.sourceLine == null) return meta.sourceLine;
    const offset = reactLineOffset.get(meta.sourceFile);
    if (offset === undefined) return null;
    if (offset === false) return meta.sourceLine; // 算不出来就保持原样，不引入退化
    const fixed = meta.sourceLine - offset;
    return fixed >= 1 ? fixed : meta.sourceLine;
  }

  /**
   * Element Plus 表格的列（表头 <th> / 单元格 <td>）。
   *
   * <el-table-column> 是"不渲染任何 DOM"的组件：表头由 ElTableHeader 渲染、单元格由
   * ElTableBody 渲染，所以从 <th>/<td> 沿组件链上溯只会停在 <el-table> 那一行 ——
   * 「用户指的这一格属于哪一列」在链上根本没有信息（实测：表头一律报 <el-table> 的行）。
   * 但列 vnode 是 <el-table> 默认插槽的子节点，位置就挂在它自己的 __v_inspector 上，
   * 按列序（表头另可先按 label 文本匹配）对回去即可。
   *
   * 只在别处都拿不到用户文件位置时才用；对不上就返回 null，保持原行为。
   */
  function locateTableColumn(el) {
    try {
      const tag = el.tagName;
      if (tag !== 'TH' && tag !== 'TD') return null;
      if (!el.classList || !el.classList.contains('el-table__cell')) return null;
      const tableEl = el.closest ? el.closest('.el-table') : null;
      if (!tableEl) return null;

      // 列序：表头取同行 th 里的序号，单元格取 cellIndex（两者与列序一致，已实测）
      let index = -1;
      if (tag === 'TH') {
        const sibs = [];
        const kids = el.parentNode ? el.parentNode.children : [];
        for (let i = 0; i < kids.length; i++) if (kids[i].tagName === 'TH') sibs.push(kids[i]);
        index = sibs.indexOf(el);
      } else {
        index = el.cellIndex;
      }
      if (index < 0) return null;

      let inst = tableEl.__vueParentComponent;
      let g = 0;
      while (inst && g++ < 30) {
        const n = inst.type && (inst.type.name || inst.type.__name);
        if (n === 'ElTable') break;
        inst = inst.parent || null;
      }
      if (!inst || !inst.type) return null;

      let cols = null;
      if (inst.slots && typeof inst.slots.default === 'function') {
        try { cols = inst.slots.default(); } catch (e) { cols = null; }
      }
      if (!Array.isArray(cols) && inst.vnode && Array.isArray(inst.vnode.children)) cols = inst.vnode.children;
      if (!Array.isArray(cols)) return null;

      // v-for 的列被包在一个 Fragment 里，v-if 掉的列是注释 vnode —— 摊平/剔除掉，
      // 否则列序会和真实渲染出来的 th/td 错位。
      const flat = [];
      const push = (arr) => {
        for (let a = 0; a < arr.length; a++) {
          const v = arr[a];
          if (!v) continue;
          if (typeof v.type === 'symbol') { if (Array.isArray(v.children)) push(v.children); continue; }
          const t = typeof v.type;
          if (t !== 'object' && t !== 'function') continue;
          flat.push(v);
        }
      };
      push(cols);
      if (!flat.length) return null;

      let pick = null;
      if (tag === 'TH') {
        // 表头有文本：优先按 label 精确匹配（对 gutter / 隐藏列造成的列序漂移不敏感），
        // 但同名 label 多于一个时不可信，退回列序。
        const text = (el.textContent || '').trim();
        if (text) {
          const hits = flat.filter((v) => v.props && typeof v.props.label === 'string' && v.props.label.trim() === text);
          if (hits.length === 1) pick = hits[0];
        }
      }
      if (!pick && index < flat.length) pick = flat[index];
      if (!pick || !pick.props) return null;

      const loc = parseLoc(pick.props.__v_inspector);
      if (!loc || !isUserFile(loc.file)) return null;
      return loc;
    } catch (err) {
      return null;
    }
  }

  function resolveComponentMetadata(el) {
    let framework = 'native-dom';
    let componentName = '';
    let sourceFile = '';
    let sourceLine = null;
    let propsSnippet = '';
    // 位置来源通道：compiler=Vue 编译期注入，fiber=React Fiber+sourcemap，
    // text=无框架元数据时的文本推断，none=连文本都匹配不上。
    // 任何一条编译期/框架级通道命中即精确，文本兜底一律标 text，
    // 让消费方（UI 徽标、给模型的指令）能区分精确行号与推断行号。
    let locateMode = 'none';

    // 1. 元素自身的编译期位置。这是最精确的答案：用户指的是**这个标签**，
    //    所以它优先于「往上找到的第一个组件」。
    //    但如果它落在 node_modules 里（组件库自带的 .vue 也会被插件注入），
    //    对用户就没意义 —— 那种情况留给组件链去找用户自己的文件，它只做兜底。
    const ownLoc = readOwnLoc(el);
    const ownLocUsable = ownLoc && isUserFile(ownLoc.file);
    if (ownLocUsable) {
      sourceFile = ownLoc.file;
      if (ownLoc.line != null) sourceLine = ownLoc.line;
      locateMode = 'compiler';
    }

    // 1b. Element Plus 表格的列（表头 / 单元格）。列组件不渲染 DOM，组件链上只有
    //     <el-table> 自己，所以必须在走链之前单独对回去 —— 否则表头一律报成表格那一行。
    if (!sourceFile) {
      const colLoc = locateTableColumn(el);
      if (colLoc) {
        sourceFile = colLoc.file;
        if (colLoc.line != null) sourceLine = colLoc.line;
        componentName = 'ElTableColumn';
        locateMode = 'compiler';
      }
    }

    // 2. Vue 3 Inspection (via __vnode / __vueParentComponent)
    if (el.__vnode) {
      framework = 'vue3';
      let firstName = '';
      let anyFile = '';
      let anyName = '';

      // 2a. vnode 链（部分构建不填充 vnode.parent，能走就走）
      let vnode = (!sourceFile || !componentName) ? el.__vnode : null;
      let vguard = 0;
      while (vnode && vguard++ < 60) {
        const comp = vnode.type;
        if (comp && typeof comp === 'object') {
          // 顺序是 name → __name：SFC 编译产物只有 __name（用户组件靠它），
          // 而组件库两个都有，__name 是小写的标签名（'button' / 'select'），
          // 拿它当组件名没有意义。
          const name = comp.name || comp.__name || comp.displayName;
          if (name && name !== 'Anonymous' && !firstName) firstName = name;
          if (comp.__file) {
            if (!anyFile) { anyFile = comp.__file; anyName = name || firstName; }
            if (isUserFile(comp.__file)) {
              componentName = name || firstName;
              if (!sourceFile) sourceFile = comp.__file;
              break;
            }
          }
        }
        vnode = vnode.parent || null;
      }

      // 2b. 组件实例链 —— 实测这条链才是一路可达用户组件的（vnode.parent 常常是空的）
      if ((!sourceFile || !componentName) && el.__vueParentComponent) {
        let inst = el.__vueParentComponent;
        let iguard = 0;
        while (inst && iguard++ < 60) {
          const t = inst.type || {};
          const name = t.name || t.__name || t.displayName;
          if (name && name !== 'Anonymous' && !firstName) firstName = name;
          // 组件标签（<el-button> 之类）自己渲染出来的 DOM 上没有本文件的行号——
          // 位置挂在**使用处那个 vnode** 上，也就是实例的 inst.vnode。
          // 只在组件来自依赖（自己没有用户侧 __file）时才用它：用户自己的组件
          // 有能力通过元素自身的 ownLoc 报出精确位置，不该被"使用处"顶掉。
          const useLoc = inst.vnode && inst.vnode.props ? parseLoc(inst.vnode.props.__v_inspector) : null;
          if (!(t.__file && isUserFile(t.__file)) && useLoc && isUserFile(useLoc.file)) {
            componentName = name || firstName;
            if (!sourceFile) sourceFile = useLoc.file;
            if (sourceLine == null) sourceLine = useLoc.line;
            break;
          }
          if (t.__file) {
            if (!anyFile) { anyFile = t.__file; anyName = name || firstName; }
            if (isUserFile(t.__file)) {
              componentName = name || firstName;
              if (!sourceFile) sourceFile = t.__file;
              break;
            }
          }
          inst = inst.parent || null;
        }
      }

      if (!sourceFile && anyFile) { sourceFile = anyFile; componentName = anyName; locateMode = 'compiler'; }
      if (!componentName) componentName = firstName;
    }

    // 3. React Inspection (via __reactFiber$...)
    if (!componentName) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey) {
        framework = 'react';
        let fiber = el[fiberKey];
        let firstName = '';
        let anyFile = '';
        let anyName = '';
        let anyLine = null;
        let guard = 0;
        while (fiber && guard++ < 60) {
          const t = fiber.type;
          // 宿主元素（type 是字符串）的 _debugSource 指向**定义处**；
          // 组件帧的 _debugSource 指向该组件被**使用**的位置，是更弱的信号。
          const isHost = typeof t === 'string';
          const name = (!isHost && t) ? (typeof t === 'function' ? (t.displayName || t.name)
                       : typeof t === 'object' ? (t.displayName || (t.render && t.render.name)) : null) : null;
          if (name && name !== 'Fragment' && name.indexOf('_') !== 0 && !firstName) firstName = name;
          if (fiber._debugSource && fiber._debugSource.fileName) {
            const f = fiber._debugSource.fileName;
            if (!anyFile) { anyFile = f; anyName = name || firstName; anyLine = fiber._debugSource.lineNumber || null; }
            if (isUserFile(f)) {
              componentName = name || firstName;
              if (!sourceFile) sourceFile = f;
              if (sourceLine == null) sourceLine = fiber._debugSource.lineNumber || null;
              break;
            }
          }
          fiber = fiber.return;
        }
        if (!sourceFile && anyFile) { sourceFile = anyFile; sourceLine = anyLine; componentName = anyName; }
        if (!componentName) componentName = firstName;
        // Fiber 链拿到位置即 fiber 通道（行号另由 sourcemap 校正）
        if (sourceFile) locateMode = 'fiber';
      }
    }

    // 3b. JSX 宿主元素上的 __source（@vitejs/plugin-react / babel
    //     automatic 运行时注入：fileName + lineNumber + columnNumber）。
    //    Fiber 链上没找到用户文件时用它兜底 —— 开发模式下每个
    //     JSX 元素都带着，比 Fiber _debugSource 更直接。
    if (!sourceFile && el.__source && el.__source.fileName) {
      const f = el.__source.fileName;
      if (isUserFile(f)) {
        sourceFile = f;
        sourceLine = el.__source.lineNumber ?? null;
        locateMode = 'fiber';
      }
    }

    // 4. Vue 2 Inspection (via __vue__)
    if (!componentName && (el.__vue__ || (el.parentElement && el.parentElement.__vue__))) {
      framework = 'vue2';
      let vueInst = el.__vue__ || el.parentElement.__vue__;
      let firstName = '';
      let anyFile = '';
      let anyName = '';
      let guard = 0;
      while (vueInst && guard++ < 60) {
        const opts = vueInst.$options || {};
        const name = opts._componentTag || opts.name || '';
        if (name && !firstName) firstName = name;
        if (opts.__file) {
          if (!anyFile) { anyFile = opts.__file; anyName = name || firstName; }
          if (isUserFile(opts.__file)) { componentName = name || firstName; if (!sourceFile) sourceFile = opts.__file; break; }
        }
        vueInst = vueInst.$parent;
      }
      if (!sourceFile && anyFile) { sourceFile = anyFile; componentName = anyName; locateMode = 'compiler'; }
      if (!componentName) componentName = firstName;
    }

    // 兜底：只有 node_modules 里的位置可用时也比什么都没有强（至少给出行号）。
    if (!sourceFile && ownLoc) {
      sourceFile = ownLoc.file;
      if (ownLoc.line != null) sourceLine = ownLoc.line;
      locateMode = 'compiler';
    }

    // Fallback: derive component name from tag or classes
    const tagName = el.tagName.toLowerCase();
    if (!componentName) {
      if (tagName.includes('-')) {
        componentName = tagName;
      } else {
        const cls = typeof el.className === 'string' ? el.className : '';
        const match = cls.match(/\\b(el-[a-z0-9-]+|ant-[a-z0-9-]+)\\b/);
        if (match) {
          componentName = match[1];
        }
      }
    }

    // 无框架元数据但有文本的，留给消费方做文本推断：这里只把
    // 通道标成 text（sourceFile 由调用方按文本匹配填），
    // 若当前页面在 /workspaces/<id>/<relPath> 或 /projects/<id>/<relPath> 下，
    // 直接提取页面自身的相对文件路径作为 sourceFile，让多页静态 HTML 也能精确定位到对应文件。
    if (!sourceFile) {
      const m = /^\\/(?:workspaces|projects)\\/[^/]+\\/(.+)$/.exec(window.location.pathname || '');
      if (m && m[1]) {
        sourceFile = decodeURIComponent(m[1]);
      }
      locateMode = (el.innerText || el.textContent || '').trim() ? 'text' : 'none';
    }

    return {
      framework,
      componentName: componentName || tagName,
      sourceFile,
      sourceLine,
      propsSnippet,
      locateMode
    };
  }

  // 1. Inspect DOM Elements (🎯 圈选)
  function initHighlightBox() {
    if (highlightBox) return;
    highlightBox = document.createElement('div');
    highlightBox.id = '__ar_highlight_box__';
    highlightBox.style.position = 'fixed';
    highlightBox.style.pointerEvents = 'none';
    highlightBox.style.border = '2px solid #0284c7';
    highlightBox.style.backgroundColor = 'rgba(2, 132, 199, 0.18)';
    highlightBox.style.zIndex = '2147483646';
    highlightBox.style.transition = 'all 0.05s ease';
    highlightBox.style.display = 'none';
    highlightBox.style.borderRadius = '3px';

    const badge = document.createElement('div');
    badge.id = '__ar_badge__';
    badge.style.position = 'absolute';
    badge.style.top = '-24px';
    badge.style.left = '0';
    badge.style.backgroundColor = '#0284c7';
    badge.style.color = '#ffffff';
    badge.style.fontSize = '11px';
    badge.style.padding = '2px 6px';
    badge.style.borderRadius = '3px';
    badge.style.whiteSpace = 'nowrap';
    badge.style.fontFamily = 'monospace';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '4px';
    badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
    highlightBox.appendChild(badge);

    document.body.appendChild(highlightBox);
  }

  // document.elementFromPoint 不穿透 shadow root —— 阴影内的元素会被报成宿主。
  // 鼠标事件是 composed 的，composedPath()[0] 才是真正被指到的元素。
  // 注意：closed 模式的 shadow root 对外仍是封闭的，这里也拿不到内部元素。
  function pickEventTarget(e) {
    if (typeof e.composedPath === 'function') {
      const path = e.composedPath();
      if (path && path.length && path[0] && path[0].nodeType === 1) return path[0];
    }
    return document.elementFromPoint(e.clientX, e.clientY);
  }

  function handleMouseMove(e) {
    if (currentMode !== 'inspect') return;
    const el = pickEventTarget(e);
    if (!el || el === highlightBox || highlightBox?.contains(el) || el.id?.startsWith('__ar_')) return;

    currentHoverEl = el;
    const rect = el.getBoundingClientRect();
    initHighlightBox();

    highlightBox.style.display = 'block';
    highlightBox.style.top = rect.top + 'px';
    highlightBox.style.left = rect.left + 'px';
    highlightBox.style.width = rect.width + 'px';
    highlightBox.style.height = rect.height + 'px';

    const badge = highlightBox.querySelector('#__ar_badge__');
    if (badge) {
      const meta = resolveComponentMetadata(el);
      const tag = el.tagName.toLowerCase();
      const txt = (el.innerText || el.textContent || '').trim().slice(0, 14);

      // 悬停时就顺手把偏移算出来 —— 用户点下去的时候通常已经就绪
      if (meta.framework === 'react' && meta.sourceFile) calibrateReactLineOffset(meta.sourceFile);
      const shownLine = correctedReactLine(meta);

      let badgeHtml = '<span style=\"font-weight:bold;\">&lt;' + (meta.componentName || tag) + '&gt;</span>';
      if (meta.sourceFile) {
        const fileName = meta.sourceFile.split('/').pop();
        // 推断来的位置标 ~ 前缀，精确位置才给干净行号
        const locLabel = meta.locateMode === 'text' ? '~' : '';
        badgeHtml += ' <span style=\"opacity:0.8;font-size:10px;\">(' + fileName + (shownLine ? ':' + locLabel + shownLine : '') + ')</span>';
      } else if (txt) {
        badgeHtml += ' <span style=\"opacity:0.9;\">\"' + txt + '\"</span>';
      }
      badge.innerHTML = badgeHtml;
    }
  }

  function handleClick(e) {
    if (currentMode !== 'inspect') return;
    e.preventDefault();
    e.stopPropagation();

    if (currentHoverEl) {
      const el = currentHoverEl;
      const tagName = el.tagName.toLowerCase();
      const className = typeof el.className === 'string' ? el.className : '';
      const id = el.id || '';
      const text = (el.innerText || el.textContent || '').trim().slice(0, 100);
      const rect = el.getBoundingClientRect();
      const meta = resolveComponentMetadata(el);

      let selector = tagName;
      if (id) {
        selector += '#' + id;
      } else if (className) {
        const first = className.split(' ').filter(Boolean)[0];
        if (first) selector += '.' + first;
      }

      const payload = {
        tagName,
        className,
        id,
        text,
        innerText: text,
        textSnippet: text,
        selector,
        rect: {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        framework: meta.framework,
        componentName: meta.componentName,
        sourceFile: meta.sourceFile,
        sourceLine: meta.sourceLine,
        // 位置是否可信：compiler/fiber 是框架注入的精确行号；
        // text 只是按文本推断，消费方（徽标、模型指令）要区别对待
        sourceLocated: meta.locateMode === 'compiler' || meta.locateMode === 'fiber',
        locateMode: meta.locateMode,
        outerHTMLSnippet: (el.outerHTML || '').slice(0, 300)
      };

      setInspectMode('off');

      // React 的行号要等一次偏移现算（异步读模块 sourcemap）。
      // 宁可晚几十毫秒上报，也不报一个必然错的行号。
      if (meta.framework === 'react' && meta.sourceFile && meta.sourceLine != null) {
        calibrateReactLineOffset(meta.sourceFile).then(function (offset) {
          let line = meta.sourceLine;
          if (offset) {
            const fixed = meta.sourceLine - offset;
            if (fixed >= 1) line = fixed;
          }
          payload.sourceLine = line;
          console.log('__AR_INSPECT_RESULT__' + JSON.stringify(payload));
        });
      } else {
        console.log('__AR_INSPECT_RESULT__' + JSON.stringify(payload));
      }
      return;
    }

    setInspectMode('off');
  }

  function handleKeyDown(e) {
    // 批注输入框开着时 ESC 归它管：这里的监听是 document 捕获阶段，
    // 会先于输入框自己的 keydown 触发，不挡一下就会把整个圈改模式关掉。
    if (isNoteDialogOpen) return;
    if (e.key === 'Escape') {
      if (currentMode !== 'off') {
        setInspectMode('off');
        console.log('__AR_INSPECT_CANCELLED__');
      }
    }
  }

  // 2. Markup Overlay (✏️ 圈改标注)
  let markupOverlay = null;
  let isDrawing = null;
  let startX = 0, startY = 0;
  let currentRectEl = null;
  // 画过、并且已经确认过批注的框。以前它们只是 overlay 的匿名子 div，没人
  // 记着 —— 于是既删不掉（发送后、退出圈改后依旧留在画面上，再进圈改又原样
  // 显形），也编不了号（多框时角标、卡片、指令三处对不上）。
  let boxSeq = 0;
  const drawnBoxes = new Map(); // sid -> { id, box, badge, note, label }
  // Electron 渲染进程不实现 window.prompt/alert/confirm（调用直接抛
  // "prompt() is and will not be supported."），批注输入框只能自己画。
  let noteDialogEl = null;
  let isNoteDialogOpen = false;

  function closeNoteDialog() {
    if (noteDialogEl) {
      noteDialogEl.remove();
      noteDialogEl = null;
    }
    isNoteDialogOpen = false;
  }

  /**
   * 圈改批注输入框（window.prompt 的替代品）。
   * onDone(null) = 取消；onDone(text) = 确认，text 已 trim、可能为空串。
   */
  function showNoteDialog(defaultValue, onDone) {
    closeNoteDialog();
    isNoteDialogOpen = true;

    const wrap = document.createElement('div');
    wrap.id = '__ar_markup_dialog__';
    wrap.style.position = 'fixed';
    wrap.style.top = '0';
    wrap.style.left = '0';
    wrap.style.width = '100vw';
    wrap.style.height = '100vh';
    wrap.style.zIndex = '2147483647';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    wrap.style.backgroundColor = 'rgba(15, 23, 42, 0.45)';

    const panel = document.createElement('div');
    panel.style.width = '380px';
    panel.style.maxWidth = 'calc(100vw - 48px)';
    panel.style.boxSizing = 'border-box';
    panel.style.backgroundColor = '#1e293b';
    panel.style.color = '#e2e8f0';
    panel.style.border = '1px solid #334155';
    panel.style.borderRadius = '10px';
    panel.style.padding = '14px';
    panel.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.45)';
    panel.style.fontFamily = 'system-ui, -apple-system, "PingFang SC", sans-serif';

    const label = document.createElement('div');
    label.textContent = PROBE_STRINGS.dialogTitle;
    label.style.fontSize = '13px';
    label.style.marginBottom = '8px';

    const input = document.createElement('textarea');
    input.rows = 3;
    input.value = defaultValue || '';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.resize = 'vertical';
    input.style.backgroundColor = '#0f172a';
    input.style.color = '#e2e8f0';
    input.style.border = '1px solid #334155';
    input.style.borderRadius = '6px';
    input.style.padding = '8px';
    input.style.fontSize = '12px';
    input.style.lineHeight = '1.5';
    input.style.fontFamily = 'inherit';
    input.style.outline = 'none';

    const hint = document.createElement('div');
    hint.textContent = PROBE_STRINGS.dialogHint;
    hint.style.fontSize = '11px';
    hint.style.color = '#64748b';
    hint.style.marginTop = '6px';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';
    actions.style.marginTop = '12px';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = PROBE_STRINGS.cancel;
    cancelBtn.style.backgroundColor = '#334155';
    cancelBtn.style.color = '#e2e8f0';
    cancelBtn.style.border = 'none';
    cancelBtn.style.borderRadius = '6px';
    cancelBtn.style.padding = '6px 14px';
    cancelBtn.style.fontSize = '12px';
    cancelBtn.style.cursor = 'pointer';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = PROBE_STRINGS.confirm;
    okBtn.style.backgroundColor = '#0284c7';
    okBtn.style.color = '#fff';
    okBtn.style.border = 'none';
    okBtn.style.borderRadius = '6px';
    okBtn.style.padding = '6px 14px';
    okBtn.style.fontSize = '12px';
    okBtn.style.fontWeight = 'bold';
    okBtn.style.cursor = 'pointer';

    function finish(value) {
      closeNoteDialog();
      onDone(value);
    }

    cancelBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', () => finish(input.value.trim()));

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish(input.value.trim());
      }
    });

    // 点面板外的遮罩 = 取消；点面板本身不冒泡上去
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) e.preventDefault();
    });
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) finish(null);
    });
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('click', (e) => e.stopPropagation());

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    panel.appendChild(label);
    panel.appendChild(input);
    panel.appendChild(hint);
    panel.appendChild(actions);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
    noteDialogEl = wrap;

    // 与 prompt() 一致：默认文案预先选中，直接打字即替换
    input.focus();
    input.select();
  }

  function initMarkupOverlay() {
    if (markupOverlay) return;
    markupOverlay = document.createElement('div');
    markupOverlay.id = '__ar_markup_overlay__';
    markupOverlay.style.position = 'fixed';
    markupOverlay.style.top = '0';
    markupOverlay.style.left = '0';
    markupOverlay.style.width = '100vw';
    markupOverlay.style.height = '100vh';
    markupOverlay.style.zIndex = '2147483645';
    markupOverlay.style.cursor = 'crosshair';
    markupOverlay.style.display = 'none';
    markupOverlay.style.backgroundColor = 'rgba(15, 23, 42, 0.15)';

    const tip = document.createElement('div');
    tip.style.position = 'absolute';
    tip.style.top = '12px';
    tip.style.left = '50%';
    tip.style.transform = 'translateX(-50%)';
    tip.style.backgroundColor = '#d97706';
    tip.style.color = '#fff';
    tip.style.padding = '4px 12px';
    tip.style.borderRadius = '6px';
    tip.style.fontSize = '12px';
    tip.style.fontWeight = 'bold';
    tip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    tip.textContent = PROBE_STRINGS.overlayTip;
    markupOverlay.appendChild(tip);

    markupOverlay.addEventListener('mousedown', (e) => {
      if (isNoteDialogOpen) return;
      if (e.target !== markupOverlay) return;
      isDrawing = true;
      startX = e.clientX;
      startY = e.clientY;

      currentRectEl = document.createElement('div');
      currentRectEl.style.position = 'absolute';
      currentRectEl.style.border = '2px dashed #f59e0b';
      currentRectEl.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
      currentRectEl.style.left = startX + 'px';
      currentRectEl.style.top = startY + 'px';
      currentRectEl.style.pointerEvents = 'auto';
      markupOverlay.appendChild(currentRectEl);
    });

    markupOverlay.addEventListener('mousemove', (e) => {
      if (!isDrawing || !currentRectEl) return;
      const curX = e.clientX;
      const curY = e.clientY;
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);
      currentRectEl.style.left = x + 'px';
      currentRectEl.style.top = y + 'px';
      currentRectEl.style.width = w + 'px';
      currentRectEl.style.height = h + 'px';
    });

    markupOverlay.addEventListener('mouseup', (e) => {
      if (!isDrawing || !currentRectEl) return;
      isDrawing = false;
      const box = currentRectEl;
      currentRectEl = null;
      const rect = box.getBoundingClientRect();

      // 太小的框是误拖，直接丢掉
      if (rect.width <= 20 || rect.height <= 20) {
        box.remove();
        return;
      }

      // 定位必须在弹输入框**之前**做：框刚画完，画面正是用户看到的那一版；
      // 等用户敲完字再问，中间隔着的正是输入框自己（它会挡住取样点）。
      const target = describeBoxTarget(rect);

      showNoteDialog(PROBE_STRINGS.dialogDefaultNote, (note) => {
        if (!note) {
          box.remove();
          return;
        }
        const sid = 'b' + (++boxSeq);
        // 框只是画出来的东西，确认之后不该再吃鼠标：mousedown 要求
        // e.target === markupOverlay，框若留着 pointer-events:auto，
        // 在已有框内部起笔会被它吃掉 —— 多框就画不出「框套框」。
        box.style.pointerEvents = 'none';
        box.dataset.protoBoxId = sid;
        const badge = document.createElement('div');
        badge.style.position = 'absolute';
        badge.style.bottom = '-24px';
        badge.style.left = '0';
        badge.style.backgroundColor = '#b45309';
        badge.style.color = '#fff';
        badge.style.padding = '2px 8px';
        badge.style.fontSize = '11px';
        badge.style.borderRadius = '3px';
        // 把认出来的元素写进角标：用户发送前就能看到"这一框被认成了什么"，
        // 认错了可以当场 ✕ 掉重画，而不是等模型改完才发现改错了地方。
        // 「组件名 == 标签名」（原生 div）时退回选择器：多框时角标才不会清一色 <div>
        const compLabel = target
          ? (target.componentName && target.componentName.toLowerCase() !== target.tagName
              ? target.componentName
              : (target.selector || target.tagName))
          : '';
        const label = target ? '  · <' + compLabel + '>' : '  · ' + PROBE_STRINGS.noTarget;
        badge.textContent = note + label;
        box.appendChild(badge);
        drawnBoxes.set(sid, { id: sid, box: box, badge: badge, note: note, label: label });
        renumberBadges();

        const payload = {
          id: sid,
          note,
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          target: target
        };
        console.log('__AR_MARKUP_RESULT__' + JSON.stringify(payload));
      });
    });

    document.body.appendChild(markupOverlay);
  }

  /**
   * 让别的输入源（agent 侧的 CDP 坐标点击）穿透遮罩。
   *
   * 遮罩 fixed 全屏、z-index 顶格，画过的框还各自带 pointer-events:auto ——
   * 不让路的话，合成点击只会落在遮罩上，顺带在这里起笔画一个空框。整棵子树一起
   * display:none（它不在文档流里，不会引起重排），并且**不动**已经画好的框：
   * 批注是用户的东西，工具点一下不该把人家清掉。
   */
  let overlayPassthrough = false;
  let overlayPassthroughDisplay = 'block';
  function setInputPassthrough(passthrough) {
    if (!markupOverlay) return;
    if (passthrough === overlayPassthrough) return;
    overlayPassthrough = passthrough;
    if (passthrough) {
      overlayPassthroughDisplay = markupOverlay.style.display;
      markupOverlay.style.display = 'none';
    } else {
      markupOverlay.style.display = overlayPassthroughDisplay;
    }
  }

  /**
   * 框中心命中的元素（连同它外面的层叠）。
   *
   * 取样前必须先把遮罩藏起来：它 fixed 全屏、z-index 顶格，子元素还带着
   * pointer-events:auto，不藏的话 elementsFromPoint 只会返回遮罩自己
   * （实测：返回 [div#__ar_markup_overlay__, ...真实元素]）。
   * display:none 而不是 pointer-events:none —— 画过的每个框都单独设了
   * pointer-events:auto，逐个撤销容易漏；整棵子树一起出局最稳，而且它是
   * fixed 定位、不在文档流里，藏一下不会让页面重排。
   */
  function elementsInsideBox(rect) {
    if (!markupOverlay) return [];
    const prevDisplay = markupOverlay.style.display;
    let stack = [];
    try {
      markupOverlay.style.display = 'none';
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      stack = document.elementsFromPoint(cx, cy) || [];
      // 中心点落在视口外或透明处时是空数组，退到框内四角再试
      if (!stack.length) {
        const pts = [
          [rect.left + 3, rect.top + 3],
          [rect.right - 3, rect.top + 3],
          [rect.left + 3, rect.bottom - 3],
          [rect.right - 3, rect.bottom - 3]
        ];
        for (let i = 0; i < pts.length && !stack.length; i++) {
          stack = document.elementsFromPoint(pts[i][0], pts[i][1]) || [];
        }
      }
    } catch (err) {
      stack = [];
    } finally {
      markupOverlay.style.display = prevDisplay;
    }
    // 遮罩已经藏了，这里再滤一遍探针自己的节点（徽标、刚画的框）
    return stack.filter(function (el) {
      return el && !(el.id && el.id.indexOf('__ar_') === 0) && el !== markupOverlay;
    });
  }

  /** 元素的一行短描述，给「层叠」列表和角标用 */
  function shortElementDesc(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '?';
    const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean)[0] : '';
    return cls ? tag + '.' + cls : tag;
  }

  /**
   * 把「用户框住的这块」翻译成模型能用的定位信息。
   * 圈选那条路早就这么干了（__AR_INSPECT_RESULT__），圈改原先只发了个
   * rect —— 于是模型只知道"有人写了句批注"，压根不知道批的是哪一块，
   * 只能按文字猜（实测：框了顶部标签栏写「背景色改橙色」，结果改了整页背景）。
   */
  function describeBoxTarget(rect) {
    const stack = elementsInsideBox(rect);
    if (!stack.length) return null;

    // 跟圈选同一条规则：优先取最内层「有用户源码位置」的元素，
    // 中间的组件库包装层（ElOnlyChild 之类）对用户没有意义。
    let picked = null;
    for (let i = 0; i < stack.length; i++) {
      const loc = readOwnLoc(stack[i]);
      if (loc && isUserFile(loc.file)) { picked = stack[i]; break; }
    }
    if (!picked) picked = stack[0];

    const meta = resolveComponentMetadata(picked);
    const tagName = picked.tagName ? picked.tagName.toLowerCase() : '';
    const className = typeof picked.className === 'string' ? picked.className : '';
    const id = picked.id || '';
    const text = (picked.innerText || picked.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);

    let selector = tagName;
    if (id) selector += '#' + id;
    else if (className) {
      const first = className.split(' ').filter(Boolean)[0];
      if (first) selector += '.' + first;
    }

    return {
      tagName: tagName,
      className: className,
      id: id,
      text: text,
      selector: selector,
      framework: meta.framework,
      componentName: meta.componentName || '',
      sourceFile: meta.sourceFile || '',
      sourceLine: meta.sourceLine,
      sourceLocated: meta.locateMode === 'compiler' || meta.locateMode === 'fiber',
      locateMode: meta.locateMode,
      outerHTMLSnippet: (picked.outerHTML || '').slice(0, 300),
      // 由内到外的层叠：用户框的常常是一个"块"，让模型看见它套在谁里面
      stack: stack.slice(0, 6).map(shortElementDesc)
    };
  }

  /**
   * 角标上的 #N 必须和批注卡片、指令里的【圈改位置 N】同源：三处都按「框的先后
   * 顺序」，删掉中间一个之后重编一遍，否则模型收到的序号跟用户眼前看到的对不上。
   */
  function renumberBadges() {
    let n = 0;
    drawnBoxes.forEach(function (entry) {
      n++;
      entry.badge.textContent = '#' + n + ' ' + entry.note + entry.label;
    });
  }

  /**
   * 清掉画过的所有框：退出圈改、发送、切换原型都走这里。
   * 以前只有 clearMarkups() 会删，而它没有任何调用者 —— 框因此长生不老，
   * 重进圈改时又被 display:block 原样显形（用户报的「上次圈改的地方还是
   * 激活状态」就是这条）。
   */
  function clearDrawnBoxes() {
    closeNoteDialog();
    drawnBoxes.forEach(function (entry) {
      if (entry.box && entry.box.isConnected) entry.box.remove();
    });
    drawnBoxes.clear();
    isDrawing = false;
    currentRectEl = null;
    // 兜底：本体是旧探针时留下的、没登记过的框（id 由新代码才打，这里只可能
    // 命中新代码画出来的框，留着等于双保险）
    if (markupOverlay) {
      markupOverlay.querySelectorAll('div[data-proto-box-id]').forEach(function (b) {
        b.remove();
      });
    }
  }

  /** 删掉其中一个框（批注卡片上那一行的 ✕），其余框不动、重新编号 */
  function removeDrawnBox(id) {
    const entry = drawnBoxes.get(id);
    if (!entry) return false;
    if (entry.box && entry.box.isConnected) entry.box.remove();
    drawnBoxes.delete(id);
    renumberBadges();
    return true;
  }

  function setInspectMode(mode) {
    currentMode = mode;
    // 模式切换自己会定 display，穿透窗口随之作废
    overlayPassthrough = false;
    initHighlightBox();
    initMarkupOverlay();

    if (mode === 'inspect') {
      // 圈选是「点一个点」，圈改留下的框到这里就没有意义了，顺手清掉
      clearDrawnBoxes();
      highlightBox.style.display = 'none';
      markupOverlay.style.display = 'none';
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);
    } else if (mode === 'markup') {
      if (highlightBox) highlightBox.style.display = 'none';
      markupOverlay.style.display = 'block';
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);
    } else {
      // ESC 也走这里（handleKeyDown → setInspectMode('off')），所以退出即清框，
      // 不需要另一条路径。'markup' 分支**不**清：进入模式时本来就已经是空的。
      clearDrawnBoxes();
      if (highlightBox) highlightBox.style.display = 'none';
      if (markupOverlay) markupOverlay.style.display = 'none';
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    }
  }

  // 3. Vite Error Overlay & DOM Error Sniffer
  function checkViteOverlay() {
    const viteOverlay = document.querySelector('vite-error-overlay');
    if (viteOverlay && viteOverlay.shadowRoot) {
      const messageBody = viteOverlay.shadowRoot.querySelector('.message-body');
      const file = viteOverlay.shadowRoot.querySelector('.file');
      return {
        hasError: true,
        message: messageBody ? messageBody.textContent : 'Vite Compilation Error',
        file: file ? file.textContent : ''
      };
    }
    return { hasError: false };
  }

  window.__AR_BROWSER_PROBE__ = {
    setMode: setInspectMode,
    checkViteOverlay: checkViteOverlay,
    resolveComponentMetadata: resolveComponentMetadata,
    // 不带 id = 全清；带 id = 只删那一个框（渲染层卡片上那一行的 ✕）
    clearMarkups: function(id) {
      return id != null ? removeDrawnBox(id) : (clearDrawnBoxes(), true);
    },
    setInputPassthrough: setInputPassthrough
  };
})();
// 给注入脚本一个名字：executeJavaScript 进来的脚本默认没有 URL，栈帧全是
// \`<anonymous>:641:22\`，跟原型代码的报错长得一模一样，控制台分不出是谁炸的。
// 带上 sourceURL 后探针自己的栈帧都长这样，devtools.ts 靠它认领错误。
//# sourceURL=__ar_browser_probe__.js
`;
}
