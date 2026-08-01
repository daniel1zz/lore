/**
 * `lore red-first <task>` — the CLI author→trip end-to-end oracle for
 * task-red-first-discipline-is-asked-for-in-prose-but-never. Proves the
 * dedicated writer verb actually reaches the COMPILED binary (not just the
 * service layer, already covered by task-workflow-service.test.ts's
 * "red-first discipline floor" suite) and that `lore done` enforces the new
 * floor end to end through real CLI verbs.
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY
 * corpus (mkdtemp + `lore init`) — never touches the repo's own `.lore/`
 * corpus (project CLAUDE.md hard rule). Requires `bun run build` first;
 * `assertFreshBinary` fails loud before any test runs if `dist/lore` is
 * missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src`.
 *
 * Fixture: a single `--adhoc` task (SPEC-069 D2) — deliberately sidesteps the
 * plan→spec→ac-scope chain entirely (this suite's subject is the red-first
 * writer + done()'s new floor, not the task-create/task-claim gates, which
 * have their own dedicated coverage elsewhere).
 *
 * Coverage:
 *   HAPPY:      `red-first` declares the flag (--json round-trips
 *               extra.red_first: true); a red_first task carrying both a
 *               pass AND an expected-fail row archives via `lore done`
 *   NEGATIVE:   a red_first task with ONLY a pass row is refused by `lore
 *               done` (exit 4), naming the task slug and the missing row
 *   BOUNDARY:   declaring red-first twice is idempotent (still true, exit 0
 *               both times)
 *   ERROR:      `lore red-first` on a nonexistent task → exit 3
 *   STATE:      a plain task's `lore done` (no red-first declared) is
 *               UNAFFECTED — succeeds on a pass-only evidence log exactly as
 *               before this feature existed (AC3 control)
 *   REGRESSION: `lore set --red-first` is refused at the strict-flag seam
 *               (exit 2) — there is deliberately no such flag
 *
 * @spec_ref task-red-first-discipline-is-asked-for-in-prose-but-never
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";

setDefaultTimeout(60_000);

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function mustRun(args: string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture command \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}`);
  }
  return result;
}

interface DocJson {
  readonly slug: string;
  readonly extra: Record<string, unknown>;
}

function getDoc(slug: string, cwd: string): DocJson {
  const result = mustRun(["get", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { doc: DocJson } }).data.doc;
}

/** Creates a planless (`--adhoc`) task and returns its slug. */
function createAdhocTask(cwd: string, title: string): string {
  const created = mustRun(
    ["create", "task", "--title", title, "--adhoc", "--content", "body", "--no-ai", "--json"],
    cwd,
  );
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

let tmpDir: string;

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-red-first-"));
  mustRun(["init"], tmpDir);
  // An --adhoc task parents to the corpus root PRD (CorpusService._createImpl) —
  // one must exist first, mirroring every other --adhoc fixture in this repo.
  mustRun(["create", "prd", "--title", "Red First Root", "--content", "## Overview\nroot", "--no-ai"], tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("HAPPY — lore red-first declares the flag and lore done accepts a proven red_first task", () => {
  it("red-first --json round-trips extra.red_first: true", () => {
    const slug = createAdhocTask(tmpDir, "Declare Target");

    const result = mustRun(["red-first", slug, "--json"], tmpDir);
    const parsed = JSON.parse(result.stdout) as { data: { extra: Record<string, unknown> } };
    expect(parsed.data.extra["red_first"]).toBe(true);
    expect(getDoc(slug, tmpDir).extra["red_first"]).toBe(true);
  });

  it("a red_first task with a pass AND an expected-fail row archives via lore done", () => {
    const slug = createAdhocTask(tmpDir, "Proven Red First");
    mustRun(["red-first", slug], tmpDir);
    mustRun(
      ["evidence", slug, "--oracle", "test", "--command", "bunx vitest run --grep new-feature", "--result", "expected-fail"],
      tmpDir,
    );
    mustRun(
      ["evidence", slug, "--oracle", "test", "--command", "bunx vitest run --grep new-feature-again", "--result", "pass"],
      tmpDir,
    );

    const result = runLore(["done", slug], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(getDoc(slug, tmpDir).extra["red_first"]).toBe(true);
  });
});

describe("NEGATIVE — lore done refuses a red_first task holding only a pass row", () => {
  it("exit 4, naming the task slug and the missing expected-fail/fail row", () => {
    const slug = createAdhocTask(tmpDir, "Unproven Red First");
    mustRun(["red-first", slug], tmpDir);
    mustRun(["evidence", slug, "--oracle", "test", "--command", "bun run typecheck", "--result", "pass"], tmpDir);

    const result = runLore(["done", slug], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(slug);
    expect(result.stderr).toMatch(/expected-fail|"fail"/);
  });
});

describe("BOUNDARY — declaring red-first twice is idempotent", () => {
  it("both calls exit 0, flag stays true", () => {
    const slug = createAdhocTask(tmpDir, "Double Declare");

    const first = runLore(["red-first", slug], tmpDir);
    const second = runLore(["red-first", slug], tmpDir);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(getDoc(slug, tmpDir).extra["red_first"]).toBe(true);
  });
});

describe("ERROR — lore red-first on a nonexistent task", () => {
  it("exit 3 (DOC_NOT_FOUND)", () => {
    const result = runLore(["red-first", "task-does-not-exist"], tmpDir);
    expect(result.exitCode).toBe(3);
  });
});

describe("STATE — a plain task (no red-first declared) is unaffected by this feature", () => {
  it("lore done succeeds on pass-only evidence, exactly as before red-first existed", () => {
    const slug = createAdhocTask(tmpDir, "Plain Task");
    mustRun(["evidence", slug, "--oracle", "test", "--command", "bun run typecheck", "--result", "pass"], tmpDir);

    const result = runLore(["done", slug], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(getDoc(slug, tmpDir).extra["red_first"]).toBeUndefined();
  });
});

describe("REGRESSION — lore set gains no --red-first flag", () => {
  it("lore set --red-first exits 2 at the strict-flag seam", () => {
    const slug = createAdhocTask(tmpDir, "Set Rejection Task");

    const result = runLore(["set", slug, "--red-first", "true"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option: --red-first");
  });
});
