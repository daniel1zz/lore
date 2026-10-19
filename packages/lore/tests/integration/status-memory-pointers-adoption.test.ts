// @spawns packages/lore/src/index.ts
/**
 * `lore status --check-memory-pointers` always enforces: a dangling corpus slug exits exactly 3 and is named, with
 * no project setting that downgrades it to a `WARN adoption=warn` advisory (the retired default,
 * task-memory-file-limits-are-always-enforced-the-warn-adoption; AC-STR-9's warn half is superseded by BR-427).
 *
 * Every scenario spawns the real CLI against a mkdtemp + `lore init` corpus
 * (never this repo's `.lore/`). No mocks.
 *
 * Coverage: HAPPY (a dangling slug exits 3 and is named) / NEGATIVE (no dangling slug -> silent, exit 0) /
 * REGRESSION (no warn banner; different dangling slugs each named, defeating a hardcoded line).
 *
 * @spec_ref spec-claude-md-root-section-structure-check-and-adoption-mode
 * @ac_ref AC-STR-9
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
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

function check(body: string): RunResult {
  writeFileSync(join(dir, "CLAUDE.md"), `${SECTIONS}${body}\n`);
  return runLore(["status", "--check-memory-pointers"], dir);
}

const combined = (r: RunResult): string => `${r.stdout}\n${r.stderr}`;

describe("lore status --check-memory-pointers always enforces (AC-STR-9, BR-427)", () => {
  it("a dangling slug exits exactly 3 and the output names it", () => {
    const r = check(`See \`${DANGLING}\` for details.`);
    expect(r.exitCode).toBe(3);
    expect(combined(r)).toContain(DANGLING);
  });

  it("a different dangling slug is named too (not a hardcoded line)", () => {
    const out = combined(check(`Read \`${DANGLING_OTHER}\` first.`));
    expect(out).toContain(DANGLING_OTHER);
    expect(out).not.toContain(DANGLING);
  });

  it("REGRESSION: the output never carries the retired warn-mode banner", () => {
    expect(combined(check(`See \`${DANGLING}\` for details.`))).not.toMatch(/WARN adoption=warn/);
  });

  it("NEGATIVE: with no dangling slug it exits 0 and prints no slug and no banner", () => {
    const r = check("Nothing but plain prose here.");
    expect(r.exitCode).toBe(0);
    expect(combined(r)).not.toContain(DANGLING);
    expect(combined(r)).not.toMatch(/WARN adoption=warn/);
  });
});
