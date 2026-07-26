import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listWorkbenchScripts } from "./workbenchScripts";

const tempRoots: string[] = [];

function makeTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-scripts-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("listWorkbenchScripts", () => {
  it("discovers npm scripts and prefers pnpm from lockfile", () => {
    const root = makeTemp();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "demo",
        scripts: { dev: "vite", build: "tsc", preview: "vite preview" }
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const result = listWorkbenchScripts(root);
    expect(result.packages).toHaveLength(1);
    const pkg = result.packages[0];
    expect(pkg.kind).toBe("pnpm");
    expect(pkg.scripts.map((s) => s.name).sort()).toEqual(["build", "dev", "preview"]);
    expect(pkg.scripts.find((s) => s.name === "dev")?.run.command).toBe("pnpm run 'dev'");
    expect(pkg.scripts.find((s) => s.name === "dev")?.run.cwd).toBe(path.resolve(root));
  });

  it("groups monorepo packages by path and ignores node_modules", () => {
    const root = makeTemp();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { compile: "tsc" } }),
      "utf8"
    );
    fs.mkdirSync(path.join(root, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "apps", "web", "package.json"),
      JSON.stringify({ scripts: { start: "next start" } }),
      "utf8"
    );
    fs.mkdirSync(path.join(root, "node_modules", "left-pad"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "node_modules", "left-pad", "package.json"),
      JSON.stringify({ scripts: { evil: "true" } }),
      "utf8"
    );

    const result = listWorkbenchScripts(root);
    const roots = result.packages.map((p) => p.relativeRoot).sort();
    expect(roots).toEqual([".", "apps/web"]);
    expect(result.packages.every((p) => !p.packageRoot.includes("node_modules"))).toBe(true);
  });

  it("parses Makefile targets and coexists with package.json", () => {
    const root = makeTemp();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }), "utf8");
    fs.writeFileSync(
      path.join(root, "Makefile"),
      [".PHONY: all proto", "all: proto", "proto:", "\techo proto", "clean:", "\trm -rf out"].join("\n"),
      "utf8"
    );

    const result = listWorkbenchScripts(root);
    const kinds = result.packages.map((p) => p.kind).sort();
    expect(kinds).toEqual(["make", "npm"]);
    const make = result.packages.find((p) => p.kind === "make");
    expect(make?.scripts.map((s) => s.name).sort()).toEqual(["all", "clean", "proto"]);
  });

  it("detects gradle wrapper and common tasks", () => {
    const root = makeTemp();
    fs.writeFileSync(path.join(root, "build.gradle.kts"), 'tasks.register("customTask") {}\n', "utf8");
    fs.writeFileSync(path.join(root, "gradlew"), "#!/bin/sh\n", "utf8");

    const result = listWorkbenchScripts(root);
    expect(result.packages).toHaveLength(1);
    const gradle = result.packages[0];
    expect(gradle.kind).toBe("gradle");
    expect(gradle.managerHint).toBe("gradlew");
    expect(gradle.scripts.some((s) => s.name === "build")).toBe(true);
    expect(gradle.scripts.some((s) => s.name === "customTask")).toBe(true);
    expect(gradle.scripts.find((s) => s.name === "build")?.run.command).toContain("./gradlew");
  });

  it("parses pyproject poetry scripts", () => {
    const root = makeTemp();
    fs.writeFileSync(
      path.join(root, "pyproject.toml"),
      [
        "[project]",
        'name = "demo"',
        "[tool.poetry]",
        'name = "demo"',
        "[tool.poetry.scripts]",
        'train = "demo.cli:main"',
        'serve = "demo.server:run"'
      ].join("\n"),
      "utf8"
    );

    const result = listWorkbenchScripts(root);
    expect(result.packages).toHaveLength(1);
    const py = result.packages[0];
    expect(py.kind).toBe("python");
    expect(py.managerHint).toBe("poetry");
    expect(py.scripts.map((s) => s.name).sort()).toEqual(["serve", "train"]);
    expect(py.scripts.find((s) => s.name === "train")?.run.command).toBe("poetry run 'train'");
  });

  it("parses Cargo.toml bins", () => {
    const root = makeTemp();
    fs.writeFileSync(
      path.join(root, "Cargo.toml"),
      [
        "[package]",
        'name = "demo"',
        'version = "0.1.0"',
        "[[bin]]",
        'name = "tool"',
        'path = "src/main.rs"'
      ].join("\n"),
      "utf8"
    );

    const result = listWorkbenchScripts(root);
    expect(result.packages).toHaveLength(1);
    const cargo = result.packages[0];
    expect(cargo.kind).toBe("cargo");
    expect(cargo.scripts.some((s) => s.name === "build")).toBe(true);
    expect(cargo.scripts.some((s) => s.name === "run:tool")).toBe(true);
  });

  it("rejects missing project root", () => {
    expect(() => listWorkbenchScripts(path.join(os.tmpdir(), "no-such-wb-scripts-dir"))).toThrow(
      /不存在/
    );
  });
});
