/**
 * RED: a claim stored BEFORE runs existed (no `harness_run` key at all) is compared by its
 * stored name until it is released or goes stale; after that the run rules apply. Both the
 * task and the phase claim path.
 *
 * @spec_ref AC-RID-13
 *   spec-run-identity-slice-1-harness-attested-runs-attested D6 ("legacy = the stored claim
 *   has NO `harness_run` key; a claim written later stores the key, null when unattested" —
 *   the two are deliberately different) / D1 / D2; BR-1042.
 *
 * A legacy claim cannot be produced through the new CLI, so it is seeded into the stored
 * document in the exact shape the previous code wrote (by + at, no harness_run property).
 * The seed is asserted to lack the key — a seed carrying `harness_run: null` would be an
 * UNATTESTED claim (BR-1040), a different case.
 *
 * Today everything is compared by name, so the legacy-by-name cases are green controls; the
 * cases that need a run (the claim becomes run-held; run rules apply afterwards) are red.
 *
 * Never touches the repo's own `.lore/` — one mkdtemp corpus per file (`lore init`).
 *
 * Coverage: HAPPY (run refreshes legacy by name) / NEGATIVE (different name refused) /
 *           BOUNDARY (stale legacy) / STATE (release then run rules) / REGRESSION (by-name).
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  CLAIM_CONFLICT_EXIT,
  KINDS,
  R1,
  R2,
  claim,
  createCorpus,
  getClaim,
  minutesAgo,
  registerRun,
  release,
  seedClaim,
  type Corpus,
  type Kind,
} from "./support/claim-run-fixture.js";

setDefaultTimeout(180_000);

const LEGACY_NAME = "agent:rid-legacy-holder";
const OTHER_NAME = "agent:rid-someone-else";

let corpus: Corpus;

beforeAll(async () => {
  corpus = await createCorpus();
});

afterAll(() => {
  corpus.cleanup();
});

describe.each(KINDS)("legacy claim transition — %s claim path", (kind: Kind) => {
  /** A claim exactly as pre-016 code stored it: no harness_run key. */
  async function legacyClaim(ageMinutes: number): Promise<string> {
    const target = await corpus.newTarget(kind);
    seedClaim(corpus.dir, target, { by: LEGACY_NAME, at: minutesAgo(ageMinutes) });
    expect(getClaim(corpus.dir, target)).not.toHaveProperty("harness_run");
    return target;
  }

  it("a run claiming with the SAME name as a fresh legacy claim refreshes it and becomes its holder", async () => {
    const target = await legacyClaim(5);
    registerRun(corpus.dir, R1);

    const r = claim(corpus.dir, target, LEGACY_NAME, { run: R1 });

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)?.harness_run).toBe(R1);
  });

  it("a run claiming with a DIFFERENT name than a fresh legacy claim is refused naming the legacy holder, and the claim is untouched", async () => {
    const target = await legacyClaim(5);
    registerRun(corpus.dir, R1);

    const r = claim(corpus.dir, target, OTHER_NAME, { run: R1 });

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(LEGACY_NAME);
    const stored = getClaim(corpus.dir, target);
    expect(stored?.by).toBe(LEGACY_NAME);
    expect(stored).not.toHaveProperty("harness_run");
  });

  it("after the legacy claim is refreshed by R1 it is run-held: R2 with R1's name is refused naming R1", async () => {
    const target = await legacyClaim(5);
    registerRun(corpus.dir, R1);
    registerRun(corpus.dir, R2);
    expect(claim(corpus.dir, target, LEGACY_NAME, { run: R1 }).exitCode).toBe(0);

    const r = claim(corpus.dir, target, LEGACY_NAME, { run: R2 });

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(R1);
  });

  it("once the legacy lease is STALE, a run with a different name takes it over without --steal", async () => {
    const target = await legacyClaim(600);
    registerRun(corpus.dir, R1);

    const r = claim(corpus.dir, target, OTHER_NAME, { run: R1 });

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)?.harness_run).toBe(R1);
  });

  it("after a stale legacy takeover the RUN rules apply: R2 with the taker's name is refused naming the taking run", async () => {
    const target = await legacyClaim(600);
    registerRun(corpus.dir, R1);
    registerRun(corpus.dir, R2);
    expect(claim(corpus.dir, target, OTHER_NAME, { run: R1 }).exitCode).toBe(0);

    const r = claim(corpus.dir, target, OTHER_NAME, { run: R2 });

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(R1);
  });

  it("once the legacy claim is RELEASED (by its stored name), the next run's claim follows the run rules", async () => {
    const target = await legacyClaim(5);
    registerRun(corpus.dir, R1);
    registerRun(corpus.dir, R2);
    expect(release(corpus.dir, target, LEGACY_NAME).exitCode).toBe(0);
    expect(claim(corpus.dir, target, OTHER_NAME, { run: R1 }).exitCode).toBe(0);

    const r = claim(corpus.dir, target, OTHER_NAME, { run: R2 });

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(R1);
  });

  // ── Controls: legacy claims are compared by name for an UNATTESTED claimant too (green today) ──

  it("CONTROL: an unattested caller with the same name refreshes a fresh legacy claim", async () => {
    const target = await legacyClaim(5);

    const r = claim(corpus.dir, target, LEGACY_NAME);

    expect(r.exitCode).toBe(0);
  });

  it("CONTROL: an unattested caller with a different name is refused by a fresh legacy claim", async () => {
    const target = await legacyClaim(5);

    const r = claim(corpus.dir, target, OTHER_NAME);

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(LEGACY_NAME);
  });
});
