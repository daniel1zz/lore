/**
 * @spec_ref spec-lore-done-closes-a-commitless-task-through-an-audited-no  AC-ND-7 (D5, D7); issue #422
 * @task task-red-tests-landing-from-git-facts-and-the-one-time-back-fill (TDD-Role: red)
 *
 * RED tests for the ONE-TIME back-fill (spec step 8): every stored landing without `kind` gets `kind: "commits"`; every open
 * branch claim without `start_head` gets `merge-base(main, tip)` (and the same tip as `end_tip`); a legacy claim with neither
 * a branch nor post-claim evidence is released once with an audit entry; after the back-fill the schemas REQUIRE both fields.
 *
 * Contract pinned for the implementation task. The transform lives in
 * `packages/lore/src/store/migrations/landing-backfill.ts` (the numbered migration calls it) and is a function of the stored
 * task rows plus a real repository:
 *
 *   backfillLandingFacts({ tasks: readonly { slug: string; extra: Record<string, unknown> }[],
 *                          repoRoot: string, integrationBranch: string })
 *     => { changes: { slug: string; extra: Record<string, unknown> }[],            // only rows that changed, full new extra
 *          audits:  { slug: string; reason: string; remedy: string }[] }           // one per released claim
 *
 * It must be idempotent: run over its own output it returns no changes and no audits. It never invents a start: a claim with
 * no recordable start or tip is released, not defaulted.
 *
 * Fixture: a real temp git repo (mkdtemp + git init -b main). Never the repo's own refs or `.lore/`.
 *
 * Coverage: HAPPY (kind-less landing, live branch), BOUNDARY (gone branch + post-claim evidence; corpus-only claim untouched),
 * NEGATIVE (tipless legacy claim released, never given a start), STATE (second run is a no-op), REGRESSION (schemas require the
 * fields afterwards, #422).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskClaimSchema } from "@lore/core";
import { taskLandingSchema } from "../../../src/service/task-commit-range.js";

interface Row {
  slug: string;
  extra: Record<string, unknown>;
}
interface Change {
  slug: string;
  extra: Record<string, unknown>;
}
interface Audit {
  slug: string;
  reason: string;
  remedy: string;
}
type Backfill = (input: { tasks: readonly Row[]; repoRoot: string; integrationBranch: string }) => { changes: Change[]; audits: Audit[] };

/** The module does not exist before the implementation task: loading it is part of the red. Path is computed so tsc stays green. */
async function loadBackfill(): Promise<Backfill> {
  const modulePath = ["..", "..", "..", "src", "store", "migrations", "landing-backfill.js"].join("/");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { backfillLandingFacts?: Backfill };
  if (typeof mod.backfillLandingFacts !== "function") throw new Error("landing-backfill.ts does not export backfillLandingFacts");
  return mod.backfillLandingFacts;
}

let repo: string;
let m0: string;
let m1: string;
let liveTip: string;
let goneTip: string;

function run(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function commit(file: string): string {
  writeFileSync(join(repo, file), `${file}\n`);
  run(["add", file]);
  run(["commit", "-q", "-m", `add ${file}`]);
  return run(["rev-parse", "HEAD"]);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "lore-landing-backfill-"));
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "fixture@example.invalid"]);
  run(["config", "user.name", "fixture"]);
  m0 = commit("base.txt");
  run(["checkout", "-q", "-b", "leg-live"]);
  liveTip = commit("live.txt"); // a live legacy branch: one commit off m0
  run(["checkout", "-q", "-b", "leg-gone", "main"]);
  goneTip = commit("gone.txt"); // a commit whose branch is then deleted (the object stays)
  run(["checkout", "-q", "main"]);
  run(["branch", "-D", "leg-gone"]);
  m1 = commit("main-moved.txt"); // main moved on after both branches were cut
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const CLAIMED_AT = "2026-01-10T10:00:00.000Z";
const BEFORE_CLAIM = "2026-01-09T10:00:00.000Z";
const AFTER_CLAIM = "2026-01-11T10:00:00.000Z";

function evidence(recordedAt: string, headSha: string): Record<string, unknown> {
  return { oracle: "test", command: "bun test", result: "pass", recorded_at: recordedAt, attestation: { runner: "capture", head_sha: headSha, worktree_dirty: false } };
}

function legacyClaim(branch: string): Record<string, unknown> {
  return { by: "agent:legacy", at: CLAIMED_AT, branch, worktree: branch }; // no start_head, no end_tip: written before base_sha existed
}

function fixtureRows(): Row[] {
  return [
    {
      slug: "t-kindless-landing",
      extra: { landing: { branch: "old", branch_head: m0, main_before: m0, main_after: m1, landing_commit: m1, recorded_at: BEFORE_CLAIM } },
    },
    { slug: "t-live-branch", extra: { claim: legacyClaim("leg-live"), verification_evidence: [evidence(AFTER_CLAIM, liveTip)] } },
    {
      slug: "t-gone-branch-evidence",
      extra: {
        claim: legacyClaim("leg-gone"),
        verification_evidence: [evidence(BEFORE_CLAIM, m0), evidence(AFTER_CLAIM, goneTip)],
      },
    },
    { slug: "t-gone-branch-nothing", extra: { claim: legacyClaim("leg-vanished"), verification_evidence: [evidence(BEFORE_CLAIM, m0)] } },
    { slug: "t-corpus-only-claim", extra: { claim: { by: "agent:legacy", at: CLAIMED_AT } } },
    {
      slug: "t-already-current",
      extra: { claim: { ...legacyClaim("leg-live"), start_head: m0, end_tip: liveTip }, landing: { kind: "commits", branch: "leg-live", branch_head: liveTip, main_before: m0, main_after: m1, landing_commit: m1, recorded_at: AFTER_CLAIM } },
    },
  ];
}

