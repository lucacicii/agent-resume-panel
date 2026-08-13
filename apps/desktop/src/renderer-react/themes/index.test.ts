import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_DEFINITIONS, applyDesktopAppearance, appearanceStateFromSettings, themeDefinition } from "./index";

describe("built-in visual theme manifests", () => {
  it("ships complete terminal palettes for every official theme", () => {
    for (const definition of Object.values(THEME_DEFINITIONS)) {
      expect(definition.version).toBe("1");
      expect(definition.fonts.body).toBeTruthy();
      expect(definition.fonts.mono).toBeTruthy();
      expect(definition.terminal.background).toMatch(/^#/);
      expect(definition.terminal.foreground).toMatch(/^#/);
      expect(definition.terminal.brightWhite).toBeTruthy();
      expect(definition.componentVariant).toBeTruthy();
      expect(definition.iconVariant).toBeTruthy();
      expect(definition.motion.scanPeriodSeconds).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps DOS tokens above the generic system-dark fallback in the stylesheet cascade", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
    expect(styles).toContain(':root[data-visual-theme="dos"] {');
    expect(styles).toContain(':root:not([data-theme="light"]):not([data-visual-theme]),');
    expect(styles).toContain(':root[data-visual-theme="classic"]:not([data-theme="light"]) {');
    expect(styles).not.toContain(':root:not([data-theme="light"]) {');
  });

  it("keeps only the intermittent click-through monitor fault overlay for full Cyberpunk effects", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
    expect(styles).toContain(':root[data-visual-theme="cyberpunk"][data-theme-effects="full"]::after');
    expect(styles).toContain("@keyframes cyber-monitor-fault");
    expect(styles).toMatch(/z-index:\s*2300;[\s\S]*?pointer-events:\s*none;/);
    expect(styles).not.toContain("cyber-monitor-particles");
    expect(styles).not.toContain("cyber-scan-sweep");
    expect(styles).toContain(':root[data-visual-theme="cyberpunk"][data-theme-effects="reduced"]::after');
    expect(styles).toContain('content: none !important;');
  });

  it("keeps Git commit generation visible as a Cyberpunk scan in full and reduced motion", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
    expect(styles).toContain('.wb-git-commit-auto-btn.is-loading .wb-git-cyber-loading');
    expect(styles).toContain('@keyframes wb-git-cyber-scan');
    expect(styles).toContain('[data-visual-theme="cyberpunk"][data-theme-effects="reduced"] .wb-git-commit-auto-btn.is-loading .wb-git-cyber-loading::after');
    expect(styles).toMatch(/prefers-reduced-motion:[\s\S]*?wb-git-commit-auto-btn\.is-loading \.wb-git-cyber-loading::after/);
  });

  it("styles every visible scrollbar for Cyberpunk and DOS while leaving Classic native", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
    expect(styles).toContain('GLOBAL THEME-AWARE SCROLLBARS');
    expect(styles).toContain(':root[data-visual-theme="cyberpunk"] *::-webkit-scrollbar-thumb');
    expect(styles).toContain(':root[data-visual-theme="dos"] *::-webkit-scrollbar-thumb');
    expect(styles).toContain(':root[data-visual-theme="cyberpunk"][data-theme-effects="reduced"] *::-webkit-scrollbar-thumb');
    expect(styles).toContain('.wb-terminal-tabs-list::-webkit-scrollbar');
    expect(styles).not.toContain(':root[data-visual-theme="classic"] *::-webkit-scrollbar');
  });

  it("preserves the terminal TUI waterdrop geometry in the DOS theme", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
    expect(styles).toContain('[data-visual-theme="dos"] .wb-terminal-tui-drop-shape {');
    expect(styles).toMatch(/\[data-visual-theme="dos"\] \.wb-terminal-tui-drop-shape \{[\s\S]*?filter:\s*none;/);
    expect(styles).toContain('.wb-terminal-tui-drop.is-up .wb-terminal-tui-drop-shape path');
    expect(styles).toContain('.wb-terminal-tui-drop.is-down .wb-terminal-tui-drop-shape path');
  });

  it("gives the terminal TUI waterdrop a theme-specific palette", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
    expect(styles).toMatch(/\.wb-terminal-tui-drop \{[\s\S]*?--tui-drop-color:\s*#22d3ee;/);
    expect(styles).toMatch(/\[data-visual-theme="cyberpunk"\] \.wb-terminal-tui-drop \{[\s\S]*?--tui-drop-color:\s*var\(--cyber-cyan\);[\s\S]*?--tui-drop-hover:\s*var\(--cyber-magenta\);/);
    expect(styles).toMatch(/\[data-visual-theme="dos"\] \.wb-terminal-tui-drop \{[\s\S]*?--tui-drop-color:\s*#f3b94f;[\s\S]*?--tui-drop-hover:\s*#ffe2a0;/);
  });

  it("uses the warm amber phosphor palette for DOS surfaces and terminal ANSI colors", () => {
    const dos = THEME_DEFINITIONS.dos;
    expect(dos.tokens["--theme-cut"]).toBe("0px");
    expect(dos.terminal).toMatchObject({
      background: "#17120d",
      foreground: "#f0d7a0",
      blue: "#b08b5a",
      brightBlue: "#d0a46b"
    });
    expect(dos.terminal.blue).not.toBe("#5555ff");
  });

  it("applies the host-controlled Night City variants to the document root", () => {
    const state = appearanceStateFromSettings({ desktop: { visualTheme: "cyberpunk", themeEffects: "full" } });
    applyDesktopAppearance(state);
    expect(document.documentElement.dataset).toMatchObject({
      visualTheme: "cyberpunk", appearance: "dark", density: "relaxed",
      themeComponentVariant: "night-city", themeIconVariant: "hud"
    });
  });

  it("falls back safely to Classic and enforces dark-only appearances", () => {
    expect(themeDefinition("untrusted-package").id).toBe("classic");
    const state = appearanceStateFromSettings({ desktop: { visualTheme: "cyberpunk", theme: "light" } });
    expect(state).toMatchObject({ visualTheme: "cyberpunk", appearance: "dark", density: "relaxed" });
    expect(THEME_DEFINITIONS.cyberpunk).toMatchObject({
      componentVariant: "night-city",
      iconVariant: "hud",
      motion: { ambient: true, interactionGlitch: true, scanPeriodSeconds: 7 }
    });
  });
});
