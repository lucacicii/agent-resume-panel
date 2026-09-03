import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, fireEvent, within, cleanup } from "@testing-library/react";
import { ArtifactCard } from "./ArtifactCard";

describe("ArtifactCard component test suite", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders HTML artifact in preview mode by default with iframe sandbox", () => {
    const htmlCode = '<div class="test-widget"><h1>Hello HTML</h1></div>';
    const { container } = render(<ArtifactCard language="html" code={htmlCode} title="My Widget" />);

    expect(within(container).getByText("HTML")).toBeDefined();
    expect(within(container).getByText("My Widget")).toBeDefined();

    // Check default preview tab is selected
    const previewTab = within(container).getByRole("tab", { name: /preview/i });
    expect(previewTab.getAttribute("aria-selected")).toBe("true");

    // Check iframe existence and sandbox attributes
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeDefined();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("srcdoc")).toContain("Hello HTML");
  });

  it("switches to code tab and shows highlighted code", () => {
    const htmlCode = "<div>Test Code View</div>";
    const { container } = render(<ArtifactCard language="html" code={htmlCode} />);

    const codeTab = within(container).getByRole("tab", { name: /code/i });
    fireEvent.click(codeTab);

    expect(codeTab.getAttribute("aria-selected")).toBe("true");
    const codeEl = container.querySelector(".artifact-code-view code");
    expect(codeEl).toBeDefined();
    expect(codeEl?.textContent).toContain("Test Code View");
  });

  it("renders SVG graphic and supports background switching", () => {
    const svgCode = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red" /></svg>';
    const { container } = render(<ArtifactCard language="svg" code={svgCode} />);

    expect(within(container).getByText("SVG")).toBeDefined();

    // SVG should be rendered inside canvas
    const svgEl = container.querySelector(".artifact-svg-canvas svg");
    expect(svgEl).toBeDefined();

    // Check background mode switching
    const canvas = container.querySelector(".artifact-svg-canvas");
    expect(canvas?.classList.contains("is-bg-checker")).toBe(true);

    const darkBtn = within(container).getByTitle("desktop.artifact.bgDark");
    fireEvent.click(darkBtn);
    expect(canvas?.classList.contains("is-bg-dark")).toBe(true);

    const lightBtn = within(container).getByTitle("desktop.artifact.bgLight");
    fireEvent.click(lightBtn);
    expect(canvas?.classList.contains("is-bg-light")).toBe(true);
  });

  it("opens fullscreen modal when clicking fullscreen button and closes on exit", () => {
    const htmlCode = "<div>Fullscreen Test</div>";
    const { container } = render(<ArtifactCard language="html" code={htmlCode} />);

    // Initially modal is not open
    expect(document.querySelector(".artifact-modal-backdrop")).toBeNull();

    const fullscreenBtn = within(container).getByTitle("desktop.artifact.fullscreen");
    fireEvent.click(fullscreenBtn);

    // Modal dialog should now exist in document body
    const modalBackdrop = document.querySelector(".artifact-modal-backdrop");
    expect(modalBackdrop).toBeDefined();

    const exitBtn = within(modalBackdrop as HTMLElement).getByTitle("desktop.artifact.exitFullscreen");
    fireEvent.click(exitBtn);

    // Modal closed
    expect(document.querySelector(".artifact-modal-backdrop")).toBeNull();
  });

  it("copies code to clipboard when copy button clicked", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock }
    });

    const code = "<button>Click</button>";
    const { container } = render(<ArtifactCard language="html" code={code} />);

    const copyBtn = within(container).getByTitle("desktop.artifact.copy");
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(code);
  });
});
