// @reads scripts/check-unclaimed-oracle.ts
// @reads assets/project/lore-config-template.yaml
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
 *               one pre-armed fixture (an approved `knowledge/skill` doc scoped `applies_to: "spec"`,
 *               created through a live in-process app) — deep
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
 * which vitest cannot resolve (same constraint documented on `status-stamp-verdict.ts`/
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
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

import { ensureRequirementsDocSlugAsync } from "../../helpers/parented-create.js";
import { createLiveApp } from "../../helpers/live-app.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** `actor` names the writer through the session tier (no write command takes `--by`); `null` = unnamed. */
async function runLore(args: string[], cwd: string, actor: string | null = null): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, EDITOR: "true" }, actor) as Record<string, string>,
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

/** Parses the `slug` field out of a `--json` create envelope (`{ok, data: {slug, ...}}`). */
function parseJsonSlug(stdout: string): string {
  const parsed = JSON.parse(stdout) as { data: { slug: string } };
  return parsed.data.slug;
}

async function initCorpus(tmpDir: string): Promise<void> {
  const result = await runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

async function createKnowledge(tmpDir: string, title: string): Promise<string> {
  const result = await runLore(
    ["create", "knowledge", "--parent", await ensureRequirementsDocSlugAsync((a) => runLore(a, tmpDir)), "--title", title, "--sub-type", "reference", "--no-ai", "--content", "Body.", "--json"],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create knowledge failed: ${result.stderr}`);
  return parseJsonSlug(result.stdout);
}

async function createAdr(tmpDir: string, title: string): Promise<string> {
  const result = await runLore(
    ["create", "adr", "--parent", await ensureRequirementsDocSlugAsync((a) => runLore(a, tmpDir)), "--title", title, "--decision-status", "accepted", "--no-ai", "--content", "Body.", "--json"],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create adr failed: ${result.stderr}`);
  return parseJsonSlug(result.stdout);
}

async function createPlan(tmpDir: string, title: string): Promise<string> {
  const result = await runLore(["create", "plan", "--parent", await ensureRequirementsDocSlugAsync((a) => runLore(a, tmpDir)), "--title", title, "--no-ai", "--content", "Body.", "--json"], tmpDir);
  if (result.exitCode !== 0) throw new Error(`create plan failed: ${result.stderr}`);
  return parseJsonSlug(result.stdout);
}

/** Creates and approves a `knowledge/skill` doc scoped `applies_to: "spec"` (a team-authored feeding source) in the
 *  throwaway corpus, through a live in-process app over the same SQLite file. (The spec-rules document and its seed
 *  script are retired; a team skill doc is still a discoverable feeding source, which is what this test needs.) */
async function seedFeedingSkill(tmpDir: string): Promise<{ slug: string }> {
  // reason: BR-709 — a knowledge doc hangs under the corpus's requirements document, so one must exist first.
  const parent = await ensureRequirementsDocSlugAsync((a) => runLore(a, tmpDir));
  const app = createLiveApp(join(tmpDir, ".lore", "lore.db"));
  try {
    const created = await app.corpusService.create({
      parent_id: parent,
      type: "knowledge",
      title: "Spec rules fixture",
      content: "## Rule\n\nA fixture feeding rule.",
      extra: { sub_type: "skill", skill: { applies_to: "spec" } },
    } as never);
    if (!created.ok) throw new Error(`create feeding skill failed: ${JSON.stringify(created.error)}`);
    const approved = await app.corpusService.set(created.value.id, { status: "approved" } as never);
    if (!approved.ok) throw new Error(`approve feeding skill failed: ${JSON.stringify(approved.error)}`);
    return { slug: created.value.slug };
  } finally {
    app.close();
  }
}

interface JsonDocEnvelope {
  ok: boolean;
  data: Record<string, unknown>;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-invalidate-"));
  await initCorpus(tmpDir);
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
  it("invalidate exits 0; search hides by default; --include-invalid shows with [invalid] badge", async () => {
    const title = "ZzzInvalidateSearchTargetKnowledge";
    const slug = await createKnowledge(tmpDir, title);

    const invalidateResult = await runLore(["invalidate", slug, "--reason", "obsolete", "--json"], tmpDir);
    expect(invalidateResult.exitCode).toBe(0);
    const invalidated = JSON.parse(invalidateResult.stdout) as JsonDocEnvelope;
    expect(invalidated.ok).toBe(true);

    // Default search excludes the now-invalidated doc (the "No results" message
    // legitimately echoes the query text itself, so assert on the no-results
    // sentinel rather than title absence).
    const hiddenResult = await runLore(["search", title], tmpDir);
    expect(hiddenResult.exitCode).toBe(0);
    expect(hiddenResult.stdout).toContain("No results for");

    // --include-invalid restores it, badged.
    const shownResult = await runLore(["search", title, "--include-invalid"], tmpDir);
    expect(shownResult.exitCode).toBe(0);
    expect(shownResult.stdout).toContain("[invalid]");

    // REGRESSION (AC-MH-7's --raw pin, exercised HERE rather than at the vitest layer
    // — `get.ts` transitively imports `loader.ts` → `bun:sqlite`, which vitest cannot
    // resolve; this compiled-binary spawn is the only venue that can actually invoke
    // it). --raw is always the stored bytes — banner format itself is pinned at the
    // vitest layer via `validity-projection.test.ts`'s `renderDocMarkdown`/
    // `ExportDocsService` assertions.
    const rawGetResult = await runLore(["get", slug, "--raw"], tmpDir);
    expect(rawGetResult.exitCode).toBe(0);
    expect(rawGetResult.stdout).not.toContain("INVALIDATED");

    const nonRawGetResult = await runLore(["get", slug], tmpDir);
    expect(nonRawGetResult.exitCode).toBe(0);
    expect(nonRawGetResult.stdout).toContain("INVALIDATED");
  });
});

