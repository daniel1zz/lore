// @spawns packages/lore/src/index.ts
/**
 * `lore ac add|set --timeout-ms` writes the AC-level `verify.timeout_ms`
 * (task-skill-implement-r0-11-lore-ac-add-set-timeout-ms-writes; spec-round-0-main-is-green AC-R0-2).
 *
 * Subprocess pattern (commands/ac.ts imports bun:sqlite, unresolvable under vitest): `bun run src/index.ts` in a
 * `mkdtemp` + `lore init` corpus, never this repo's `.lore/`.
 *
 * Dimension mapping:
 *   HAPPY:      add + set store 2000000, read back via `ac list --json`
 *   NEGATIVE:   0 / -5 / 1.5 / abc exit exactly 4 and write nothing; add --mode human --timeout-ms exits 4
 *   BOUNDARY:   `set --timeout-ms ''` removes the field; `add --timeout-ms ''` exits 4
 *   ERROR:      `set --timeout-ms` on an ai-mode criterion exits 4 (mode mismatch)
 *   STATE:      other verify fields (command) survive a timeout-only set
 *   REGRESSION: `lore verify` honours the stored value — sleeping command with timeout_ms 1500 is TIMED OUT
 *
 * @spec_ref AC-R0-2 — spec-round-0-main-is-green-every-red-test-on-e1878626-traced-to
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

function mustRun(args: string[], cwd: string): string {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function extractSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      ...["spec-create", "spec-promote", "plan-promote", "task-claim", '"task-create"'].flatMap((g) => [
        `    ${g}:`,
        "      enabled: false",
      ]),
      "",
    ].join("\n"),
  );
}

/** The `verify` object of criterion `acId`, read back through `lore ac list --json`. */
function readVerify(dir: string, spec: string, acId: string): Record<string, unknown> {
  const text = mustRun(["ac", "list", spec, "--json"], dir);
  const parsed = JSON.parse(text) as { data?: unknown };
  const data = parsed.data as unknown[] | { criteria?: unknown[]; acceptance_criteria?: unknown[] } | undefined;
  const list = (Array.isArray(data) ? data : (data?.criteria ?? data?.acceptance_criteria)) as
    | Array<{ id: string; verify: Record<string, unknown> }>
    | undefined;
  const crit = list?.find((c) => c.id === acId);
  if (!crit) throw new Error(`AC ${acId} not in list output: ${text}`);
  return crit.verify;
}

describe("lore ac add|set --timeout-ms", () => {
  let tmpDir: string;
  let spec: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-ac-timeout-ms-"));
    execFileSync("git", ["init", "-q"], { cwd: tmpDir });
    mustRun(["init"], tmpDir);
    disableAllGates(tmpDir);
    mustRun(["create", "prd", "--title", "Timeout PRD", "--no-ai", "--content", "body"], tmpDir);
    spec = extractSlug(mustRun(["create", "spec", "--title", "Timeout Spec", "--no-ai", "--content", "body"], tmpDir));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  const addScript = (id: string, extra: string[] = []): RunResult =>
    runLore(
      ["ac", "add", spec, id, "--statement", "s", "--mode", "script", "--oracle", "other", "--command", "true", ...extra],
      tmpDir,
    );

  // reason: ~10 CLI spawns at ~1-2s each under load.
  it("HAPPY/STATE/BOUNDARY: add and set store timeout_ms, set '' removes it, command survives", { timeout: 90_000 }, () => {
    expect(addScript("AC-T-1", ["--timeout-ms", "2000000"]).exitCode).toBe(0);
    expect(readVerify(tmpDir, spec, "AC-T-1")["timeout_ms"]).toBe(2000000);

    expect(addScript("AC-T-2").exitCode).toBe(0);
    expect(readVerify(tmpDir, spec, "AC-T-2")["timeout_ms"]).toBeUndefined();
    expect(runLore(["ac", "set", spec, "AC-T-2", "--timeout-ms", "2000000"], tmpDir).exitCode).toBe(0);
    const set = readVerify(tmpDir, spec, "AC-T-2");
    expect(set["timeout_ms"]).toBe(2000000);
    expect(set["command"]).toBe("true");

    expect(runLore(["ac", "set", spec, "AC-T-2", "--timeout-ms", ""], tmpDir).exitCode).toBe(0);
    const cleared = readVerify(tmpDir, spec, "AC-T-2");
    expect(cleared["timeout_ms"]).toBeUndefined();
    expect(cleared["command"]).toBe("true");
  });

  // reason: ~20 CLI spawns.
  it("NEGATIVE/ERROR: non-positive, non-integer, empty-on-add and non-script all exit exactly 4 and write nothing", { timeout: 120_000 }, () => {
    expect(addScript("AC-T-3", ["--timeout-ms", "1000"]).exitCode).toBe(0);
    for (const bad of ["0", "-5", "1.5", "abc"]) {
      const added = addScript(`AC-T-BAD-${bad.replace(/\W/g, "x")}`, ["--timeout-ms", bad]);
      expect(added.exitCode, `add ${bad}`).toBe(4);
      const set = runLore(["ac", "set", spec, "AC-T-3", `--timeout-ms=${bad}`], tmpDir);
      expect(set.exitCode, `set ${bad}`).toBe(4);
      expect(set.stderr).toContain("--timeout-ms");
    }
    expect(readVerify(tmpDir, spec, "AC-T-3")["timeout_ms"]).toBe(1000);
    expect(addScript("AC-T-EMPTY", ["--timeout-ms", ""]).exitCode).toBe(4);

    const human = runLore(["ac", "add", spec, "AC-T-H", "--statement", "s", "--mode", "human", "--timeout-ms", "1000"], tmpDir);
    expect(human.exitCode).toBe(4);

    mustRun(["ac", "add", spec, "AC-T-AI", "--statement", "s", "--mode", "ai", "--rubric", "judge"], tmpDir);
    expect(runLore(["ac", "set", spec, "AC-T-AI", "--timeout-ms", "1000"], tmpDir).exitCode).toBe(4);
  });

  // reason: verify run + ~12 spawns; the sleeping command must be killed at the stored 1500ms, far below the 900s default.
  it("REGRESSION: lore verify honours verify.timeout_ms — a sleeping command is TIMED OUT at that value", { timeout: 120_000 }, () => {
    const acId = "AC-T-SLEEP";
    mustRun(
      ["ac", "add", spec, acId, "--statement", "sleeps", "--mode", "script", "--oracle", "other", "--command", "sleep 60", "--timeout-ms", "1500"],
      tmpDir,
    );
    const planSlug = extractSlug(mustRun(["create", "plan", "--title", "Timeout Plan", "--parent", spec, "--no-ai", "--content", "body"], tmpDir));
    const taskSlug = extractSlug(
      mustRun(["create", "task", "--title", "Timeout Task", "--parent", planSlug, "--plan-id", planSlug, "--ac-scope", acId, "--no-ai", "--content", "body"], tmpDir),
    );
    execFileSync("git", ["add", "-A"], { cwd: tmpDir });
    execFileSync("git", [...GIT_AUTHOR_ARGS, "commit", "-q", "-m", "corpus state"], { cwd: tmpDir });

    const started = Date.now();
    const result = runLore(["verify", planSlug, "--task", taskSlug, "--ac", acId, "--yes"], tmpDir, "timeout-ms-test");
    const elapsedMs = Date.now() - started;

    expect(result.stdout + result.stderr).toContain("TIMED OUT");
    expect(elapsedMs).toBeLessThan(40_000);
  });
});
