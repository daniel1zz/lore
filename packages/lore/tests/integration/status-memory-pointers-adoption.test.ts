// @spawns packages/lore/src/index.ts
/**
 * RED tests: `lore status --check-memory-pointers` must never be silent under
 * `adoption: warn` (the default when the key is absent).
 *
 * Measured regression (2026-10-07): default warn -> exit 0 with NO output for a
 * dangling corpus slug. Spec: a downgraded finding is still REPORTED, as a line
 * starting `WARN adoption=warn`, while only `enforce` makes it exit-relevant (3).
 *
 * Every scenario spawns the real CLI against a mkdtemp + `lore init` corpus
 * (never this repo's `.lore/`). No mocks.
 *
 * Coverage: HAPPY (warn reports) / NEGATIVE (no dangling slug -> silent) /
 * BOUNDARY (enforce flips exit to 3) / STATE (absent key == explicit warn) /
 * REGRESSION (different dangling slugs each named, defeating a hardcoded line).
 *
 * @spec_ref spec-claude-md-root-section-structure-check-and-adoption-mode
 * @ac_ref AC-STR-9
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

const SECTIONS =
  ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
    .map((name) => `## ${name}\n\nbody of ${name}\n`)
    .join("\n") + "\n";

const DANGLING = "knowledge-this-slug-does-not-exist-anywhere";
const DANGLING_OTHER = "spec-a-completely-different-missing-doc-777";

/** Appends a context.memory_files block to the init-written config; `null` leaves the key absent. */
function setAdoption(dir: string, mode: "enforce" | "warn" | null): void {
  if (mode === null) return;
  const configPath = join(dir, ".lore", "config.yaml");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  if (/^context:/m.test(existing)) {
    throw new Error(`${configPath} already has a context: key; extend this helper`);
  }
  const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(configPath, `${existing}${sep}context:\n  memory_files:\n    adoption: ${mode}\n`);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-mem-pointers-adoption-"));
  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed (exit ${init.exitCode}): ${init.stderr}`);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function check(body: string, mode: "enforce" | "warn" | null): RunResult {
  setAdoption(dir, mode);
  writeFileSync(join(dir, "CLAUDE.md"), `${SECTIONS}${body}\n`);
  return runLore(["status", "--check-memory-pointers"], dir);
}

const combined = (r: RunResult): string => `${r.stdout}\n${r.stderr}`;

describe("lore status --check-memory-pointers under adoption (AC-STR-9)", () => {
  it("absent adoption key: exits exactly 0 for a dangling slug", () => {
    const r = check(`See \`${DANGLING}\` for details.`, null);
    expect(r.exitCode).toBe(0);
  });

  it("absent adoption key: prints a line starting `WARN adoption=warn`", () => {
    const r = check(`See \`${DANGLING}\` for details.`, null);
    const lines = combined(r).split("\n").map((l) => l.trimStart());
    expect(lines.some((l) => l.startsWith("WARN adoption=warn"))).toBe(true);
  });

  it("absent adoption key: output names the dangling slug", () => {
    const r = check(`See \`${DANGLING}\` for details.`, null);
    expect(combined(r)).toContain(DANGLING);
  });

  it("absent adoption key: a different dangling slug is named too (not a hardcoded line)", () => {
    const r = check(`Read \`${DANGLING_OTHER}\` first.`, null);
    const out = combined(r);
    expect(out).toContain(DANGLING_OTHER);
    expect(out).not.toContain(DANGLING);
  });

  it("explicit `adoption: warn` behaves like the absent key: exit 0 and slug named", () => {
    const r = check(`See \`${DANGLING}\` for details.`, "warn");
    expect(r.exitCode).toBe(0);
    expect(combined(r)).toContain(DANGLING);
  });

  it("adoption: enforce: exits exactly 3 for a dangling slug", () => {
    const r = check(`See \`${DANGLING}\` for details.`, "enforce");
    expect(r.exitCode).toBe(3);
  });

  it("adoption: enforce: output names the dangling slug", () => {
    const r = check(`See \`${DANGLING}\` for details.`, "enforce");
    expect(combined(r)).toContain(DANGLING);
  });

  it("adoption: enforce: output does not carry the warn-mode banner", () => {
    const r = check(`See \`${DANGLING}\` for details.`, "enforce");
    expect(combined(r)).not.toMatch(/WARN adoption=warn/);
  });

  it("adoption: warn with no dangling slug: exit 0 and the slug text absent", () => {
    const r = check("Nothing but plain prose here.", "warn");
    expect(r.exitCode).toBe(0);
    expect(combined(r)).not.toContain(DANGLING);
  });

  it("adoption: warn with no dangling slug: no WARN adoption line is printed", () => {
    const r = check("Nothing but plain prose here.", "warn");
    expect(combined(r)).not.toMatch(/WARN adoption=warn/);
  });
});
