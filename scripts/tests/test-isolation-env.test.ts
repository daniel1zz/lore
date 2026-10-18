// @reads scripts/test-isolation-env.ts
/**
 * TG-49: the per-worker child-environment probe (assertChildrenInheritSandbox) must not misreport a
 * LOST probe stdout as an unarmed environment.
 *
 * Measured 2026-10-19 (bun 1.x, 12 concurrent stress loops of 3000 spawnSync("sh", ["-c", "printf ..."])
 * each): about 1 in 18000 spawnSync calls under the Bun runtime returns stdout "" with status 0 and no
 * error. The probe used to read the marker out of stdout, so such a call looked like "child saw
 * LORE_TEST_SANDBOX=\"\" and LORE_TEST_SANDBOX_REPO=null" and failed a whole test file
 * (fts-query.test.ts in the full run at 8f5ac21a) although the environment was armed. The verdict now
 * comes from the child's exit status, which the same stress runs never lost.
 */
import { describe, expect, it } from "vitest";
import { assertChildrenInheritSandbox, type ProbeSpawn } from "../test-isolation-env";

const armed = process.env["LORE_TEST_SANDBOX_REPO"];

function stub(result: { status: number | null; stdout?: string; error?: Error }): ProbeSpawn {
  return () => ({ status: result.status, stdout: result.stdout ?? "", error: result.error });
}

describe("assertChildrenInheritSandbox: the verdict is the child's exit status, not its stdout", () => {
  it("REGRESSION: a child that exited 0 with its stdout LOST (the measured Bun spawnSync failure) is not an unarmed environment", () => {
    expect(armed).toBeTruthy();
    expect(() => assertChildrenInheritSandbox(stub({ status: 0, stdout: "" }))).not.toThrow();
  });

  it("HAPPY: the real spawn (no stub) passes in this armed worker", () => {
    expect(() => assertChildrenInheritSandbox()).not.toThrow();
  });

  it("NEGATIVE: a child that reports the marker unarmed (exit 3) fails loud naming the marker", () => {
    expect(() => assertChildrenInheritSandbox(stub({ status: 3 }))).toThrow(/LORE_TEST_SANDBOX is not "1"/);
  });

  it("NEGATIVE: a child that reports the protected repository missing or different (exit 4) fails loud naming it", () => {
    expect(() => assertChildrenInheritSandbox(stub({ status: 4 }))).toThrow(/LORE_TEST_SANDBOX_REPO/);
  });

  it("ERROR: a probe that could not run fails loud with its own message", () => {
    expect(() => assertChildrenInheritSandbox(stub({ status: null, error: new Error("spawn sh ENOENT") }))).toThrow(/probe failed to run: spawn sh ENOENT/);
  });

  it("ERROR: an unknown exit status is reported, never read as armed", () => {
    expect(() => assertChildrenInheritSandbox(stub({ status: 9 }))).toThrow(/probe failed to run: exit 9/);
  });
});
