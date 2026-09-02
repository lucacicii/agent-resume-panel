import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DelegationMatrixGrid } from "./DelegationMatrixGrid";
import type { ImRoleTemplate } from "../../../shared/imTypes";

afterEach(cleanup);

const mockTemplates: ImRoleTemplate[] = [
  {
    templateId: "role_architect",
    name: "Architect",
    persona: "You are Architect.",
    agent: "claude",
    permissions: "read",
    tools: { fsRead: true, fsWrite: false, execute: false },
    callableTemplateIds: ["role_developer"],
    autoDispatch: true,
    source: "builtin",
    createdAtMs: 1,
    updatedAtMs: 1
  },
  {
    templateId: "role_developer",
    name: "Developer",
    persona: "You are Developer.",
    agent: "claude",
    permissions: "write",
    tools: { fsRead: true, fsWrite: true, execute: true },
    callableTemplateIds: [],
    autoDispatch: false,
    source: "builtin",
    createdAtMs: 2,
    updatedAtMs: 2
  },
  {
    templateId: "project_role_dba",
    name: "DBA Specialist",
    persona: "You are DBA.",
    agent: "pi",
    permissions: "write",
    tools: { fsRead: true, fsWrite: true, execute: true },
    callableTemplateIds: ["role_developer"],
    autoDispatch: false,
    source: "project",
    createdAtMs: 3,
    updatedAtMs: 3
  }
];

const mockT = (key: string, fallback?: any) => fallback || key;

describe("DelegationMatrixGrid", () => {
  it("renders rows and columns for all role templates with badges", () => {
    render(
      <DelegationMatrixGrid
        templates={mockTemplates}
        t={mockT}
        onUpdateTemplate={vi.fn()}
      />
    );

    expect(screen.getAllByText("Architect").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Developer").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("DBA Specialist").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Repo").length).toBeGreaterThanOrEqual(1);
  });

  it("calls onUpdateTemplate when toggling a delegation connection cell", async () => {
    const onUpdate = vi.fn(async () => undefined);
    render(
      <DelegationMatrixGrid
        templates={mockTemplates}
        t={mockT}
        onUpdateTemplate={onUpdate}
      />
    );

    // Toggle Architect -> DBA connection
    const toggleBtns = screen.getAllByRole("button");
    const cellBtn = toggleBtns.find((btn) => btn.getAttribute("title")?.includes("Architect → DBA Specialist"));
    expect(cellBtn).toBeDefined();

    fireEvent.click(cellBtn!);
    expect(onUpdate).toHaveBeenCalledWith({
      templateId: "role_architect",
      callableTemplateIds: ["role_developer", "project_role_dba"]
    });
  });

  it("calls onUpdateTemplate when toggling Auto-Dispatch on a caller row", () => {
    const onUpdate = vi.fn(async () => undefined);
    render(
      <DelegationMatrixGrid
        templates={mockTemplates}
        t={mockT}
        onUpdateTemplate={onUpdate}
      />
    );

    // Click Developer auto-dispatch button
    const autoBtns = screen.getAllByTitle("Toggle Auto-Dispatch");
    expect(autoBtns.length).toBe(3);

    fireEvent.click(autoBtns[1]!); // Developer
    expect(onUpdate).toHaveBeenCalledWith({
      templateId: "role_developer",
      autoDispatch: true
    });
  });
});
