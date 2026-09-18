import { afterEach, describe, expect, it } from "vitest";
import { resetSharedGitQueries, shareGitQuery } from "./gitQueryShare";

describe("shared git queries", () => {
  afterEach(() => {
    resetSharedGitQueries();
  });

  it("runs one query for every window that asks at the same time", async () => {
    let started = 0;
    let release: (value: string) => void = () => undefined;
    const run = async (): Promise<string> => {
      started += 1;
      return new Promise<string>((resolve) => { release = resolve; });
    };

    const first = shareGitQuery("status\0/work/app", run);
    const second = shareGitQuery("status\0/work/app", run);
    const third = shareGitQuery("status\0/work/app", run);
    expect(started).toBe(1);

    release("clean");
    await expect(Promise.all([first, second, third])).resolves.toEqual(["clean", "clean", "clean"]);
  });

  it("does not answer a later request from an older one", async () => {
    let calls = 0;
    const run = async (): Promise<number> => {
      calls += 1;
      return calls;
    };

    expect(await shareGitQuery("status\0/work/app", run)).toBe(1);
    expect(await shareGitQuery("status\0/work/app", run)).toBe(2);
    expect(calls).toBe(2);
  });

  it("keeps repositories apart and forgets failed queries", async () => {
    let calls = 0;
    const run = async (): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new Error("git unavailable");
      return "ok";
    };

    await expect(shareGitQuery("status\0/work/app", run)).rejects.toThrow("git unavailable");
    // A failure is not remembered: the next window retries.
    await expect(shareGitQuery("status\0/work/app", run)).resolves.toBe("ok");
    await expect(shareGitQuery("status\0/work/api", run)).resolves.toBe("ok");
    expect(calls).toBe(3);
  });
});
