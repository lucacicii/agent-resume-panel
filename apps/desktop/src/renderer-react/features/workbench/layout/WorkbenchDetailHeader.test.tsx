import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n";
import { WorkbenchDetailHeader } from "./WorkbenchDetailHeader";

function renderHeader(overrides?: Partial<Parameters<typeof WorkbenchDetailHeader>[0]>) {
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.common.revealInFinder": "Reveal in Finder",
        "desktop.workbench.sidePanelExplorer": "Explorer",
        "desktop.workbench.sidePanelScripts": "Scripts",
        "desktop.workbench.sidePanelSearch": "Search",
        "desktop.workbench.sidePanelGit": "Git"
      }
    }),
    onLocaleChanged: () => () => undefined
  } as unknown as typeof window.agentResume;
  return render(
    <I18nProvider>
      <WorkbenchDetailHeader
        title="Poster task"
        directory={null}
        side={null}
        branchStatusLabel={null}
        branchStatusPane={null}
        branchStatusNested={false}
        onOpenBranchMenu={() => undefined}
        onToggleSide={() => undefined}
        {...overrides}
      />
    </I18nProvider>
  );
}

describe("WorkbenchDetailHeader", () => {
  afterEach(cleanup);

  it("shows no image when the task's template has none", () => {
    renderHeader();
    expect(screen.getByText("Poster task")).toBeTruthy();
    expect(document.querySelector(".wb-detail-task-image")).toBeNull();
  });

  it("leads the title with the task's template image", () => {
    renderHeader({ imageUrl: "data:image/png;base64,aXBo" });
    const head = document.querySelector(".wb-detail-head")!;
    const image = head.querySelector<HTMLImageElement>(".wb-detail-task-image");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("data:image/png;base64,aXBo");
    // The image precedes the title inside the label.
    const label = head.querySelector(".wb-detail-project-label")!;
    expect(label.firstElementChild).toBe(image);
  });

  it("prioritizes Git in the toolbar and shows a badge when there are uncommitted changes", async () => {
    renderHeader({ gitDirtyCount: 4 });
    // The count is part of the accessible name, not just the badge.
    const gitButton = await screen.findByRole("button", { name: "Git, 4" });
    const tools = document.querySelectorAll<HTMLButtonElement>(".wb-detail-tool");
    expect(tools[0]).toBe(gitButton);
    const badge = gitButton.querySelector(".wb-detail-tool-badge");
    expect(badge?.textContent).toBe("4");
    // The tooltip carries the accelerator so the shortcut is discoverable here.
    expect(gitButton.getAttribute("title")).toMatch(/^Git, 4 \((.+)G\)$/);
  });

  it("keeps the Git label bare and drops the badge when the tree is clean", async () => {
    renderHeader({ gitDirtyCount: 0 });
    const gitButton = await screen.findByRole("button", { name: "Git" });
    expect(gitButton.querySelector(".wb-detail-tool-badge")).toBeNull();
    expect(gitButton.getAttribute("title")).toMatch(/^Git \((.+)G\)$/);
  });
});
