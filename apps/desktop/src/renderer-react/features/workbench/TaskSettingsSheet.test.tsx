import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { TaskSettingsSheet } from "./TaskSettingsSheet";

const MESSAGES = {
  "desktop.workbench.taskSettings": "Task Settings",
  "desktop.workbench.taskSettingsFolders": "Folders",
  "desktop.workbench.taskNoProject": "No folders yet.",
  "desktop.workbench.addProject": "Add Folder",
  "desktop.workbench.removeProject": "Remove",
  "desktop.common.revealInFinder": "Reveal in Finder"
};

const REPO = "/work/app";

function renderSheet(): { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
  const add = vi.fn();
  const remove = vi.fn();
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
    onLocaleChanged: () => () => undefined
  } as unknown as typeof window.agentResume;
  render(
    <TaskSettingsSheet
      open
      onClose={() => undefined}
      title="Cross-repo feature"
      statusColumn="inbox"
      statusLabel="Inbox"
      projects={[REPO]}
      aliases={{}}
      onAddProject={add}
      onRemoveProject={remove}
      onRevealPath={() => undefined}
    />,
    { wrapper: I18nProvider }
  );
  return { add, remove };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TaskSettingsSheet", () => {
  it("lists the referenced folders with remove and add actions", async () => {
    renderSheet();
    expect(await screen.findByText("app")).toBeTruthy();
    expect(screen.getByText(REPO)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("app")).toBeTruthy(); // removal is the panel's call, not the sheet's
  });

  it("offers adding a folder", async () => {
    const { add } = renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: "Add Folder" }));
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("says so when the task references no folder", async () => {
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
      onLocaleChanged: () => () => undefined
    } as unknown as typeof window.agentResume;
    render(
      <TaskSettingsSheet
        open
        onClose={() => undefined}
        title="Research"
        statusColumn="inbox"
        statusLabel="Inbox"
        projects={[]}
        aliases={{}}
        onAddProject={() => undefined}
        onRemoveProject={() => undefined}
        onRevealPath={() => undefined}
      />,
      { wrapper: I18nProvider }
    );
    expect(await screen.findByText("No folders yet.")).toBeTruthy();
  });
});
