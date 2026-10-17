import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { useWorkbenchSearch } from "./useWorkbenchSearch";

const MESSAGES = {
  "desktop.workbench.searchFailed": "Search failed: {0}"
};

const ROOT = "/wt/app-feat-x";

/**
 * A search over one checkout whose folder is gone: main says so the way it does
 * for any unreadable root, and the panel is the one that has to know the
 * difference between a search that failed and a checkout that is no longer there.
 */
function mount(options: { failure: string; handled?: boolean }) {
  const search = vi.fn(async () => {
    throw new Error(`Error invoking remote method 'workbench:searchText': Error: ${options.failure}`);
  });
  const onRootsUnreadable = vi.fn(async () => options.handled ?? false);
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
    onLocaleChanged: () => () => undefined,
    workbenchSearchText: search,
    workbenchSearchTextCancel: async () => ({ ok: true })
  } as unknown as typeof window.agentResume;
  const rendered = renderHook(
    () =>
      useWorkbenchSearch({
        projects: [ROOT],
        projectForPath: (targetPath: string) => (targetPath.startsWith(ROOT) ? ROOT : ""),
        side: "search",
        getDirtyEditorPaths: () => [],
        onStatus: () => undefined,
        onReconcileEditors: () => undefined,
        onOpenSearchSide: () => undefined,
        onRootsUnreadable
      }),
    { wrapper: I18nProvider }
  );
  return { ...rendered, search, onRootsUnreadable };
}

/** Types a query and waits for the debounce to reach the search itself. */
async function searchFor(
  result: { current: { setSearchQuery: (value: string) => void } },
  search: { mock: { calls: unknown[] } }
) {
  act(() => result.current.setSearchQuery("findme"));
  await waitFor(() => expect(search.mock.calls.length).toBeGreaterThan(0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWorkbenchSearch", () => {
  it("says nothing when the checkout it was reading had been removed", async () => {
    const { result, search, onRootsUnreadable } = mount({ failure: `工作目录不存在: ${ROOT}`, handled: true });
    await searchFor(result, search);
    await waitFor(() => expect(onRootsUnreadable).toHaveBeenCalledWith([ROOT]));
    // The panel has put the roots back on the main checkout and the query runs
    // again from there; a folder it picked itself being gone is not a failure.
    await waitFor(() => expect(result.current.searchLoading).toBe(false));
    expect(result.current.searchError).toBe("");
    expect(result.current.searchMatches).toEqual([]);
  });

  it("reports a search that failed with the checkout still in place", async () => {
    const { result, search } = mount({ failure: "permission denied reading src" });
    await searchFor(result, search);
    await waitFor(() => expect(result.current.searchError).toContain("permission denied reading src"));
    expect(result.current.searchError).toContain("Search failed:");
  });
});
