// @spawns packages/lore/src/index.ts
/**
 * The CLI SURFACE decides `lore done` and the anchor-overlap claim gate by RUN.
 *
 * @spec_ref spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-3
 *   spec-run-only-write-identity-and-run-end-claim-release Scope 3; BR-1056.
 *
 * `run-owned-done-and-overlap.bun.test.ts` proves the service. That is not enough: `DoneOpts.harnessRun` and the
 * gate's candidate run are only real if the shipped command passes the invocation's verified run. This file
 * spawns the real CLI (`bun run src/index.ts`) against its own mkdtemp corpus, naming the writer through the
 * session tier (`CLAUDE_CODE_SESSION_ID`) and the run through `--harness-run`, so two runs share ONE derived
 * name exactly as two real sessions can.
 *
 * Coverage: NEGATIVE (other run refused and the holder named; second run's overlapping claim refused; unattested
 * claimant refused) / HAPPY (the holder archives; the same run holds two overlapping tasks) / REGRESSION
 * (no-run writers keep the name comparison) / STATE (nothing archived or claimed on a refusal).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { sessionActorFor } from "../../helpers/session-actor";
import { loosenOverrideClasses } from "../fixtures/autonomy-override-helpers.js";
import {
  R1,
  R2,
  claim,
  createCorpus,
  getClaim,
  registerRun,
  runLore,
  type Corpus,
} from "./support/claim-run-fixture.js";

setDefaultTimeout(180_000);

const NAME = sessionActorFor("agent:surface-shared-name");
const ANCHOR = "packages/core/src/session.ts";

let plain: Corpus;
let gated: Corpus;

beforeAll(async () => {
  plain = await createCorpus();
  gated = await createCorpus({ claimGates: "enabled" });
  // AU-T7: `done --override-attestation` is decided; this suite's subject is not the override, so the class is loosened
  // the documented way (a human-tty governance decision on a throwaway corpus), never by a bypass in product code.
  await loosenOverrideClasses(plain.dir, ["override-attestation"]);
  await loosenOverrideClasses(gated.dir, ["override-attestation"]);
});

afterAll(() => {
  plain.cleanup();
  gated.cleanup();
});

function doneAs(dir: string, target: string, name: string, run?: string) {
  return runLore(["done", target, "--override-attestation", "surface fixture: the holder check is under test"], dir, run, name);
}

function statusOf(dir: string, target: string): string {
  const shown = runLore(["get", target, "--json"], dir);
  expect(shown.exitCode).toBe(0);
  const parsed = JSON.parse(shown.stdout) as { data: { doc?: { status: string }; status?: string } };
  return parsed.data.doc?.status ?? parsed.data.status ?? "unknown";
}

describe("lore done through the CLI decides the holder by run (spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-3)", () => {
  it("NEGATIVE: run R2 with the SAME derived name is refused a fresh claim of R1, the refusal names R1, nothing is archived", async () => {
    const target = await plain.newTarget("task");
    registerRun(plain.dir, R1);
    registerRun(plain.dir, R2);
    expect(claim(plain.dir, target, NAME, { run: R1 }).exitCode).toBe(0);

    const refused = doneAs(plain.dir, target, NAME, R2);

    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain(R1);
    expect(statusOf(plain.dir, target)).not.toBe("archived");
    expect(getClaim(plain.dir, target)?.harness_run).toBe(R1);
  });

  it("HAPPY control: the holding run R1 archives its own claim", async () => {
    const target = await plain.newTarget("task");
    registerRun(plain.dir, R1);
    expect(claim(plain.dir, target, NAME, { run: R1 }).exitCode).toBe(0);

    const done = doneAs(plain.dir, target, NAME, R1);

    expect(done.exitCode).toBe(0);
    expect(statusOf(plain.dir, target)).toBe("archived");
  });

  it("NEGATIVE: a caller with no run and the holder's name is refused a run-held fresh claim", async () => {
    const target = await plain.newTarget("task");
    registerRun(plain.dir, R1);
    expect(claim(plain.dir, target, NAME, { run: R1 }).exitCode).toBe(0);

    const refused = doneAs(plain.dir, target, NAME);

    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain(R1);
    expect(statusOf(plain.dir, target)).not.toBe("archived");
  });

  it("REGRESSION: with no run on either side the name decides (same name archives)", async () => {
    const target = await plain.newTarget("task");
    expect(claim(plain.dir, target, NAME).exitCode).toBe(0);

    expect(doneAs(plain.dir, target, NAME).exitCode).toBe(0);
  });
});

describe("the claim gate's anchor overlap decides by run through the CLI (spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-3, BR-1056)", () => {
  it("NEGATIVE: a second run sharing the derived name is refused an overlapping claim", async () => {
    const first = await gated.newTarget("task", [ANCHOR]);
    const second = await gated.newTarget("task", [ANCHOR]);
    registerRun(gated.dir, R1);
    registerRun(gated.dir, R2);
    expect(claim(gated.dir, first, NAME, { run: R1 }).exitCode).toBe(0);

    const refused = claim(gated.dir, second, NAME, { run: R2 });

    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain("anchor-overlap");
    expect(getClaim(gated.dir, second)).toBeUndefined();
  });

  it("HAPPY control: the SAME run may hold two overlapping tasks (one holder)", async () => {
    const first = await gated.newTarget("task", [ANCHOR]);
    const second = await gated.newTarget("task", [ANCHOR]);
    registerRun(gated.dir, R1);
    expect(claim(gated.dir, first, NAME, { run: R1 }).exitCode).toBe(0);

    const allowed = claim(gated.dir, second, NAME, { run: R1 });

    expect(allowed.exitCode).toBe(0);
    expect(getClaim(gated.dir, second)?.harness_run).toBe(R1);
  });

  it("NEGATIVE: a claimant without a run is refused an overlapping claim against a run-holding sibling, same name", async () => {
    const first = await gated.newTarget("task", [ANCHOR]);
    const second = await gated.newTarget("task", [ANCHOR]);
    registerRun(gated.dir, R1);
    expect(claim(gated.dir, first, NAME, { run: R1 }).exitCode).toBe(0);

    const refused = claim(gated.dir, second, NAME);

    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain("anchor-overlap");
    expect(getClaim(gated.dir, second)).toBeUndefined();
  });
});
