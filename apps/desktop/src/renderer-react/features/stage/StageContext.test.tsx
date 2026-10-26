import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { StageProvider, useStage } from "./StageContext";
import type { UIArtifactEnvelope } from "@agent-resume/core";

describe("StageContext", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.stageOpen;
    delete document.documentElement.dataset.stageView;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("provides initial state and syncs to DOM dataset", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StageProvider>{children}</StageProvider>
    );
    const { result } = renderHook(() => useStage(), { wrapper });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.view).toBe("artifact");
    expect(result.current.width).toBeGreaterThanOrEqual(360);
    expect(document.documentElement.dataset.stageOpen).toBe("false");
    expect(document.documentElement.dataset.stageView).toBe("none");
  });

  it("opens, closes, and toggles stage views", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StageProvider>{children}</StageProvider>
    );
    const { result } = renderHook(() => useStage(), { wrapper });

    act(() => {
      result.current.openView("notes");
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.view).toBe("notes");
    expect(document.documentElement.dataset.stageOpen).toBe("true");
    expect(document.documentElement.dataset.stageView).toBe("notes");

    act(() => {
      result.current.closeStage();
    });
    expect(result.current.isOpen).toBe(false);
    expect(document.documentElement.dataset.stageOpen).toBe("false");

    act(() => {
      result.current.toggleStage("schedule");
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.view).toBe("schedule");

    act(() => {
      result.current.toggleStage("schedule");
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("registers, focuses, and removes generative artifacts", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StageProvider>{children}</StageProvider>
    );
    const { result } = renderHook(() => useStage(), { wrapper });

    const mockArtifact: UIArtifactEnvelope = {
      id: "art-1",
      version: "1.0",
      title: "Test Artifact",
      target: "stage",
      kind: "custom:app",
      payload: "<div>test</div>"
    };

    act(() => {
      result.current.registerArtifact(mockArtifact, true);
    });

    expect(result.current.artifacts).toHaveLength(1);
    expect(result.current.activeArtifactId).toBe("art-1");
    expect(result.current.activeArtifact?.title).toBe("Test Artifact");
    expect(result.current.view).toBe("artifact");
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.removeArtifact("art-1");
    });
    expect(result.current.artifacts).toHaveLength(0);
    expect(result.current.activeArtifactId).toBeNull();
  });

  it("handles window events for cross-component triggers", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StageProvider>{children}</StageProvider>
    );
    const { result } = renderHook(() => useStage(), { wrapper });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-resume:stage-open", {
          detail: { view: "sessions" }
        })
      );
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.view).toBe("sessions");

    act(() => {
      window.dispatchEvent(new CustomEvent("agent-resume:stage-close"));
    });
    expect(result.current.isOpen).toBe(false);
  });
});
