// @spawns packages/lore/src/index.ts
/**
 * AC-EH-5 (f) (spec-evidence-labels-and-reds-are-honest, BR-1074) — SURFACE oracle: the REAL CLI
 * `lore verify <plan> --falsify <ac>` refuses a criterion whose STORED falsifier expected exit code is 0 (a legacy
 * declaration made before outcomes had to be 1..255): exit exactly 4, stderr names `--falsifier-exit-code`, and the
 * task's evidence count is unchanged.
 *
 * Subprocess pattern: `bun run src/index.ts` in a `mkdtemp` + `lore init` corpus (never this repo's `.lore/`), as in
 * verify-falsify-green-control.test.ts. The corpus is also a real git repo (the falsifier's scratch worktree is a
 * `git worktree add` of HEAD). The AC is declared through `lore ac add` with a VALID exit code 1 (the writer will
 * refuse 0), then the stored value is flipped to 0 by a DIRECT SQLite update of the throwaway corpus's `docs.extra`
 * (via a `bun -e` child, because `bun:sqlite` is unavailable under vitest).
 *
 * Dimension mapping:
 *   HAPPY:      n/a at the CLI layer — the in-range happy path (stored 1 proceeds) is pinned at the service layer
 *               (falsify-stored-exit-range.test.ts (e)); the AC declaration here proves `ac add` with 1 still works
 *   NEGATIVE:   (f) the stored 0 is refused: exit exactly 4 (validation), not 0/1/2/3
 *   BOUNDARY:   0 is the legacy edge value just outside 1..255
 *   ERROR:      stderr names `--falsifier-exit-code`, the correcting flag
 *   STATE:      the task's evidence array has the same length before and after the refused run
 *   REGRESSION: the plan/task/AC fixture is created through the ordinary writers, so a regression in `ac add` with a
 *               valid falsifier surfaces as a fixture failure rather than a vacuous pass
 *
 * RED-first: against current code the stored 0 runs the control, then the mutation, and the exit is not 4 — an
 * ASSERTION failure on the exit code and the stderr text.
 *
 * @spec_ref spec-evidence-labels-and-reds-are-honest#AC-EH-5 (f) — spec-evidence-labels-and-reds-are-honest; BR-1074
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractEvidence } from "@lore/core";
import type { DocRecord } from "@lore/core";
import { withSessionIdentity } from "../../helpers/session-actor.js";

const GIT_AUTHOR_ARGS = ["-c", "user.email=lore-test@example.com", "-c", "user.name=Lore Test"] as const;

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string, actor: string | null = null): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" }, actor) as Record<string, string>,
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function disableAllGates(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      '    "task-create":',
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

function extractSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function mustRun(args: string[], cwd: string): string {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

/** Flips every stored falsifier `expected_exit_code` of `specSlug` to `value` by a direct SQLite update (bypassing every writer). */
function plantStoredExitCode(dir: string, specSlug: string, value: number): void {
  const script = [
    'import { Database } from "bun:sqlite";',
    "const [dbPath, slug, value] = process.argv.slice(1);",
    "const db = new Database(dbPath, { readwrite: true });",
    'const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug);',
    'if (!row) throw new Error("spec row not found: " + slug);',
    "const extra = JSON.parse(row.extra);",
    "for (const c of extra.acceptance_criteria) c.verify.falsifier.expected_exit_code = Number(value);",
    'db.run("UPDATE docs SET extra = ? WHERE slug = ?", [JSON.stringify(extra), slug]);',
  ].join("\n");
  const r = spawnSync("bun", ["-e", script, join(dir, ".lore", "lore.db"), specSlug, String(value)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`planting stored exit code failed: ${r.stderr}${r.stdout}`);
}

function evidenceCount(dir: string, taskSlug: string): number {
  const got = runLore(["get", taskSlug, "--json"], dir);
  expect(got.exitCode).toBe(0);
  const parsed = JSON.parse(got.stdout) as { data: { doc: DocRecord } };
  return extractEvidence(parsed.data.doc).length;
}

describe("spec-evidence-labels-and-reds-are-honest#AC-EH-5 (f) — lore verify --falsify refuses a stored falsifier exit code of 0", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-falsify-stored-range-"));
    execFileSync("git", ["init", "-q"], { cwd: tmpDir });
    mustRun(["init"], tmpDir);
    disableAllGates(tmpDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  // reason: 25s budget — spawns ~10 real `bun run` CLI subprocesses plus git and one `bun -e` child.
  it("(f) exits exactly 4, stderr names --falsifier-exit-code, and the task's evidence count is unchanged", { timeout: 25_000 }, () => {
    const acId = "AC-RANGE-1";
    mustRun(["create", "prd", "--title", "Stored Range PRD", "--no-ai", "--content", "body"], tmpDir);
    const specSlug = extractSlug(mustRun(["create", "spec", "--title", "Stored Range Spec", "--no-ai", "--content", "body"], tmpDir));
    writeFileSync(join(tmpDir, "dependency.txt"), "hello\n");
    mustRun(
      [
        "ac", "add", specSlug, acId, "--statement", "Declares a falsifier.", "--mode", "script", "--oracle", "other",
        "--command", "cat dependency.txt", "--falsifier-path", "dependency.txt", "--falsifier-find", "hello",
        "--falsifier-replace", "goodbye", "--falsifier-exit-code", "1",
      ],
      tmpDir,
    );
    const planSlug = extractSlug(
      mustRun(["create", "plan", "--title", "Stored Range Plan", "--parent", specSlug, "--no-ai", "--content", "body"], tmpDir),
    );
    const taskSlug = extractSlug(
      mustRun(
        ["create", "task", "--kind", "code", "--title", "Stored Range Task", "--parent", planSlug, "--plan-id", planSlug, "--ac-scope", acId, "--no-ai", "--content", "body"],
        tmpDir,
      ),
    );
    // Commit everything (dependency.txt tracked) so a run that DID proceed would reach a usable control.
    execFileSync("git", ["add", "-A"], { cwd: tmpDir });
    execFileSync("git", [...GIT_AUTHOR_ARGS, "commit", "-q", "-m", "corpus state"], { cwd: tmpDir });

    plantStoredExitCode(tmpDir, specSlug, 0);
    const before = evidenceCount(tmpDir, taskSlug);

    // Measured WITHOUT a pipe — the exit code is spawnSync's own `.status`.
    const result = runLore(["verify", planSlug, "--task", taskSlug, "--falsify", acId], tmpDir, "falsify-range-test");

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("--falsifier-exit-code");
    expect(evidenceCount(tmpDir, taskSlug)).toBe(before);
  });
});
