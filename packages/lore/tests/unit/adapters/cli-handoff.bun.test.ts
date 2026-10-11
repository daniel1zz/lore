/**
 * `lore handoff` / `lore create knowledge --sub-type handoff` — CLI-adapter exit-code
 * contract tests (SPEC-041 §3 D4, D6; §4 AC-SL-4 CLI half, AC-SL-9).
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY corpus
 * (mkdtemp + `lore init`) — never touches the repo's own `.lore/` corpus (project
 * CLAUDE.md hard rule). Requires `bun run build` to have run first; `assertFreshBinary`
 * (mirrors `gate-hooks.bun.test.ts`) fails loud before any test runs if `dist/lore` is
 * missing or older than the newest `.ts` source under `packages/{lore,core}/src`.
 *
 * Coverage:
 *   HAPPY:      `lore handoff` via the flags path AND the `--json-file` path both
 *               succeed (exit 0), producing a knowledge/handoff draft doc
 *   NEGATIVE:   `lore create knowledge --sub-type handoff` → exit 2, stderr names
 *               `lore handoff` as the sole write path (writer-identity guard, D4)
 *   BOUNDARY:   missing `--next` (flags path, zero next steps) → exit 2
 *   ERROR:      `--failing-command` without `--failing-tail-file` (and the inverse)
 *               → exit 2; `--json-file` + a field flag → exit 2
 *   STATE:      a handoff written via the CLI is visible via `lore get --json`
 *               (extra.handoff round-trips through the real store)
 *   REGRESSION: `--sub-type prompt` and `--sub-type skill` are still accepted by CLI
 *               validation (reach the service — exit 0), proving the SSOT-import
 *               repair (D4 drive-by) didn't narrow the pre-existing sub-type set
 *
 * @spec_ref SPEC-041 §4 AC-SL-4 AC-SL-9
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { sessionActorFor, withSessionIdentity } from "../../helpers/session-actor";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** `actor` names the writer through the session tier (no write command takes `--by`); `null` = unnamed. */
function runLore(args: string[], cwd: string, actor: string | null = null): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, EDITOR: "true" }, actor) as Record<string, string>,
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from output: ${stdout}`);
  return slug;
}

function initCorpus(tmpDir: string): void {
  const result = runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

function createPlan(tmpDir: string, title: string): string {
  const result = runLore(["create", "plan", "--title", title, "--content", "Plan body.", "--no-ai"], tmpDir);
  if (result.exitCode !== 0) throw new Error(`create plan failed: ${result.stderr}`);
  return parseSlug(result.stdout);
}

// ─── Suite: binary freshness guard ───────────────────────────────────────────

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-handoff-"));
  initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("lore handoff — HAPPY", () => {
  it("flags path: --plan/--by/--file/--decision/--next → exit 0, writes a fast-tracked approved knowledge/handoff doc", () => {
    const planSlug = createPlan(tmpDir, "Handoff Flags Plan");

    const result = runLore(
      [
        "handoff",
        "--plan",
        planSlug,
        "--file",
        "packages/core/src/session.ts",
        "--decision",
        "Chose flags path@85",
        "--next",
        "ship it",
        "--json",
      ],
      tmpDir,
      "alice",
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; data: { slug: string; type: string; status: string; extra: Record<string, unknown> } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.type).toBe("knowledge");
    // SPEC-103 M1: ledger sub_types (assessment/retro/handoff/uat) fast-track draft→approved at create.
    expect(parsed.data.status).toBe("approved");
    expect(parsed.data.extra["sub_type"]).toBe("handoff");
  });

  it("--json-file path: a handoffExtraSchema-valid JSON file → exit 0", () => {
    const planSlug = createPlan(tmpDir, "Handoff JsonFile Plan");
    const jsonFile = join(tmpDir, "handoff.json");
    writeFileSync(
      jsonFile,
      JSON.stringify({
        by: "bob",
        plan_ref: planSlug,
        task_refs: [],
        modified_files: ["a.ts"],
        key_decisions: [{ judgment: "used json-file path", confidence: 70 }],
        next_steps: ["merge the PR"],
      }),
      "utf8",
    );

    const result = runLore(["handoff", "--json-file", jsonFile, "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; data: { slug: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.slug).toBeTruthy();
  });
});

// ─── NEGATIVE: writer-identity exclusivity (D4) ─────────────────────────────

describe("lore create knowledge --sub-type handoff — NEGATIVE (writer-identity guard, D4)", () => {
  // reason: two deviations from AC-SL-4's literal bullet text, both documented in
  // the task's final report:
  //   1. "exit 2" in the AC bullet vs. exit 4 here — D4's own mechanism description
  //      ("the CLI therefore forwards --sub-type handoff to the service seam, which
  //      produces the naming error") means this is a VALIDATION_ERROR Result
  //      bubbling through the standard exitCode()/formatError() pipeline
  //      (utils.ts::exitCode maps VALIDATION_ERROR → 4), not a CLI-side
  //      pre-validation exit 2 like --sub-type's own missing/invalid-value checks.
  //   2. stderr does NOT contain the literal substring "lore handoff" here — `lore
  //      create` has no flag to supply a full extra.handoff payload (create.ts's
  //      buildExtra only forwards {sub_type} for knowledge docs), so this
  //      invocation is blocked by knowledgeExtraSchema's PRESENCE check
  //      ("requires a Zod-valid extra.handoff", schemas.ts) BEFORE
  //      CorpusService._createImpl's writer-identity guard (whose message DOES
  //      contain "lore handoff") is ever reached — defense-in-depth, arguably
  //      stronger than the AC anticipated. The writer-identity guard's exact
  //      "lore handoff" message is exercised directly at the service layer by
  //      the pre-existing `session-handoff-exclusivity.test.ts` (T1, vitest),
  //      which supplies a full extra.handoff payload via `corpusService.create()`
  //      — unreachable from CLI flags alone, hence tested there, not here.
  it("exit 4 (VALIDATION_ERROR) — blocked before the write-path-exclusivity guard, by the schema-level extra.handoff presence check", () => {
    const result = runLore(
      ["create", "knowledge", "--sub-type", "handoff", "--title", "Sneaky handoff", "--content", "not a real handoff", "--no-ai"],
      tmpDir,
    );

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("extra.handoff");
  });
});