function apply(rows: readonly Row[], changes: readonly Change[]): Row[] {
  const bySlug = new Map(changes.map((c) => [c.slug, c.extra]));
  return rows.map((row) => ({ slug: row.slug, extra: bySlug.get(row.slug) ?? row.extra }));
}

function claimOf(change: Change | undefined): Record<string, unknown> | undefined {
  return change?.extra["claim"] as Record<string, unknown> | undefined;
}

describe("AC-ND-7 — the one-time back-fill", () => {
  it("AC-ND-7 gives kind commits to every kind-less landing and leaves current rows alone", async () => {
    const backfill = await loadBackfill();

    const { changes } = backfill({ tasks: fixtureRows(), repoRoot: repo, integrationBranch: "main" });

    const landed = changes.find((c) => c.slug === "t-kindless-landing");
    expect((landed?.extra["landing"] as Record<string, unknown> | undefined)?.["kind"]).toBe("commits");
    expect(changes.find((c) => c.slug === "t-already-current")).toBeUndefined();
    expect(changes.find((c) => c.slug === "t-corpus-only-claim")).toBeUndefined(); // not a branch claim: nothing to fill
  });

  it("AC-ND-7 a pre-base_sha claim whose branch exists gets start_head = merge-base(main, tip) and end_tip = the tip (#422)", async () => {
    const backfill = await loadBackfill();

    const { changes } = backfill({ tasks: fixtureRows(), repoRoot: repo, integrationBranch: "main" });

    const claim = claimOf(changes.find((c) => c.slug === "t-live-branch"));
    expect(claim?.["start_head"]).toBe(m0); // main moved on to m1; the branch was cut from m0
    expect(claim?.["end_tip"]).toBe(liveTip);
    expect(claim?.["branch"]).toBe("leg-live"); // the rest of the claim is untouched
  });

  it("AC-ND-7 a legacy claim with a gone branch and post-claim evidence takes start_head and end_tip from that evidence head", async () => {
    const backfill = await loadBackfill();

    const { changes } = backfill({ tasks: fixtureRows(), repoRoot: repo, integrationBranch: "main" });

    const claim = claimOf(changes.find((c) => c.slug === "t-gone-branch-evidence"));
    expect(claim?.["end_tip"]).toBe(goneTip); // the post-claim head, not the pre-claim one (m0)
    expect(claim?.["start_head"]).toBe(m0); // merge-base(main, goneTip)
  });

  it("AC-ND-7 a legacy claim with neither a branch nor post-claim evidence is released with one audit entry naming re-claim, never given an invented start", async () => {
    const backfill = await loadBackfill();

    const { changes, audits } = backfill({ tasks: fixtureRows(), repoRoot: repo, integrationBranch: "main" });

    const released = changes.find((c) => c.slug === "t-gone-branch-nothing");
    expect(released).toBeDefined();
    expect(released?.extra["claim"]).toBeUndefined(); // released, not defaulted to main's head or start_head
    const entries = audits.filter((a) => a.slug === "t-gone-branch-nothing");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.reason).toContain("no start or tip recordable");
    expect(entries[0]?.remedy).toMatch(/claim again|re-claim/i);
    expect(audits).toHaveLength(1); // no other row is released
  });

  it("AC-ND-7 a second run over the back-filled rows changes nothing and audits nothing", async () => {
    const backfill = await loadBackfill();
    const first = backfill({ tasks: fixtureRows(), repoRoot: repo, integrationBranch: "main" });
    expect(first.changes.length).toBeGreaterThan(0);

    const second = backfill({ tasks: apply(fixtureRows(), first.changes), repoRoot: repo, integrationBranch: "main" });

    expect(second.changes).toEqual([]);
    expect(second.audits).toEqual([]);
  });

  it("AC-ND-7 afterwards a landing without kind, or an open branch claim without a sha start_head, fails schema parsing", () => {
    const landing = { branch: "b", branch_head: m0, main_before: m0, main_after: m1, landing_commit: m1, recorded_at: AFTER_CLAIM };
    expect(taskLandingSchema.safeParse({ ...landing, kind: "commits" }).success).toBe(true);
    expect(taskLandingSchema.safeParse(landing).success).toBe(false); // no kind: no read-time default

    const claim = { by: "agent:x", at: CLAIMED_AT, branch: "b", worktree: "b" };
    expect(taskClaimSchema.safeParse({ ...claim, start_head: m0 }).success).toBe(true);
    expect(taskClaimSchema.safeParse(claim).success).toBe(false); // a branch claim needs a sha start_head
    expect(taskClaimSchema.safeParse({ ...claim, start_head: "main" }).success).toBe(false); // a sha, not a ref name
    expect(taskClaimSchema.safeParse({ by: "agent:x", at: CLAIMED_AT }).success).toBe(true); // a no-branch claim needs none
  });
});
