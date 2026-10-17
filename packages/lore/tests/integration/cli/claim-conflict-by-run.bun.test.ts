/**
 * RED: claim conflicts are decided by harness RUN, on BOTH the task and the phase claim path.
 *
 * @spec_ref AC-RID-12
 *   spec-run-identity-slice-1-harness-attested-runs-attested D1 (global `--harness-run <id>`
 *   flag, stripped at the CLI entry) / D2 (run ids `cc:<session>`) / D6 (`hasClaimConflict`:
 *   two different runs, or exactly one side unattested => conflict; same run => refresh; both
 *   unattested => compare by name; stale => takeover) / D11; BR-1040, BR-1041.
 *
 * Today both services compare `existingClaim.by === opts.by`. Every case where the verdict
 * depends on the RUN and not on the name therefore fails; the cases where both parties are
 * unattested (by-name comparison) are controls that must stay green.
 *
 * The same scenarios run for a task target and a phase target (`describe.each`): the
 * 2026-08-03 incident fixed one path only, so a single-path pass proves nothing.
 *
 * Never touches the repo's own `.lore/` — one mkdtemp corpus per file (`lore init`).
 *
 * Coverage: HAPPY (refresh, takeover, steal) / NEGATIVE (R2, unattested, attested-vs-unattested)
 *           / BOUNDARY (stale takeover) / STATE (stored harness_run key) / REGRESSION (by-name).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { sessionActorFor } from "../../helpers/session-actor";
import {
  CLAIM_CONFLICT_EXIT,
  KINDS,
  R1,
  R2,
  ageClaim,
  claim,
  createCorpus,
  getClaim,
  latestHistory,
  registerRun,
  type Corpus,
  type Kind,
} from "./support/claim-run-fixture.js";

setDefaultTimeout(180_000);

const NAME = sessionActorFor("agent:rid-shared-name");
const OTHER_NAME = sessionActorFor("agent:rid-other-name");
/** A conflict message states the claim's age in minutes, e.g. "claimed 0m ago". */
const AGE = /\b\d+\s*(m|min|mins|minute|minutes)\b/;

let corpus: Corpus;

beforeAll(async () => {
  corpus = await createCorpus();
});

afterAll(() => {
  corpus.cleanup();
});

describe.each(KINDS)("claim conflict by run — %s claim path", (kind: Kind) => {
  async function heldBy(run: string | undefined, by: string = NAME): Promise<string> {
    const target = await corpus.newTarget(kind);
    if (run !== undefined) registerRun(corpus.dir, run);
    const first = claim(corpus.dir, target, by, { ...(run !== undefined ? { run } : {}) });
    expect(first.exitCode).toBe(0);
    return target;
  }

  it("refuses run R2 while R1 holds a fresh claim, even with the SAME name, naming the holding run and the claim's age", async () => {
    const target = await heldBy(R1);
    registerRun(corpus.dir, R2);

    const r = claim(corpus.dir, target, NAME, { run: R2 });

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(R1);
    expect(r.stderr).toMatch(AGE);
    expect(getClaim(corpus.dir, target)?.harness_run).toBe(R1);
  });

  it("refuses run R2 while R1 holds, with a different name too, and still names R1 (not only the holder's name)", async () => {
    const target = await heldBy(R1);
    registerRun(corpus.dir, R2);

    const r = claim(corpus.dir, target, OTHER_NAME, { run: R2 });

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(R1);
  });

  it("refuses a claimant with no attestation against a fresh claim by R1, naming R1, even with the SAME name", async () => {
    const target = await heldBy(R1);

    const r = claim(corpus.dir, target, NAME);

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(R1);
    expect(getClaim(corpus.dir, target)?.harness_run).toBe(R1);
  });

  it("refuses an attested claimant against a fresh UNATTESTED holder, even with the SAME name", async () => {
    const target = await heldBy(undefined);
    registerRun(corpus.dir, R1);

    const r = claim(corpus.dir, target, NAME, { run: R1 });

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toMatch(AGE);
    const stored = getClaim(corpus.dir, target);
    expect(stored?.harness_run ?? null).toBeNull();
  });

  it("refreshes: R1 claiming again advances the lease timestamp and keeps R1 as the holder", async () => {
    const target = await heldBy(R1);
    ageClaim(corpus.dir, target, 30); // still fresh (default ttl is 120 minutes)
    const before = getClaim(corpus.dir, target)!;

    const r = claim(corpus.dir, target, NAME, { run: R1 });

    expect(r.exitCode).toBe(0);
    const after = getClaim(corpus.dir, target)!;
    expect(Date.parse(after.at)).toBeGreaterThan(Date.parse(before.at));
    expect(after.harness_run).toBe(R1);
  });

  it("decides by run, not by name: R1 claiming again under a DIFFERENT name still refreshes", async () => {
    const target = await heldBy(R1, NAME);

    const r = claim(corpus.dir, target, OTHER_NAME, { run: R1 });

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)?.harness_run).toBe(R1);
  });

  it("takes over a STALE claim by R1 for R2 without --steal", async () => {
    const target = await heldBy(R1);
    ageClaim(corpus.dir, target, 600);
    registerRun(corpus.dir, R2);

    const r = claim(corpus.dir, target, OTHER_NAME, { run: R2 });

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)?.harness_run).toBe(R2);
  });

  it("takes over a STALE claim by R1 for an unattested claimant without --steal (stale rule beats run rule)", async () => {
    const target = await heldBy(R1);
    ageClaim(corpus.dir, target, 600);

    const r = claim(corpus.dir, target, OTHER_NAME);

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)?.harness_run ?? null).toBeNull();
  });

  it("--steal by R2 over R1's fresh claim succeeds and the history names R1 as previous and R2 as new", async () => {
    const target = await heldBy(R1);
    registerRun(corpus.dir, R2);

    const r = claim(corpus.dir, target, NAME, { run: R2, steal: true });

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)?.harness_run).toBe(R2);
    const history = latestHistory(corpus.dir, target);
    expect(history).toContain(R1);
    expect(history).toContain(R2);
  });

  it("stores the claiming run on the claim as a harness_run key; an unattested claim stores the key as null, not absent", async () => {
    const attested = await heldBy(R1);
    const unattested = await heldBy(undefined, OTHER_NAME);

    expect(getClaim(corpus.dir, attested)).toHaveProperty("harness_run", R1);
    expect(getClaim(corpus.dir, unattested)).toHaveProperty("harness_run", null);
  });

  // ── Controls: neither side attested => compare by name, exactly as before (green today) ──

  it("CONTROL: two unattested parties with the SAME name — the second claim refreshes", async () => {
    const target = await heldBy(undefined);

    const r = claim(corpus.dir, target, NAME);

    expect(r.exitCode).toBe(0);
  });

  it("CONTROL: two unattested parties with DIFFERENT names — the second claim is refused naming the holder", async () => {
    const target = await heldBy(undefined);

    const r = claim(corpus.dir, target, OTHER_NAME);

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(NAME);
  });
});
