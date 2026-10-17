/**
 * `executeVerifySpawnSpec` single-stream tail: the AC command's stderr and stdout
 * travel through ONE pipe, so a PASS line printed on stdout AFTER >4000 chars of
 * stderr noise is still in the stored tail (task-gh-1343388703-181, lore issue #181 —
 * the `verify` half; the `--capture` half is
 * tests/unit/adapters/evidence-capture-single-stream.test.ts).
 *
 * Six-dimension coverage:
 *   HAPPY      — noise on stderr, then `AC-X PASS: summary` on stdout, tail has the PASS line
 *   NEGATIVE   — a non-zero AC command keeps its own exit code (3) and the summary
 *   BOUNDARY   — tail stays within 4000 chars
 *   ERROR      — launch failure of a bare binary is still STORE_ERROR (not exit 127)
 *   STATE      — terminal order stdout, stderr, stdout is preserved
 *   REGRESSION — the acRef-anchored window still finds the AC id
 *
 * @spec_ref task-gh-1343388703-181
 */

import { describe, expect, test } from "vitest";
import { executeVerifySpawnSpec } from "../../src/service/verify-executor.js";
import type { VerifySpawnSpec } from "../../src/service/verify-spawn.js";

const NOISE_THEN_PASS =
  "head -c 6000 /dev/zero | tr '\\0' 'x' >&2; echo >&2; echo 'AC-X PASS: summary'";

function spec(script: string, acRef?: string): VerifySpawnSpec {
  return {
    cmd: ["sh", "-c", script],
    cwd: process.cwd(),
    timeoutMs: 30_000,
    killGraceMs: 1000,
    ...(acRef !== undefined ? { acRef } : {}),
  };
}

describe("executeVerifySpawnSpec single stream", () => {
  test("VSS-H1: a stdout PASS line after >4000 chars of stderr noise is in the tail", async () => {
    const result = await executeVerifySpawnSpec(spec(NOISE_THEN_PASS));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exitCode).toBe(0);
    expect(result.value.outputTail).toContain("AC-X PASS: summary");
    expect(result.value.outputTail.length).toBeLessThanOrEqual(4000);
  });

  test("VSS-N1: a non-zero AC command keeps its own exit code and the summary", async () => {
    const result = await executeVerifySpawnSpec(spec(`${NOISE_THEN_PASS}; exit 3`));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exitCode).toBe(3);
    expect(result.value.outputTail).toContain("AC-X PASS: summary");
  });

  test("VSS-E1: a bare nonexistent binary is still a launch failure, not exit 127", async () => {
    const result = await executeVerifySpawnSpec({
      cmd: ["this-binary-definitely-does-not-exist-xyz-123"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      killGraceMs: 1000,
    });
    expect(result.ok).toBe(false);
  });

  test("VSS-S1: the tail keeps terminal order stdout, stderr, stdout", async () => {
    const result = await executeVerifySpawnSpec(
      spec("echo first-out; sleep 0.1; echo second-err >&2; sleep 0.1; echo third-out"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tail = result.value.outputTail;
    expect(tail.indexOf("first-out")).toBeGreaterThanOrEqual(0);
    expect(tail.indexOf("first-out")).toBeLessThan(tail.indexOf("second-err"));
    expect(tail.indexOf("second-err")).toBeLessThan(tail.indexOf("third-out"));
  });

  test("VSS-R1: the acRef-anchored window still witnesses the AC id", async () => {
    const result = await executeVerifySpawnSpec(spec(NOISE_THEN_PASS, "AC-X"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outputTail).toContain("AC-X PASS: summary");
  });
});
