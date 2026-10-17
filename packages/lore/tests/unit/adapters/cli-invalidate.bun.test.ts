/**
 * `lore invalidate` / `lore create --supersedes` / `--include-invalid` / `lore status`
 * warning — CLI-adapter exit-code + wiring contract tests (SPEC-043 §Design Decisions
 * D2, D3, D8, D11; §Acceptance Criteria AC-MH-8).
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY corpus
 * (mkdtemp + `lore init`) — NEVER the repo's own `.lore/` corpus (project CLAUDE.md
 * hard rule). `assertFreshBinary` (mirrors `cli-claim-anchors.bun.test.ts`) fails loud
 * before any test runs if `dist/lore` is missing or older than the newest `.ts` source
 * under `packages/{lore,core}/src`. Requires `bun run build` to have run first.
 *
 * This suite is deliberately LEAN (budget-conscious, per the 9-spawn/5s-budget lesson
 * — heavy invalidate/undo/ADR-convergence/atomicity logic is already exhaustively
 * tested at the vitest service layer, `validity-service.test.ts`). Each test reuses
 * one or two fixture docs for multiple assertions rather than spawning a fresh corpus
 * per assertion.
 *
 * Coverage:
 *   HAPPY:      invalidate with --reason → exit 0; search hides the invalidated doc
 *               by default and shows it with a `[invalid]` badge under
 *               --include-invalid; `create adr --supersedes <old>` creates + invalidates
 *               + links the old ADR in one command
 *   NEGATIVE:   n/a (covered by ERROR below — every negative-input case here maps to a
 *               LoreError, not a CLI-usage exit-2 case)
 *   BOUNDARY:   n/a — covered by validity.test.ts's isInvalidated boundary cases and
 *               validity-service.test.ts's re-invalidation/undo boundaries
 *   ERROR:      `--undo` on a never-invalidated doc → exit 4; a non-knowledge/adr
 *               target (a plan) → exit 4
 *   STATE:      `lore status`'s invalidated-feeding-source warning STRING surfaces for
 *               one pre-armed fixture (seeded via `scripts/seed-write-spec-rule.ts`,
 *               the SAME feeding-skill precedent `gate`/`feed` tests use) — deep
 *               armed-gate derivation logic is exhaustively tested at the vitest layer
 *               (AC-MH-12, `validity-feed-and-judge.test.ts`); this test only proves
 *               the CLI text-rendering wiring
 *   REGRESSION: n/a — no pre-SPEC-043 `lore status`/`lore search` behavior is touched
 *               by these tests (both are additive, opt-in via --include-invalid /
 *               only firing on a pre-armed invalidated feeding source)
 *
 * Deviation from AC-MH-7's literal placement (pre-authorized by the dispatching
 * orchestrator's Context Digest — file anchors name `get.ts` as mine to wire, and this
 * is the sole executable venue for it): the "--raw NEVER carries the banner"
 * REGRESSION check is exercised HERE (compiled-binary spawn) rather than in AC-MH-7's
 * vitest suite, because `get.ts` transitively imports `loader.ts` → `bun:sqlite`,
 * which vitest cannot resolve (same constraint documented on `assess-render.ts`/
 * `handoff-input.ts`). AC-MH-7's vitest suite covers the banner FORMAT pinned cases
 * (no-reason, deleted-successor, no-banner-on-valid) via the shared
 * `renderDocMarkdown`/`ExportDocsService` functions `get.ts` itself delegates to.
 *
 * @spec_ref SPEC-043 §Acceptance Criteria AC-MH-8
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { withSessionIdentity } from "../../helpers/session-actor";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const SEED_SCRIPT = join(REPO_ROOT, "scripts", "seed-write-spec-rule.ts");

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

function createKnowledge(tmpDir: string, title: string): string {
  const result = runLore(
    ["create", "knowledge", "--title", title, "--sub-type", "reference", "--no-ai", "--content", "Body.", "--json"],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create knowledge failed: ${result.stderr}`);
  return parseJsonSlug(result.stdout);
}

function createAdr(tmpDir: string, title: string): string {
  const result = runLore(
    ["create", "adr", "--title", title, "--decision-status", "accepted", "--no-ai", "--content", "Body.", "--json"],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create adr failed: ${result.stderr}`);
  return parseJsonSlug(result.stdout);
}

function createPlan(tmpDir: string, title: string): string {
  const result = runLore(["create", "plan", "--title", title, "--no-ai", "--content", "Body.", "--json"], tmpDir);
  if (result.exitCode !== 0) throw new Error(`create plan failed: ${result.stderr}`);
  return parseJsonSlug(result.stdout);
}

/** Seeds the write-spec-rule skill doc (feeding source for the spec-create gate)
 *  directly into the throwaway corpus's SQLite file — a SEPARATE bun process from the
 *  compiled binary, mirroring how CI/deploy runs this script (module header). */
function seedFeedingSkill(tmpDir: string): { slug: string } {
  const dbPath = join(tmpDir, ".lore", "lore.db");
  const proc = Bun.spawnSync(["bun", SEED_SCRIPT, dbPath]);
  if (proc.exitCode !== 0) {
    throw new Error(`seed-write-spec-rule failed: ${proc.stderr.toString()}`);
  }
  const parsed = JSON.parse(proc.stdout.toString()) as { slug: string; outcome: string };
  return { slug: parsed.slug };
}

