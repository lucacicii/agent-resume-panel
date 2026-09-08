import { describe, expect, it } from "vitest";
import {
  imageHtml,
  posixDirname,
  posixJoin,
  promoteBareImagePaths,
  resolveMarkdownImageSrc,
  rewriteMarkdownImages,
  rewriteMarkdownImageSyntax
} from "./markdownImage";

const baseDir = "/work/app/docs";
const rootDir = "/work/app";

describe("resolveMarkdownImageSrc", () => {
  it("resolves relative paths against the markdown file directory", () => {
    const resolved = resolveMarkdownImageSrc("./shot.png", { baseDir, rootDir });
    expect(resolved).toEqual({
      kind: "local",
      absPath: "/work/app/docs/shot.png",
      url: "file:///work/app/docs/shot.png"
    });
  });

  it("resolves sibling asset folders used by Notes paste", () => {
    const resolved = resolveMarkdownImageSrc("./guide.assets/paste-1.png", {
      baseDir: "/Users/lucas/.agent-resume-panel/notes/library",
      rootDir: "/Users/lucas/.agent-resume-panel/notes"
    });
    expect(resolved.kind).toBe("local");
    if (resolved.kind === "local") {
      expect(resolved.absPath).toBe("/Users/lucas/.agent-resume-panel/notes/library/guide.assets/paste-1.png");
      expect(resolved.url).toBe("file:///Users/lucas/.agent-resume-panel/notes/library/guide.assets/paste-1.png");
    }
  });

  it("keeps data URLs", () => {
    const src = "data:image/png;base64,AAAA";
    expect(resolveMarkdownImageSrc(src, { baseDir, rootDir })).toEqual({ kind: "data", url: src });
  });

  it("marks http(s) as remote without loading", () => {
    expect(resolveMarkdownImageSrc("https://cdn.example.com/a.png", { baseDir, rootDir })).toEqual({
      kind: "remote",
      href: "https://cdn.example.com/a.png",
      host: "cdn.example.com"
    });
  });

  it("rejects path traversal outside the project root", () => {
    expect(resolveMarkdownImageSrc("../../.ssh/id_rsa.png", { baseDir, rootDir })).toEqual({
      kind: "reject",
      reason: "outside-root"
    });
  });

  it("rejects non-image extensions", () => {
    expect(resolveMarkdownImageSrc("./secret.txt", { baseDir, rootDir }).kind).toBe("reject");
  });

  it("rejects javascript URLs", () => {
    expect(resolveMarkdownImageSrc("javascript:alert(1)", { baseDir, rootDir })).toEqual({
      kind: "reject",
      reason: "unsafe"
    });
  });

  it("converts file:// URLs that stay inside the root", () => {
    const resolved = resolveMarkdownImageSrc("file:///work/app/docs/a.webp", { baseDir, rootDir });
    expect(resolved.kind).toBe("local");
    if (resolved.kind === "local") {
      expect(resolved.url).toBe("file:///work/app/docs/a.webp");
    }
  });

  it("rejects relative images when no base directory is available", () => {
    expect(resolveMarkdownImageSrc("./shot.png")).toEqual({ kind: "reject", reason: "no-base" });
  });

  it("allows composer clipboard images in the OS temp directory", () => {
    const src = "/var/folders/jg/4dwyy9ws0bz2h46djn1qgmw80000gn/T/pi-clipboard-f95f8344-8b1f-4bcf-8875-0ead1641e5e7.png";
    const resolved = resolveMarkdownImageSrc(src, { baseDir, rootDir });
    expect(resolved.kind).toBe("local");
    if (resolved.kind === "local") {
      expect(resolved.absPath).toBe(src);
      expect(resolved.url).toBe(`file://${src}`);
    }
  });
});

describe("rewriteMarkdownImages", () => {
  it("rewrites relative img src to file URLs", () => {
    const html = rewriteMarkdownImages('<p><img src="./shot.png" alt="Shot"></p>', { baseDir, rootDir });
    expect(html).toContain('src="file:///work/app/docs/shot.png"');
    expect(html).toContain('class="md-preview-img"');
  });

  it("does not emit https img src for remote images", () => {
    const html = rewriteMarkdownImages('<img src="https://cdn.example.com/a.png" alt="Remote">', { baseDir, rootDir });
    expect(html).not.toContain("<img");
    expect(html).toContain("cdn.example.com");
    expect(html).toContain("https://cdn.example.com/a.png");
  });
});

describe("imageHtml", () => {
  it("renders a placeholder for rejected images", () => {
    const html = imageHtml({ kind: "reject", reason: "outside-root" }, "secret");
    expect(html).toContain("secret");
    expect(html).not.toContain("<img");
  });
});

describe("promoteBareImagePaths", () => {
  it("turns quoted clipboard image paths into markdown images", () => {
    const src = "/var/folders/jg/xxx/T/pi-clipboard-abc.png";
    expect(promoteBareImagePaths(`look '${src}' then continue`)).toBe(`look ![](${src}) then continue`);
  });

  it("does not rewrite markdown image syntax a second time", () => {
    const src = "/tmp/agent-resume-clipboard-1.png";
    expect(promoteBareImagePaths(`![Shot](${src})`)).toBe(`![Shot](${src})`);
  });

  it("keeps trailing prompt text after a clipboard image path", () => {
    const src = "/var/folders/jg/xxx/T/pi-clipboard-abc.png";
    expect(promoteBareImagePaths(`"${src}#anfeng-web 添加页面`)).toBe(`![](${src})#anfeng-web 添加页面`);
  });
});

describe("rewriteMarkdownImageSyntax", () => {
  it("rewrites relative markdown image syntax to file URLs", () => {
    expect(rewriteMarkdownImageSyntax("![Shot](./shot.png)", { baseDir, rootDir })).toBe(
      "![Shot](https://agent-resume.local/img?p=%2Fwork%2Fapp%2Fdocs%2Fshot.png)"
    );
  });
});

describe("posix helpers", () => {
  it("joins and splits posix paths", () => {
    expect(posixDirname("/work/app/docs/guide.md")).toBe("/work/app/docs");
    expect(posixJoin("/work/app/docs", "./shot.png")).toBe("/work/app/docs/shot.png");
  });
});