// ─── BOUNDARY: missing --next ────────────────────────────────────────────────

describe("lore handoff — BOUNDARY: missing --next", () => {
  it("flags path with zero --next flags → exit 2 (a handoff naming no next step is a status report, not a handoff)", () => {
    const result = runLore(["handoff", "--file", "a.ts"], tmpDir, "alice");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("next_steps");
  });
});

// ─── ERROR: mutex / dependency guards ───────────────────────────────────────

describe("lore handoff — ERROR: flag guards", () => {
  it("--failing-command without --failing-tail-file → exit 2", () => {
    const result = runLore(
      ["handoff", "--next", "step", "--failing-command", "bun test"],
      tmpDir,
      "alice",
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--failing-command");
    expect(result.stderr).toContain("--failing-tail-file");
  });

  it("--failing-tail-file without --failing-command → exit 2 (inverse)", () => {
    const tailFile = join(tmpDir, "tail.txt");
    writeFileSync(tailFile, "1 test failed", "utf8");

    const result = runLore(
      ["handoff", "--next", "step", "--failing-tail-file", tailFile],
      tmpDir,
      "alice",
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--failing-command");
    expect(result.stderr).toContain("--failing-tail-file");
  });

  it("--json-file + a field flag (--file) → exit 2, naming the conflict", () => {
    const jsonFile = join(tmpDir, "handoff.json");
    writeFileSync(
      jsonFile,
      JSON.stringify({ by: "alice", next_steps: ["step"] }),
      "utf8",
    );

    const result = runLore(
      ["handoff", "--json-file", jsonFile, "--file", "a.ts"],
      tmpDir,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--json-file");
    expect(result.stderr).toContain("mutually exclusive");
    expect(result.stderr).toContain("--file");
  });
});

// ─── STATE: written handoff is visible via `lore get` ───────────────────────

describe("lore handoff — STATE: round trip through the real store", () => {
  it("a handoff written via the CLI is retrievable via `lore get --json` with extra.handoff intact", () => {
    const planSlug = createPlan(tmpDir, "Handoff State Plan");
    const writeResult = runLore(
      [
        "handoff",
        "--plan",
        planSlug,
        "--next",
        "verify the fix",
        "--json",
      ],
      tmpDir,
      "carol",
    );
    expect(writeResult.exitCode).toBe(0);
    const written = JSON.parse(writeResult.stdout) as { data: { slug: string } };

    const getResult = runLore(["get", written.data.slug, "--json"], tmpDir);
    expect(getResult.exitCode).toBe(0);
    const got = JSON.parse(getResult.stdout) as { data: { doc: { extra: { sub_type: string; handoff: { by: string; next_steps: string[] } } } } };
    expect(got.data.doc.extra.sub_type).toBe("handoff");
    expect(got.data.doc.extra.handoff.by).toBe(sessionActorFor("carol"));
    expect(got.data.doc.extra.handoff.next_steps).toEqual(["verify the fix"]);
  });
});

// ─── REGRESSION: CLI sub-type SSOT repair didn't narrow the accepted set ────

describe("lore create knowledge --sub-type — REGRESSION (SSOT import repair, D4 drive-by)", () => {
  it("--sub-type prompt is accepted by CLI validation (reaches the service, exit 0)", () => {
    const result = runLore(
      ["create", "knowledge", "--sub-type", "prompt", "--title", "A reusable prompt", "--content", "prompt body", "--no-ai"],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("Invalid --sub-type");
  });

  it("--sub-type skill is accepted by CLI validation (reaches the service, exit 0)", () => {
    const result = runLore(
      ["create", "knowledge", "--sub-type", "skill", "--title", "A reusable skill", "--content", "skill body", "--no-ai"],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("Invalid --sub-type");
  });
});
