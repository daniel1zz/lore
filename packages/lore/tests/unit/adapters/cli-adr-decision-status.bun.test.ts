// @spawns dist/lore
/**
 * `lore set --decision-status accepted` — CLI-adapter exit-code + wiring contract tests
 * (spec-adr-decision-status-has-a-create-surface-and-no-cli-update, AC-DS-1..7).
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY corpus
 * (mkdtemp + `lore init`) — NEVER the repo's own `.lore/` corpus (project CLAUDE.md hard
 * rule). `assertFreshBinary` (mirrors `cli-invalidate.bun.test.ts`) fails loud before any
 * test runs if `dist/lore` is missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src` — requires `bun run build` to have run first.
 *
 * The closed value-set decision (accepted-only; deprecated/superseded routed to
 * `lore invalidate`; anything else refused) is unit-tested standalone at
 * `tests/unit/cli/decision-status-validation.test.ts` (AC-DS-8, pure vitest). This suite
 * covers the CLI WIRING: type-scoping, the read-merge-write patch shape, the no-demotion
 * carve-out, and idempotence — behaviour only observable by spawning the real command
 * against a real store.
 *
 * Six-dimension coverage:
 *   HAPPY:      AC-DS-1 — create --decision-status proposed, accept, `get --json` reports
 *               extra.decision_status === "accepted" (author→read end-to-end)
 *   NEGATIVE:   AC-DS-2 — the writer against a non-adr document exits 4 naming the actual type
 *   ERROR:      AC-DS-3 — aiming at "deprecated"/"superseded" exits 2 naming `lore invalidate`
 *               AC-DS-7 — an unrecognised value exits 2 listing the accepted value
 *   REGRESSION: AC-DS-4 — accepting an `approved` adr leaves status "approved" (no draft demotion)
 *   STATE:      AC-DS-5 — an unrelated extra key survives the accept, byte-identical
 *   BOUNDARY:   AC-DS-6 — two consecutive accepts both exit 0; version advances exactly once
 *
 * @spec_ref spec-adr-decision-status-has-a-create-surface-and-no-cli-update
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";

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

/** Parses the `slug` field out of a `--json` create envelope (`{ok, data: {slug, ...}}`). */
function parseJsonSlug(stdout: string): string {
  const parsed = JSON.parse(stdout) as { data: { slug: string } };
  return parsed.data.slug;
}

