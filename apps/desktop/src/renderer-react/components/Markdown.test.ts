import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./Markdown";

describe("renderMarkdown", () => {
  it("renders legacy :::gtd blocks as ordinary Markdown without a task card", () => {
    const html = renderMarkdown(":::gtd waiting\nWait for the design review\n:::");
    expect(html).not.toContain("note-gtd-card");
    expect(html).not.toContain("gtd-status-tag");
    expect(html).toContain("Wait for the design review");
  });

  it("handles empty strings cleanly", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("caches markdown parsing results across identical calls", () => {
    const input = "# Test Title\n\nSome **bold** text and `code`.";
    const first = renderMarkdown(input);
    const second = renderMarkdown(input);
    expect(first).toBe(second);
    expect(first).toContain("<h1>Test Title</h1>");
  });

  it("leaves legacy executable directives as inert Markdown", () => {
    const md = [
      ":::note-child idle note=abc",
      "Child task",
      ":::",
      "",
      ":::session codex planned",
      "Session prompt",
      ":::",
      "",
      ":::run awaiting_approval",
      "Go",
      ":::"
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).not.toContain("note-exec-card");
    expect(html).not.toContain("note-child-card");
    expect(html).toContain(":::note-child idle note=abc");
    expect(html).toContain("Child task");
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

    const html = renderMarkdown(input);
    expect(html).toContain("变更说明");
    expect(html).toContain("壹佰万元整");
    expect(html).toContain("&lt;style&gt;");
    expect(html).toContain("All checks pass");
  });

  it("safely handles prose <script> and generic tags without dropping them or following text", () => {
    const input = "Declare List<String> and Map<K, V> without <script>alert(1)</script> eating text.\n## Next Section";
    const html = renderMarkdown(input);
    expect(html).toContain("List&lt;String&gt;");
    expect(html).toContain("Map&lt;K, V&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<h2>Next Section</h2>");
  });

  it("retains code block content without double-escaping inside code fences", () => {
    const input = "```vue\n<style scoped>\n.foo { color: red; }\n</style>\n```\nAfter code block.";
    const html = renderMarkdown(input);
    expect(html).toContain("&lt;style scoped&gt;");
    expect(html).toContain("hljs");
    expect(html).toContain("After code block.");
  });

  it("preserves safe html tags in prose", () => {
    const input = "Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy. <br> Next line <b>bold</b>.";
    const html = renderMarkdown(input);
    expect(html).toContain("<kbd>Ctrl</kbd>");
    expect(html).toContain("<b>bold</b>");
    expect(html).toContain("<br>");
  });
});
