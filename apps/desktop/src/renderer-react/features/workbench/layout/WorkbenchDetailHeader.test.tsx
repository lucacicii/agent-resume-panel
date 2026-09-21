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
    const tools = document.querySelectorAll<HTMLButtonElement>(".wb-detail-tool");
    await screen.findByRole("button", { name: "Git" });
    expect(tools[0]?.getAttribute("aria-label")).toBe("Git");
    const badge = tools[0]?.querySelector(".wb-detail-tool-badge");
    expect(badge?.textContent).toBe("4");
    expect(tools[0]?.getAttribute("title")).toBe("Git (4)");
  });
});
