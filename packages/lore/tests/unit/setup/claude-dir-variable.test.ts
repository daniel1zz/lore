// @spawns packages/lore/src/index.ts
// @reads assets/**
// @reads packages/**
/**
 * AC-CV-7 RED scenarios — the settings-hook claude dir is an invocation
 * variable `{{lore:claude_dir}}` resolved through expandTemplate (spec D7).
 *
 * (a) REGRESSION: a fresh spawned `lore setup` renders every hook command the
 *     PRE-change golden recorded byte-identically (after normalising the
 *     absolute `<HOME>/.claude` path to `<CLAUDE_DIR>`). The oracle is the
 *     rendered command paths, not the whole settings file, so adding a hook
 *     does not break it; a hook that renders differently (or vanishes) does.
 * (b) NEGATIVE: the legacy `{{CLAUDE_DIR}}` token survives in no shipped file.
 * (c) HAPPY: the shipped settings-hook asset carries `{{lore:claude_dir}}`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { RealAssetSource } from "../../../src/adapters/real-asset-source.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../..");
const LORE_ENTRY = join(REPO_ROOT, "packages/lore/src/index.ts");
const FIXTURE = join(REPO_ROOT, "packages/lore/tests/fixtures/context-variables/pre-change-settings.json");
const LEGACY_TOKEN = "{{CLAUDE_DIR}}";

const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

function spawnSetupInFreshHome(): { claudeDir: string; settings: string; status: number | null; log: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "lore-cv7-")));
  homes.push(home);
  const r = spawnSync("bun", [LORE_ENTRY, "setup", "--yes"], {
    // reason: a linked worktree of this repo resolves to the repo's own corpus, which LORE_TEST_SANDBOX refuses;
    // the throwaway home is a corpus-free cwd, so the test passes from any checkout, nested worktree included.
    cwd: home,
    env: { ...process.env, HOME: home },
    encoding: "utf8",
    timeout: 120_000,
  });
  const claudeDir = join(home, ".claude");
  const settings = readFileSync(join(claudeDir, "settings.json"), "utf8");
  return { claudeDir, settings, status: r.status, log: `${r.stdout}${r.stderr}` };
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile() && st.size < 2_000_000) out.push(full);
  }
}

/** Every `command` string anywhere in a settings document, in document order. */
function collectCommands(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const v of node) collectCommands(v, out);
  } else if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "command" && typeof v === "string") out.push(v);
      else collectCommands(v, out);
    }
  }
  return out;
}

/** Golden commands that the rendered (normalised) settings fails to carry verbatim. */
function missingGoldenCommands(renderedNormalised: string, golden: string): string[] {
  const rendered = new Set(collectCommands(JSON.parse(renderedNormalised)));
  return [...new Set(collectCommands(JSON.parse(golden)))].filter((c) => !rendered.has(c));
}

describe("AC-CV-7 claude_dir invocation variable", () => {
  it("AC-CV-7 (a) fresh setup renders every pre-change golden hook command identically after <CLAUDE_DIR> normalisation", () => {
    const { claudeDir, settings, status, log } = spawnSetupInFreshHome();
    expect(status, log).toBe(0);
    const golden = readFileSync(FIXTURE, "utf8");
    const normalised = settings.split(claudeDir).join("<CLAUDE_DIR>");
    expect(missingGoldenCommands(normalised, golden)).toEqual([]);
    // every rendered hook command (including hooks added after the golden) resolves the variable
    for (const c of collectCommands(JSON.parse(normalised))) expect(c).toMatch(/^node <CLAUDE_DIR>\/hooks\/\S+\.mjs/);
    // the golden itself must be normalised (guards against a self-referential fixture)
    expect(golden).toContain("<CLAUDE_DIR>/hooks/");
    expect(golden).not.toContain("{{");
  }, 150_000);

  it("AC-CV-7 (a) falsifier: a command rendered differently from the golden, or a dropped one, is reported", () => {
    const golden = readFileSync(FIXTURE, "utf8");
    expect(missingGoldenCommands(golden, golden)).toEqual([]);
    const drifted = golden.replaceAll(
      "node <CLAUDE_DIR>/hooks/pre-tool-harness-run.mjs",
      "node /elsewhere/hooks/pre-tool-harness-run.mjs",
    );
    expect(missingGoldenCommands(drifted, golden)).toEqual(["node <CLAUDE_DIR>/hooks/pre-tool-harness-run.mjs"]);
  });

  it("AC-CV-7 (b) no file under assets/ or packages/*/src contains the legacy {{CLAUDE_DIR}} token", () => {
    const roots = [join(REPO_ROOT, "assets")];
    for (const pkg of readdirSync(join(REPO_ROOT, "packages"))) {
      const src = join(REPO_ROOT, "packages", pkg, "src");
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        /* package without src */
      }
    }
    const files: string[] = [];
    for (const r of roots) walk(r, files);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((f) => readFileSync(f, "utf8").includes(LEGACY_TOKEN))
      .map((f) => f.slice(REPO_ROOT.length + 1))
      .sort();
    expect(offenders).toEqual([]);
  });

  it("AC-CV-7 (c) the settings-hook asset routes the claude dir through the {{lore:claude_dir}} invocation variable", async () => {
    const loaded = await new RealAssetSource(join(REPO_ROOT, "assets")).load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const hook = loaded.value.files.find((f) => f.kind === "settings-hook");
    expect(hook).toBeDefined();
    const entries = JSON.parse(hook!.content) as { command: string }[];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.command).toContain("{{lore:claude_dir}}/hooks/");
      expect(e.command).not.toContain(LEGACY_TOKEN);
    }
  });

  it("AC-CV-7 (c) a spawned setup resolves the variable to the real target dir (no unresolved braces)", () => {
    const { claudeDir, settings } = spawnSetupInFreshHome();
    expect(settings).toContain(`node ${claudeDir}/hooks/`);
    expect(settings).not.toContain("{{");
  }, 150_000);
});
