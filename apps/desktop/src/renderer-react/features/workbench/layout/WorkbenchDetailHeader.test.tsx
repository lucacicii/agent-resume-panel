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
        "desktop.gtd.backToGtd": "Back to GTD",
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
});
