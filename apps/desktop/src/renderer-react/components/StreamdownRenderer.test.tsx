import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, within, cleanup } from "@testing-library/react";
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
});