interface JsonDocEnvelope {
  ok: boolean;
  data: Record<string, unknown>;
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
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-invalidate-"));
  initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── HAPPY: invalidate + search filter + --include-invalid badge ────────────

describe("lore invalidate — HAPPY", () => {
  it("invalidate exits 0; search hides by default; --include-invalid shows with [invalid] badge", () => {
    const title = "ZzzInvalidateSearchTargetKnowledge";
    const slug = createKnowledge(tmpDir, title);

    const invalidateResult = runLore(["invalidate", slug, "--reason", "obsolete", "--json"], tmpDir);
    expect(invalidateResult.exitCode).toBe(0);
    const invalidated = JSON.parse(invalidateResult.stdout) as JsonDocEnvelope;
    expect(invalidated.ok).toBe(true);

    // Default search excludes the now-invalidated doc (the "No results" message
    // legitimately echoes the query text itself, so assert on the no-results
    // sentinel rather than title absence).
    const hiddenResult = runLore(["search", title], tmpDir);
    expect(hiddenResult.exitCode).toBe(0);
    expect(hiddenResult.stdout).toContain("No results for");

    // --include-invalid restores it, badged.
    const shownResult = runLore(["search", title, "--include-invalid"], tmpDir);
    expect(shownResult.exitCode).toBe(0);
    expect(shownResult.stdout).toContain("[invalid]");

    // REGRESSION (AC-MH-7's --raw pin, exercised HERE rather than at the vitest layer
    // — `get.ts` transitively imports `loader.ts` → `bun:sqlite`, which vitest cannot
    // resolve; this compiled-binary spawn is the only venue that can actually invoke
    // it). --raw is always the stored bytes — banner format itself is pinned at the
    // vitest layer via `validity-projection.test.ts`'s `renderDocMarkdown`/
    // `ExportDocsService` assertions.
    const rawGetResult = runLore(["get", slug, "--raw"], tmpDir);
    expect(rawGetResult.exitCode).toBe(0);
    expect(rawGetResult.stdout).not.toContain("INVALIDATED");

    const nonRawGetResult = runLore(["get", slug], tmpDir);
    expect(nonRawGetResult.exitCode).toBe(0);
    expect(nonRawGetResult.stdout).toContain("INVALIDATED");
  });
});

// ─── HAPPY: create --supersedes composes create + invalidate + link ─────────

describe("lore create adr --supersedes — HAPPY (SPEC-043 D11)", () => {
  it("creates the new ADR, invalidates the old one, and links them in one command", () => {
    const oldSlug = createAdr(tmpDir, "Old Decision To Be Superseded");

    const result = runLore(
      [
        "create",
        "adr",
        "--title",
        "New Decision Superseding The Old One",
        "--decision-status",
        "accepted",
        "--supersedes",
        oldSlug,
        "--no-ai",
        "--content",
        "Body.",
        "--json",
      ],
      tmpDir,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as JsonDocEnvelope;
    expect(parsed.ok).toBe(true);
    expect(parsed.data["supersede_error"]).toBeUndefined();
    const newSlug = parsed.data["slug"] as string;

    const oldDocResult = runLore(["get", oldSlug, "--json"], tmpDir);
    expect(oldDocResult.exitCode).toBe(0);
    const oldDoc = JSON.parse(oldDocResult.stdout) as {
      data: { doc: { extra: { validity?: { invalid_at?: string; invalidated_by?: string }; decision_status?: string } } };
    };
    expect(oldDoc.data.doc.extra.validity?.invalid_at).toBeDefined();
    expect(oldDoc.data.doc.extra.decision_status).toBe("superseded");

    // Links the new successor to the old doc via a `supersedes` edge.
    const newDocResult = runLore(["get", newSlug, "--json"], tmpDir);
    expect(newDocResult.exitCode).toBe(0);
    const newDoc = JSON.parse(newDocResult.stdout) as {
      data: { navigation: { related: Array<{ slug: string; link_type: string }> } };
    };
    expect(
      newDoc.data.navigation.related.some((r) => r.slug === oldSlug && r.link_type === "supersedes"),
    ).toBe(true);
  });
});

// ─── ERROR: undo on never-invalidated doc ────────────────────────────────────

describe("lore invalidate --undo — ERROR", () => {
  it("a never-invalidated doc → exit 4 (VALIDATION_ERROR)", () => {
    const slug = createKnowledge(tmpDir, "Never Invalidated Knowledge");
    const result = runLore(["invalidate", slug, "--undo"], tmpDir);
    expect(result.exitCode).toBe(4);
  });
});

// ─── ERROR: non-knowledge/adr target ─────────────────────────────────────────

describe("lore invalidate — ERROR (ineligible type)", () => {
  it("a plan target → exit 4 (VALIDATION_ERROR naming allowed types)", () => {
    const planSlug = createPlan(tmpDir, "Plan Cannot Be Invalidated");
    const result = runLore(["invalidate", planSlug, "--reason", "n/a"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("knowledge/adr");
  });
});

// ─── STATE: lore status invalidated-feeding-source warning ──────────────────

describe("lore status — STATE (SPEC-043 D8)", () => {
  it("the warning string surfaces once the feeding-source skill doc is invalidated", () => {
    const { slug: skillSlug } = seedFeedingSkill(tmpDir);

    const beforeStatus = runLore(["status"], tmpDir);
    expect(beforeStatus.exitCode).toBe(0);
    expect(beforeStatus.stdout).not.toContain("Invalidated feeding sources");

    const invalidateResult = runLore(["invalidate", skillSlug, "--reason", "outdated rules"], tmpDir);
    expect(invalidateResult.exitCode).toBe(0);

    const afterStatus = runLore(["status"], tmpDir);
    expect(afterStatus.exitCode).toBe(0);
    expect(afterStatus.stdout).toContain("Invalidated feeding sources");
    expect(afterStatus.stdout).toContain(skillSlug);
    expect(afterStatus.stdout).toContain("spec-create");
  });
});
