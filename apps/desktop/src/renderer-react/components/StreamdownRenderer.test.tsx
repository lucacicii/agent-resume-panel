import { describe, it, expect, vi, afterEach } from "vitest";
import { render, within, cleanup, fireEvent } from "@testing-library/react";
import { StreamdownRenderer } from "./StreamdownRenderer";
import { buildMarkdownSegments } from "./markdownSegments";
import * as SanitizeModule from "./markdownSanitize";

vi.mock("./markdownSanitize", async (importOriginal) => {
  const actual = await importOriginal<typeof SanitizeModule>();
  return { ...actual, sanitizeMarkdownProseTags: vi.fn(actual.sanitizeMarkdownProseTags) };
});

function streamingDoc(paragraphs: number): string {
  const parts = ["# Alpha heading", ""];
  for (let index = 0; index < paragraphs; index += 1) {
    parts.push(`Paragraph ${index} with **bold**, \`code\` and a [link](https://example.com/${index}).`);
    parts.push("");
  }
  return parts.join("\n");
}

describe("StreamdownRenderer integration test suite", () => {
  afterEach(() => {
    cleanup();
  });

  it("reuses closed markdown segments while streaming content grows", () => {
    const sanitizeSpy = vi.mocked(SanitizeModule.sanitizeMarkdownProseTags);
    sanitizeSpy.mockClear();
    const doc = streamingDoc(40);
    const initialSegments = buildMarkdownSegments(null, `${doc}tail`, undefined).segments;
    expect(initialSegments.length).toBeGreaterThan(1);
    const closedRaw = initialSegments[0].raw;
    const closedPrepared = initialSegments[0].prepared;
    sanitizeSpy.mockClear();

    const view = render(<StreamdownRenderer content={`${doc}tail`} isAnimating />);
    const firstSegmentNode = view.container.querySelector("h1");
    expect(firstSegmentNode?.textContent).toBe("Alpha heading");
    const sanitizeCallsForClosed = (): number =>
      sanitizeSpy.mock.calls.filter(([input]) => input === closedRaw).length;
    expect(sanitizeCallsForClosed()).toBe(1);
    sanitizeSpy.mockClear();

    for (let index = 0; index < 3; index += 1) {
      view.rerender(<StreamdownRenderer content={`${doc}tail ${index}`} isAnimating />);
      // The closed segment is neither re-sanitized nor re-rendered.
      expect(sanitizeCallsForClosed()).toBe(0);
      expect(sanitizeSpy.mock.calls.some(([input]) => input === closedPrepared)).toBe(false);
      expect(view.container.querySelector("h1")).toBe(firstSegmentNode);
    }

    expect(view.container.textContent).toContain("tail 2");
    expect(view.container.textContent).toContain("Paragraph 0 with");
  });

  it("renders basic markdown headings and formatting", () => {
    const md = "# Hello Streamdown\nThis is **bold** text and *italic* text.";
    const { container } = render(<StreamdownRenderer content={md} />);

    expect(within(container).getByRole("heading", { level: 1 })).toBeDefined();
    expect(within(container).getByText("bold")).toBeDefined();
    expect(within(container).getByText("italic")).toBeDefined();
  });

  it("intercepts html code blocks and renders them as ArtifactCard", () => {
    const md = [
      "Here is an interactive artifact:",
      "```html",
      '<div id="app"><h1>Live App</h1></div>',
      "```",
      "And text afterwards."
    ].join("\n");

    const { container } = render(<StreamdownRenderer content={md} />);

    // ArtifactCard should be rendered
    const card = container.querySelector(".artifact-card");
    expect(card).toBeDefined();
    expect(within(card as HTMLElement).getByText("HTML")).toBeDefined();

    // Sandboxed iframe should be inside
    const iframe = card?.querySelector("iframe");
    expect(iframe).toBeDefined();
    expect(iframe?.getAttribute("srcdoc")).toContain("Live App");
  });

  it("intercepts svg code blocks and renders them as ArtifactCard with canvas", () => {
    const md = [
      "Here is a vector icon:",
      "```svg",
      '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="blue" /></svg>',
      "```"
    ].join("\n");

    const { container } = render(<StreamdownRenderer content={md} />);

    const card = container.querySelector(".artifact-card");
    expect(card).toBeDefined();
    expect(within(card as HTMLElement).getByText("SVG")).toBeDefined();

    const svg = card?.querySelector(".artifact-svg-canvas svg");
    expect(svg).toBeDefined();
  });

  it("renders non-artifact code blocks with copy button and language tag", () => {
    const md = [
      "```python",
      "def greet():",
      '    return "Hello"',
      "```"
    ].join("\n");

    const { container } = render(<StreamdownRenderer content={md} />);

    // Should render standard .code-block, NOT .artifact-card
    expect(container.querySelector(".artifact-card")).toBeNull();
    const codeBlock = container.querySelector(".code-block");
    expect(codeBlock).toBeDefined();
    expect(within(codeBlock as HTMLElement).getByText("python")).toBeDefined();
    expect(codeBlock?.querySelector(".code-copy-btn")).toBeDefined();
  });

  it("handles unclosed streaming html code blocks gracefully without crashing", () => {
    // Simulating mid-stream token arrival where closing fence hasn't arrived yet
    const streamingMd = "```html\n<div>Generating live content...";
    const { container } = render(<StreamdownRenderer content={streamingMd} isAnimating={true} />);

    const card = container.querySelector(".artifact-card");
    expect(card).toBeDefined();
    expect(within(card as HTMLElement).getByText("HTML")).toBeDefined();
  });

  it("renders markdown tables with controls and supports fullscreen toggle", () => {
    const tableMd = [
      "| Name | Path |",
      "| --- | --- |",
      "| Page | src/views/index.vue |"
    ].join("\n");

    const { container } = render(<StreamdownRenderer content={tableMd} />);

    const wrapper = container.querySelector('[data-streamdown="table-wrapper"]');
    expect(wrapper).toBeTruthy();

    const table = container.querySelector('[data-streamdown="table"]');
    expect(table).toBeTruthy();
    expect(table?.textContent).toContain("Page");
    expect(table?.textContent).toContain("src/views/index.vue");

    // All 3 action buttons (Copy, Download, Fullscreen) should exist
    const buttons = wrapper?.querySelectorAll("button") || [];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    const fullscreenBtn = wrapper?.querySelector('button[title*="全屏"], button[title*="Fullscreen"], button[title*="fullscreen" i]') as HTMLButtonElement;
    expect(fullscreenBtn).toBeTruthy();

    // Clicking fullscreen button mounts portal into document.body
    fireEvent.click(fullscreenBtn);
    let fullscreenOverlay = document.body.querySelector('[data-streamdown="table-fullscreen"]');
    expect(fullscreenOverlay).toBeTruthy();
    expect(fullscreenOverlay?.querySelector('[data-streamdown="table"]')?.textContent).toContain("src/views/index.vue");

    // Pressing Escape should close fullscreen
    fireEvent.keyDown(document, { key: "Escape" });
    fullscreenOverlay = document.body.querySelector('[data-streamdown="table-fullscreen"]');
    expect(fullscreenOverlay).toBeNull();
  });

  it("streams a growing tail into a single markdown body", () => {
    const doc = "# Title\n\nFirst paragraph with **bold** text.\n\nSecond paragraph stays stable.\n\n";
    const view = render(<StreamdownRenderer content={`${doc}tail`} isAnimating />);
    const firstParagraph = view.container.querySelector("p");

    view.rerender(<StreamdownRenderer content={`${doc}tail grows more`} isAnimating />);
    const paragraphs = [...view.container.querySelectorAll("p")];

    expect(paragraphs[0]).toBe(firstParagraph);
    expect(paragraphs[0]?.textContent).toBe("First paragraph with bold text.");
    expect(paragraphs[1]?.textContent).toBe("Second paragraph stays stable.");
    expect(view.container.textContent).toContain("tail grows more");
  });

  it("renders composer clipboard image paths as images", () => {
    const src = "/var/folders/jg/xxx/T/pi-clipboard-abc.png";
    const { container } = render(<StreamdownRenderer content={`look '${src}' then continue`} />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe(`file://${src}`);
  });

  it("renders local markdown images and remote placeholders", () => {
    const md = "![Shot](./shot.png)\n\n![Remote](https://cdn.example.com/a.png)";
    const onImageClick = vi.fn();
    const { container } = render(
      <StreamdownRenderer
        content={md}
        imageOptions={{ baseDir: "/work/app/docs", rootDir: "/work/app" }}
        onImageClick={onImageClick}
      />
    );
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("file:///work/app/docs/shot.png");
    fireEvent.click(img);
    expect(onImageClick).toHaveBeenCalledWith("file:///work/app/docs/shot.png");
    expect(container.querySelector("img[src^=\"https://\"]")).toBeNull();
    expect(container.textContent).toContain("cdn.example.com");
  });
});

describe("StreamdownRenderer parity with the retired marked renderer", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders legacy :::gtd blocks as ordinary Markdown without a task card", () => {
    const { container } = render(<StreamdownRenderer content={":::gtd waiting\nWait for the design review\n:::"} hardBreaks />);
    expect(container.querySelector(".note-gtd-card, .gtd-status-tag")).toBeNull();
    expect(container.textContent).toContain("Wait for the design review");
  });

  it("leaves legacy executable directives as inert Markdown", () => {
    const md = [
      ":::note-child idle note=abc",
      "Child task",
      ":::"
    ].join("\n");
    const { container } = render(<StreamdownRenderer content={md} hardBreaks />);
    expect(container.querySelector(".note-exec-card, .note-child-card")).toBeNull();
    expect(container.textContent).toContain("Child task");
  });

  it("prevents unclosed <style> in prose from truncating subsequent markdown content", () => {
    const input = [
      "In ads_cst_credit/index.vue:",
      "- Import digitUppercase.",
      "- Note that ads_cst_credit file currently has NO <style> block.",
      "All checks pass. Here is the summary:",
      "## 变更说明",
      "文件: index.vue",
      "1,000,000.00",
      "壹佰万元整"
    ].join("\n");
    const { container } = render(<StreamdownRenderer content={input} hardBreaks />);
    const text = container.textContent || "";
    expect(text).toContain("变更说明");
    expect(text).toContain("壹佰万元整");
    expect(text).toContain("style");
    expect(text).toContain("All checks pass");
  });

  it("escapes prose <script> and generic tags without dropping them or following text", () => {
    const input = "Declare List<String> and Map<K, V> without <script>alert(1)</script> eating text.\n## Next Section";
    const { container } = render(<StreamdownRenderer content={input} hardBreaks />);
    const text = container.textContent || "";
    expect(text).toContain("List<String>");
    expect(text).toContain("Map<K, V>");
    expect(text).toContain("<script>alert(1)</script>");
    expect(within(container).getByRole("heading", { level: 2 }).textContent).toContain("Next Section");
  });

  it("retains code block content without double-escaping inside code fences", () => {
    const input = "```vue\n<style scoped>\n.foo { color: red; }\n</style>\n```\nAfter code block.";
    const { container } = render(<StreamdownRenderer content={input} hardBreaks />);
    const code = container.querySelector("pre code");
    expect(code?.textContent).toContain("<style scoped>");
    expect(code?.className).toContain("hljs");
    expect(container.textContent).toContain("After code block.");
  });

  it("preserves safe html tags in prose", () => {
    const input = "Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy. <br> Next line <b>bold</b>.";
    const { container } = render(<StreamdownRenderer content={input} hardBreaks />);
    expect(container.querySelectorAll("kbd").length).toBe(2);
    expect(container.querySelector("b")?.textContent).toBe("bold");
  });

  it("renders nothing for empty content without crashing", () => {
    const { container } = render(<StreamdownRenderer content="" hardBreaks />);
    expect(container.querySelector("*")).toBeNull();
  });

  it("converts single newlines to <br> only when hardBreaks is enabled", () => {
    const md = "first line\nsecond line";

    const plain = render(<StreamdownRenderer content={md} />);
    expect(plain.container.querySelector("br")).toBeNull();
    expect(plain.container.querySelector("p")?.textContent).toBe("first line\nsecond line");
    cleanup();

    const breaking = render(<StreamdownRenderer content={md} hardBreaks />);
    expect(breaking.container.querySelector("p br")).toBeTruthy();
    expect(breaking.container.querySelector("p")?.textContent).toBe("first line\nsecond line");
  });

  it("keeps GFM features with hardBreaks enabled", () => {
    const md = [
      "| Name | Path |",
      "| --- | --- |",
      "| Page | src/views/index.vue |"
    ].join("\n");
    const { container } = render(<StreamdownRenderer content={md} hardBreaks />);
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.textContent).toContain("src/views/index.vue");
  });
});