// ─── HAPPY: create --supersedes composes create + invalidate + link ─────────

describe("lore create adr --supersedes — HAPPY (SPEC-043 D11)", () => {
  it("creates the new ADR, invalidates the old one, and links them in one command", async () => {
    const oldSlug = await createAdr(tmpDir, "Old Decision To Be Superseded");

    const result = await runLore(
      [
        "create",
        "adr", "--parent", await ensureRequirementsDocSlugAsync((a) => runLore(a, tmpDir)),
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

    const oldDocResult = await runLore(["get", oldSlug, "--json"], tmpDir);
    expect(oldDocResult.exitCode).toBe(0);
    const oldDoc = JSON.parse(oldDocResult.stdout) as {
      data: { doc: { extra: { validity?: { invalid_at?: string; invalidated_by?: string }; decision_status?: string } } };
    };
    expect(oldDoc.data.doc.extra.validity?.invalid_at).toBeDefined();
    expect(oldDoc.data.doc.extra.decision_status).toBe("superseded");

    // Links the new successor to the old doc via a `supersedes` edge.
    const newDocResult = await runLore(["get", newSlug, "--json"], tmpDir);
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
  it("a never-invalidated doc → exit 4 (VALIDATION_ERROR)", async () => {
    const slug = await createKnowledge(tmpDir, "Never Invalidated Knowledge");
    const result = await runLore(["invalidate", slug, "--undo"], tmpDir);
    expect(result.exitCode).toBe(4);
  });
});

// ─── ERROR: non-knowledge/adr target ─────────────────────────────────────────

describe("lore invalidate — ERROR (ineligible type)", () => {
  it("a plan target → exit 4 (VALIDATION_ERROR naming allowed types)", async () => {
    const planSlug = await createPlan(tmpDir, "Plan Cannot Be Invalidated");
    const result = await runLore(["invalidate", planSlug, "--reason", "n/a"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("knowledge/adr");
  });
});

// ─── STATE: lore status invalidated-feeding-source warning ──────────────────

describe("lore status — STATE (SPEC-043 D8)", () => {
  it("the warning string surfaces once the feeding-source skill doc is invalidated", async () => {
    const { slug: skillSlug } = await seedFeedingSkill(tmpDir);

    const beforeStatus = await runLore(["status"], tmpDir);
    expect(beforeStatus.exitCode).toBe(0);
    expect(beforeStatus.stdout).not.toContain("Invalidated feeding sources");

    const invalidateResult = await runLore(["invalidate", skillSlug, "--reason", "outdated rules"], tmpDir);
    expect(invalidateResult.exitCode).toBe(0);

    const afterStatus = await runLore(["status"], tmpDir);
    expect(afterStatus.exitCode).toBe(0);
    expect(afterStatus.stdout).toContain("Invalidated feeding sources");
    expect(afterStatus.stdout).toContain(skillSlug);
    expect(afterStatus.stdout).toContain("spec-create");
  });
});
