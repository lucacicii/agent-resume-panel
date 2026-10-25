import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
        onToggleSide={() => undefined}
        {...overrides}
      />
    </I18nProvider>
  );
}

describe("WorkbenchDetailHeader directory open control", () => {
  it("opens in Zed by default and remembers another choice", async () => {
    localStorage.clear();
    const onOpenDirectory = vi.fn();
    const contextMenuShow = vi.fn().mockResolvedValue("vscode");
    window.agentResume = {
      getI18nBundle: vi.fn().mockResolvedValue({ locale: "en", messages: {
        "desktop.workbench.openDirectoryIn.zed": "Open in Zed",
        "desktop.workbench.openDirectoryIn.vscode": "Open in VS Code",
        "desktop.workbench.openDirectoryIn.finder": "Reveal in Finder",
        "desktop.workbench.openDirectoryWith": "Open with…"
      } }),
      onLocaleChanged: vi.fn().mockReturnValue(() => undefined),
      workbenchAppIcons: vi.fn().mockResolvedValue({
        zed: "data:image/png;base64,zed",
        vscode: "data:image/png;base64,vscode",
        finder: "data:image/png;base64,finder"
      }),
      contextMenuShow
    } as unknown as typeof window.agentResume;

    render(
      <I18nProvider>
        <WorkbenchDetailHeader
          title="repo"
          directory="/work/app"
          onOpenDirectory={onOpenDirectory}
          side={null}
          onToggleSide={() => undefined}
        />
      </I18nProvider>
    );

    // The primary button runs the remembered target, which starts as Zed, and
    // wears that app's own icon.
    const primary = await screen.findByRole("button", { name: "Open in Zed" });
    await waitFor(() => expect(primary.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,zed"));
    fireEvent.click(primary);
    expect(onOpenDirectory).toHaveBeenLastCalledWith("zed");

    // The caret offers all three and remembers what was picked.
    fireEvent.click(screen.getByRole("button", { name: "Open with…" }));
    await waitFor(() => expect(contextMenuShow).toHaveBeenCalled());
    await waitFor(() => expect(onOpenDirectory).toHaveBeenLastCalledWith("vscode"));
    expect(localStorage.getItem("workbench-open-directory-in")).toBe("vscode");
  });
});

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
