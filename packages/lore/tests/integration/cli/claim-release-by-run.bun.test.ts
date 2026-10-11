/**
 * RED: release is decided and recorded by harness RUN, on BOTH the task and the phase path.
 *
 * @spec_ref AC-RID-14
 *   spec-run-identity-slice-1-harness-attested-runs-attested D1 / D2 / D6 / D11; BR-1043
 *   (only the holding run releases without force; anyone else — another run or an unattested
 *   caller — needs force; a forced release names both; a legacy claim is released by name).
 *
 * Today `release` compares `existingClaim.by === opts.by` and records no run. Cases where the
 * verdict or the record depends on the RUN fail; the legacy-by-name cases are green controls.
 *
 * Never touches the repo's own `.lore/` — one mkdtemp corpus per file (`lore init`).
 *
 * Coverage: HAPPY (holder releases, run recorded) / NEGATIVE (other run, unattested refused)
 *           / BOUNDARY (--force) / STATE (claim cleared or kept) / REGRESSION (legacy by name).
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { sessionActorFor } from "../../helpers/session-actor";
import {
  CLAIM_CONFLICT_EXIT,
  KINDS,
  R1,
  R2,
  claim,
  createCorpus,
  getClaim,
  latestHistory,
  minutesAgo,
  registerRun,
  release,
  seedClaim,
  type Corpus,
  type Kind,
} from "./support/claim-run-fixture.js";

setDefaultTimeout(180_000);

const NAME = sessionActorFor("agent:rid-shared-name");
const OTHER_NAME = sessionActorFor("agent:rid-other-name");
const AGE = /\b\d+\s*(m|min|mins|minute|minutes)\b/;

let corpus: Corpus;

beforeAll(async () => {
  corpus = await createCorpus();
});

afterAll(() => {
  corpus.cleanup();
});

describe.each(KINDS)("release by run — %s claim path", (kind: Kind) => {
  async function heldBy(run: string): Promise<string> {
    const target = await corpus.newTarget(kind);
    registerRun(corpus.dir, run);
    expect(claim(corpus.dir, target, NAME, { run }).exitCode).toBe(0);
    return target;
  }

  it("refuses a release by run R2 (even with the holder's SAME name) naming the holding run R1 and the claim's age, and keeps the claim", async () => {
    const target = await heldBy(R1);
    registerRun(corpus.dir, R2);

    const r = release(corpus.dir, target, NAME, { run: R2 });

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(R1);
    expect(r.stderr).toMatch(AGE);
    expect(getClaim(corpus.dir, target)?.harness_run).toBe(R1);
  });

  it("refuses a release by an UNATTESTED caller (even with the holder's SAME name) naming R1, and keeps the claim", async () => {
    const target = await heldBy(R1);

    const r = release(corpus.dir, target, NAME);

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(R1);
    expect(getClaim(corpus.dir, target)?.harness_run).toBe(R1);
  });

  it("--force by R2 releases R1's claim and the history names both the previous run R1 and the releasing run R2", async () => {
    const target = await heldBy(R1);
    registerRun(corpus.dir, R2);

    const r = release(corpus.dir, target, OTHER_NAME, { run: R2, force: true });

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)).toBeUndefined();
    const history = latestHistory(corpus.dir, target);
    expect(history).toContain(R1);
    expect(history).toContain(R2);
  });

  it("--force by an UNATTESTED caller releases R1's claim and the history names R1 as the previous holder", async () => {
    const target = await heldBy(R1);

    const r = release(corpus.dir, target, OTHER_NAME, { force: true });

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)).toBeUndefined();
    expect(latestHistory(corpus.dir, target)).toContain(R1);
  });

  it("the holding run releases without --force, and the release is recorded with that run", async () => {
    const target = await heldBy(R1);

    const r = release(corpus.dir, target, NAME, { run: R1 });

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)).toBeUndefined();
    expect(latestHistory(corpus.dir, target)).toContain(R1);
  });

  it("decides by run, not by name: the holding run releases under a DIFFERENT name without --force", async () => {
    const target = await heldBy(R1);

    const r = release(corpus.dir, target, OTHER_NAME, { run: R1 });

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)).toBeUndefined();
  });

  it("two different runs releasing in turn record different runs (the record is not a constant)", async () => {
    const first = await heldBy(R1);
    const second = await heldBy(R2);

    expect(release(corpus.dir, first, NAME, { run: R1 }).exitCode).toBe(0);
    const historyOfFirst = latestHistory(corpus.dir, first);
    expect(release(corpus.dir, second, NAME, { run: R2 }).exitCode).toBe(0);
    const historyOfSecond = latestHistory(corpus.dir, second);

    expect(historyOfFirst).toContain(R1);
    expect(historyOfFirst).not.toContain(R2);
    expect(historyOfSecond).toContain(R2);
    expect(historyOfSecond).not.toContain(R1);
  });

  // ── Legacy: a claim with no harness_run key is released by its stored name, as before ──

  it("CONTROL: a legacy claim is released by its stored name by an unattested caller without --force", async () => {
    const target = await corpus.newTarget(kind);
    seedClaim(corpus.dir, target, { by: NAME, at: minutesAgo(5) });
    expect(getClaim(corpus.dir, target)).not.toHaveProperty("harness_run");

    const r = release(corpus.dir, target, NAME);

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)).toBeUndefined();
  });

  it("a legacy claim is released by its stored name by a RUN too, without --force, and the release records that run", async () => {
    const target = await corpus.newTarget(kind);
    seedClaim(corpus.dir, target, { by: NAME, at: minutesAgo(5) });
    registerRun(corpus.dir, R1);

    const r = release(corpus.dir, target, NAME, { run: R1 });

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, target)).toBeUndefined();
    expect(latestHistory(corpus.dir, target)).toContain(R1);
  });

  it("CONTROL: a legacy claim is NOT released under a different name without --force", async () => {
    const target = await corpus.newTarget(kind);
    seedClaim(corpus.dir, target, { by: NAME, at: minutesAgo(5) });

    const r = release(corpus.dir, target, OTHER_NAME);

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(r.stderr).toContain(NAME);
    expect(getClaim(corpus.dir, target)?.by).toBe(NAME);
  });
});
