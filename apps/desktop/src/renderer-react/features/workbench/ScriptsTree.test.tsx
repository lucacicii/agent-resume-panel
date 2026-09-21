import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptsTree, type ScriptEntryView, type ScriptPackageView } from "./ScriptsTree";

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key })
}));

const pkg: ScriptPackageView = {
  id: "pkg-1",
  kind: "npm",
  packageRoot: "/work/app",
  relativeRoot: "",
  label: "app",
  manifestPath: "/work/app/package.json",
  scripts: [
    { id: "s-dev", name: "dev", run: { cwd: "/work/app", command: "pnpm dev" } },
    { id: "s-build", name: "build", run: { cwd: "/work/app", command: "pnpm build" } }
  ]
};

function scriptRow(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name}$`) });
}

afterEach(cleanup);

describe("ScriptsTree", () => {
  it("runs a script on click", () => {
    const onRun = vi.fn();
    render(<ScriptsTree packages={[pkg]} hasProject onRun={onRun} />);
    fireEvent.click(scriptRow("dev"));
    expect(onRun).toHaveBeenCalledWith(
      pkg.scripts[0],
      expect.objectContaining({ id: "pkg-1" })
    );
  });

  it("hands a right-clicked script to the context-menu handler", () => {
    const onScriptContextMenu = vi.fn();
    render(
      <ScriptsTree
        packages={[pkg]}
        hasProject
        onRun={vi.fn()}
        onScriptContextMenu={onScriptContextMenu}
      />
    );
    fireEvent.contextMenu(scriptRow("build"));
    expect(onScriptContextMenu).toHaveBeenCalledTimes(1);
    const [, scripts] = onScriptContextMenu.mock.calls[0] as unknown as [
      { clientX: number; clientY: number },
      ScriptEntryView[]
    ];
    expect(scripts.map((script) => script.id)).toEqual(["s-build"]);
    expect(scripts[0].run.command).toBe("pnpm build");
  });

  it("offers the whole package when a group row is right-clicked", () => {
    const onScriptContextMenu = vi.fn();
    const { container } = render(
      <ScriptsTree
        packages={[pkg]}
        hasProject
        onRun={vi.fn()}
        onScriptContextMenu={onScriptContextMenu}
      />
    );
    fireEvent.contextMenu(container.querySelector(".wb-scripts-group-row")!);
    expect(onScriptContextMenu).toHaveBeenCalledTimes(1);
    const [, scripts] = onScriptContextMenu.mock.calls[0] as unknown as [
      { clientX: number; clientY: number },
      ScriptEntryView[]
    ];
    expect(scripts.map((script) => script.id)).toEqual(["s-dev", "s-build"]);
  });

  it("leaves the default menu alone when no handler is given", () => {
    render(<ScriptsTree packages={[pkg]} hasProject onRun={vi.fn()} />);
    // No throw: the row simply keeps the browser default behavior.
    fireEvent.contextMenu(scriptRow("dev"));
    expect(scriptRow("dev")).toBeTruthy();
  });
});
