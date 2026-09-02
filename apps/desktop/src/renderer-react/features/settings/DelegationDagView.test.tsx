import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DelegationDagView, findCycleEdges } from "./DelegationDagView";
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
    callableTemplateIds: ["role_tester"],
    autoDispatch: false,
    createdAtMs: 2,
    updatedAtMs: 2
  },
  {
    templateId: "role_tester",
    name: "Tester",
    persona: "You are Tester.",
    agent: "codex",
    permissions: "read",
    tools: { fsRead: true, fsWrite: false, execute: true },
    callableTemplateIds: ["role_architect"], // forms cycle: Arch -> Dev -> Tester -> Arch
    autoDispatch: false,
    createdAtMs: 3,
    updatedAtMs: 3
  }
];

const mockT = (key: string, fallback?: any) => fallback || key;

describe("findCycleEdges", () => {
  it("detects directed cycles correctly", () => {
    const nodes = [
      { id: "A", edges: ["B"] },
      { id: "B", edges: ["C"] },
      { id: "C", edges: ["A"] },
      { id: "D", edges: [] }
    ];
    const cycles = findCycleEdges(nodes);
    expect(cycles.has("A->B")).toBe(true);
    expect(cycles.has("B->C")).toBe(true);
    expect(cycles.has("C->A")).toBe(true);
    expect(cycles.size).toBe(3);
  });

  it("returns empty set for DAG without cycles", () => {
    const nodes = [
      { id: "A", edges: ["B", "C"] },
      { id: "B", edges: ["D"] },
      { id: "C", edges: ["D"] },
      { id: "D", edges: [] }
    ];
    const cycles = findCycleEdges(nodes);
    expect(cycles.size).toBe(0);
  });
});

describe("DelegationDagView", () => {
  it("renders SVG cards and cycle alerts for cyclical delegation topologies", () => {
    render(
      <DelegationDagView
        templates={mockTemplates}
        t={mockT}
      />
    );

    expect(screen.getByText("Architect")).toBeDefined();
    expect(screen.getByText("Developer")).toBeDefined();
    expect(screen.getByText("Tester")).toBeDefined();
    expect(screen.getByText("Loop Detected (Protected)")).toBeDefined();
  });

  it("supports dragging role cards and resetting layout", () => {
    render(
      <DelegationDagView
        templates={mockTemplates}
        t={mockT}
      />
    );

    const archCard = screen.getByText("Architect").closest(".dag-node-group");
    expect(archCard).toBeDefined();

    // Drag move with synthetic PointerEvents
    fireEvent(archCard!, new MouseEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
    fireEvent(archCard!, new MouseEvent("pointermove", { clientX: 250, clientY: 180, bubbles: true }));
    fireEvent(archCard!, new MouseEvent("pointerup", { clientX: 250, clientY: 180, bubbles: true }));

    // Reset button should now be visible
    const resetBtn = screen.getByText("Reset Layout");
    expect(resetBtn).toBeDefined();

    fireEvent.click(resetBtn);
    expect(screen.queryByText("Reset Layout")).toBeNull();
  });
});
