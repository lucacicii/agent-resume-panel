import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, within, cleanup, fireEvent } from "@testing-library/react";
import { StreamdownRenderer } from "./StreamdownRenderer";

describe("StreamdownRenderer integration test suite", () => {
  afterEach(() => {
    cleanup();
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