function initCorpus(tmpDir: string): void {
  const result = runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

function createAdr(
  tmpDir: string,
  title: string,
  decisionStatus: "proposed" | "accepted" = "proposed",
): string {
  const result = runLore(
    [
      "create",
      "adr",
      "--title",
      title,
      "--decision-status",
      decisionStatus,
      "--no-ai",
      "--content",
      "Body.",
      "--json",
    ],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create adr failed: ${result.stderr}`);
  return parseJsonSlug(result.stdout);
}

function createKnowledge(tmpDir: string, title: string): string {
  const result = runLore(
    [
      "create",
      "knowledge",
      "--title",
      title,
      "--sub-type",
      "reference",
      "--no-ai",
      "--content",
      "Body.",
      "--json",
    ],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create knowledge failed: ${result.stderr}`);
  return parseJsonSlug(result.stdout);
}

interface DocJsonEnvelope {
  data: {
    doc: {
      status: string;
      version: number;
      extra: Record<string, unknown>;
    };
  };
}

function getDoc(tmpDir: string, slug: string): DocJsonEnvelope["data"]["doc"] {
  const result = runLore(["get", slug, "--json"], tmpDir);
  if (result.exitCode !== 0) throw new Error(`get failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as DocJsonEnvelope).data.doc;
}

/**
 * Directly writes an unrelated key into a doc's `extra` JSON column via a raw SQLite
 * connection to the throwaway corpus (bypassing CorpusService entirely — there is no CLI
 * writer for an arbitrary extra key, by design; see the spec's Options §3 rejection of a
 * general `lore set --extra`). This is a TEST-ONLY seeding technique to construct the
 * "unrelated extra key" fixture AC-DS-5 requires; it never touches the repo's own corpus
 * (only ever the mkdtemp throwaway one) and stays entirely within this test file.
 */
function seedUnrelatedExtraKey(tmpDir: string, slug: string, key: string, value: unknown): void {
  const dbPath = join(tmpDir, ".lore", "lore.db");
  const db = new Database(dbPath);
  try {
    const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as
      | { extra: string }
      | null;
    if (!row) throw new Error(`seedUnrelatedExtraKey: no doc found for slug ${slug}`);
    const extra = JSON.parse(row.extra) as Record<string, unknown>;
    extra[key] = value;
    db.query("UPDATE docs SET extra = ? WHERE slug = ?").run(JSON.stringify(extra), slug);
  } finally {
    db.close();
  }
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
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-adr-decision-status-"));
  initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── HAPPY: AC-DS-1 accept end-to-end ────────────────────────────────────────

describe("lore set --decision-status accepted — HAPPY", () => {
  it("AC-DS-1: accept end-to-end — proposed ADR, accept writer, get --json reports accepted", () => {
    const slug = createAdr(tmpDir, "Proposed Decision For Accept E2E", "proposed");

    const before = getDoc(tmpDir, slug);
    expect(before.extra["decision_status"]).toBe("proposed");

    const setResult = runLore(["set", slug, "--decision-status", "accepted", "--json"], tmpDir);
    expect(setResult.exitCode).toBe(0);

    const after = getDoc(tmpDir, slug);
    expect(after.extra["decision_status"]).toBe("accepted");
  });
});

// ─── NEGATIVE: AC-DS-2 non-adr target ────────────────────────────────────────

describe("lore set --decision-status accepted — NEGATIVE", () => {
  it("AC-DS-2: non-adr target exits 4 and stderr names the target's actual type", () => {
    const slug = createKnowledge(tmpDir, "Not An ADR Target");

    const result = runLore(["set", slug, "--decision-status", "accepted"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("knowledge");
  });
});

// ─── ERROR: AC-DS-3 owned transition, AC-DS-7 unrecognised value ────────────

describe("lore set --decision-status accepted — ERROR", () => {
  it("AC-DS-3: aiming at deprecated or superseded exits 2 and names lore invalidate", () => {
    const slug = createAdr(tmpDir, "Owned Transition Target", "proposed");

    const deprecatedResult = runLore(["set", slug, "--decision-status", "deprecated"], tmpDir);
    expect(deprecatedResult.exitCode).toBe(2);
    expect(deprecatedResult.stderr).toContain("lore invalidate");

    const supersededResult = runLore(["set", slug, "--decision-status", "superseded"], tmpDir);
    expect(supersededResult.exitCode).toBe(2);
    expect(supersededResult.stderr).toContain("lore invalidate");
  });

  it("AC-DS-7: an unknown decision-status value exits 2 and lists the accepted value", () => {
    const slug = createAdr(tmpDir, "Unknown Value Target", "proposed");

    const result = runLore(["set", slug, "--decision-status", "bogus"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("accepted");
  });
});

// ─── REGRESSION: AC-DS-4 no draft demotion ──────────────────────────────────

describe("lore set --decision-status accepted — REGRESSION", () => {
  it("AC-DS-4: accepting an approved ADR leaves status approved (no draft demotion)", () => {
    const slug = createAdr(tmpDir, "Approved ADR No Demotion", "proposed");

    // BR-1071: `set --status approved` is an approval and an unjudged ADR is refused (exit 4); this case is
    // about the decision-status write after approval, not about judging, so it approves with the audited override.
    const promoteResult = runLore(["approve", slug, "--override-no-judgment"], tmpDir);
    expect(promoteResult.exitCode).toBe(0);
    expect(getDoc(tmpDir, slug).status).toBe("approved");

    const acceptResult = runLore(["set", slug, "--decision-status", "accepted"], tmpDir);
    expect(acceptResult.exitCode).toBe(0);

    const after = getDoc(tmpDir, slug);
    expect(after.status).toBe("approved");
    expect(after.extra["decision_status"]).toBe("accepted");
  });
});

// ─── STATE: AC-DS-5 unrelated extra key survives ────────────────────────────

describe("lore set --decision-status accepted — STATE", () => {
  it("AC-DS-5: an unrelated extra key survives the accept, byte-identical", () => {
    const slug = createAdr(tmpDir, "Unrelated Extra Key Survives", "proposed");
    const unrelatedValue = { marker: "unrelated-extra-value", nested: { count: 3, flag: true } };
    seedUnrelatedExtraKey(tmpDir, slug, "custom_marker", unrelatedValue);

    const before = getDoc(tmpDir, slug);
    expect(before.extra["custom_marker"]).toEqual(unrelatedValue);

    const result = runLore(["set", slug, "--decision-status", "accepted"], tmpDir);
    expect(result.exitCode).toBe(0);

    const after = getDoc(tmpDir, slug);
    expect(after.extra["decision_status"]).toBe("accepted");
    expect(after.extra["custom_marker"]).toEqual(unrelatedValue);
  });
});

// ─── BOUNDARY: AC-DS-6 idempotent second accept ─────────────────────────────

describe("lore set --decision-status accepted — BOUNDARY", () => {
  it("AC-DS-6: idempotent second accept — both exit 0, version advances exactly once", () => {
    const slug = createAdr(tmpDir, "Idempotent Second Accept", "proposed");
    const initialVersion = getDoc(tmpDir, slug).version;

    const firstResult = runLore(["set", slug, "--decision-status", "accepted"], tmpDir);
    expect(firstResult.exitCode).toBe(0);
    const afterFirst = getDoc(tmpDir, slug);
    expect(afterFirst.extra["decision_status"]).toBe("accepted");
    expect(afterFirst.version).toBe(initialVersion + 1);

    const secondResult = runLore(["set", slug, "--decision-status", "accepted"], tmpDir);
    expect(secondResult.exitCode).toBe(0);
    const afterSecond = getDoc(tmpDir, slug);
    expect(afterSecond.extra["decision_status"]).toBe("accepted");
    // Version must NOT advance again — the write is a genuine no-op, not a
    // same-value re-write (CorpusService.set unconditionally bumps version on
    // every call it actually makes; the command must skip the call entirely).
    expect(afterSecond.version).toBe(initialVersion + 1);
  });
});
