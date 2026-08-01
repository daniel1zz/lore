/**
 * Tests for `computeGitDiffMaxBuffer` and `formatGitDiffEnobufsMessage` in
 * `adapters/cli/assess-render.ts` (task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1).
 *
 * These are the PURE units extracted from `commands/assess.ts`'s `--diff` git-spawn call
 * site so they are unit-testable directly under vitest (`commands/assess.ts` transitively
 * imports the bun-only `loader.ts`). The end-to-end ENOBUFS behavior (real `spawnSync`
 * driven past a small configured buffer, exit code, no-doc-created STATE assertion) is
 * covered by `tests/integration/cli/assess-ai.bun.test.ts`'s
 * "git-diff spawnSync maxBuffer" describe block — this file covers the arithmetic and
 * message-rendering these behaviors are built from.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      the default effective max_diff_chars (24000) sizes a 96000-byte buffer
 *               (4 bytes/char worst-case UTF-8); the ENOBUFS message names both the
 *               buffer size and the ai.assess.max_diff_chars knob, never git
 *   NEGATIVE:   the ENOBUFS message never contains the pre-fix misleading wording
 *               ("spawnSync ENOBUFS" attributed to git) that sent operators to the
 *               wrong place
 *   BOUNDARY:   the smallest valid config value (max_diff_chars=1) computes exactly 4
 *               bytes — no off-by-one in the multiplier
 *   ERROR:      a `range` argument containing characters a naive template could mangle
 *               (quotes, `..`) still renders literally, unescaped and undamaged
 *   STATE:      both functions are pure — repeated calls with the same input produce
 *               byte-identical output
 *   REGRESSION: the message shape is pinned (buffer bytes + the exact
 *               `ai.assess.max_diff_chars=<n>` token) so a future edit can't silently
 *               regress to the generic "failed: <reason>" wording this task replaced
 *
 * Source: task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1 (AC-1, AC-2)
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { computeGitDiffMaxBuffer, formatGitDiffEnobufsMessage } from "../../../../src/adapters/cli/assess-render.js";

describe("computeGitDiffMaxBuffer", () => {
  it("HAPPY: the default effective max_diff_chars (24000) sizes a 96000-byte buffer (4 bytes/char)", () => {
    expect(computeGitDiffMaxBuffer(24000)).toBe(96000);
  });

  it("BOUNDARY: the smallest valid config value (1) computes exactly 4 bytes — no off-by-one", () => {
    expect(computeGitDiffMaxBuffer(1)).toBe(4);
  });

  it("STATE: pure — repeated calls with the same input return the identical value", () => {
    const a = computeGitDiffMaxBuffer(8000);
    const b = computeGitDiffMaxBuffer(8000);
    expect(a).toBe(b);
    expect(a).toBe(32000);
  });

  it("REGRESSION: scales linearly with the EFFECTIVE value, tracking a config override rather than the hardcoded 24000 default", () => {
    // A config override of ai.assess.max_diff_chars must change the buffer too — this
    // pins that the function takes the caller-supplied EFFECTIVE value, never a
    // module-internal constant.
    expect(computeGitDiffMaxBuffer(80000)).toBe(320000);
    expect(computeGitDiffMaxBuffer(80000)).not.toBe(computeGitDiffMaxBuffer(24000));
  });
});

// ─── BOUNDARY: real spawnSync driven exactly at computeGitDiffMaxBuffer's line ────────
//
// Decoupled from the whole `lore assess` CLI flow (see assess-ai.bun.test.ts's
// "git-diff spawnSync maxBuffer" describe block for that end-to-end coverage): this
// drives Node's REAL spawnSync (external oracle, not mocked) with a deterministic
// exact-byte-count producer (`head -c <n> /dev/zero`) so "just under" vs "just over"
// the computed buffer is tested at the exact byte the fix is responsible for — with no
// entanglement from the CLI's SEPARATE char-based prompt-truncation logic, which reuses
// the same `ai.assess.max_diff_chars` value for an unrelated purpose (see the note in
// assess-ai.bun.test.ts's BOUNDARY-under test for why that entanglement matters).
describe("computeGitDiffMaxBuffer — real spawnSync boundary", () => {
  it("BOUNDARY: output exactly AT the computed buffer completes with no error", () => {
    const maxBuffer = computeGitDiffMaxBuffer(100); // 400 bytes
    const result = spawnSync("head", ["-c", String(maxBuffer), "/dev/zero"], { encoding: "utf8", maxBuffer });
    expect(result.error).toBeUndefined();
    expect(result.stdout.length).toBe(maxBuffer);
  });

  it("BOUNDARY: output one byte OVER the computed buffer triggers ENOBUFS", () => {
    const maxBuffer = computeGitDiffMaxBuffer(100); // 400 bytes
    const result = spawnSync("head", ["-c", String(maxBuffer + 1), "/dev/zero"], { encoding: "utf8", maxBuffer });
    expect((result.error as NodeJS.ErrnoException | undefined)?.code).toBe("ENOBUFS");
  });
});

describe("formatGitDiffEnobufsMessage", () => {
  it("HAPPY: names the buffer size and the ai.assess.max_diff_chars knob, not git", () => {
    const msg = formatGitDiffEnobufsMessage("HEAD~3..HEAD", 96000, 24000);
    expect(msg).toContain("HEAD~3..HEAD");
    expect(msg).toContain("96000 bytes");
    expect(msg).toContain("ai.assess.max_diff_chars=24000");
    expect(msg).toContain("not a git failure");
  });

  it("NEGATIVE: never renders the pre-fix misleading wording that blamed git for this call site's own ceiling", () => {
    const msg = formatGitDiffEnobufsMessage("HEAD~3..HEAD", 96000, 24000);
    expect(msg).not.toContain("spawnSync ENOBUFS");
    // The old message shape started "git diff <range> failed: <reason>" with no mention
    // of a buffer at all — this message must not collapse back to that generic shape.
    expect(msg.startsWith("Error: git diff HEAD~3..HEAD failed:")).toBe(false);
  });

  it("ERROR: a range containing quotes/dots renders literally, unescaped", () => {
    const weirdRange = `HEAD~1..HEAD"; rm -rf /`;
    const msg = formatGitDiffEnobufsMessage(weirdRange, 400, 100);
    expect(msg).toContain(weirdRange);
    expect(msg).toContain("400 bytes");
    expect(msg).toContain("ai.assess.max_diff_chars=100");
  });

  it("STATE: pure — repeated calls with the same input produce byte-identical output", () => {
    const a = formatGitDiffEnobufsMessage("HEAD~1..HEAD", 4000, 1000);
    const b = formatGitDiffEnobufsMessage("HEAD~1..HEAD", 4000, 1000);
    expect(a).toBe(b);
  });

  it("BOUNDARY: returns a single-line message with no trailing newline (caller appends one, matching formatError's convention)", () => {
    const msg = formatGitDiffEnobufsMessage("HEAD~1..HEAD", 400, 100);
    expect(msg.endsWith("\n")).toBe(false);
    expect(msg.includes("\n")).toBe(false);
  });

  it("REGRESSION: the buffer and knob values are always DERIVED from the arguments, never hardcoded — different inputs render different numbers", () => {
    const small = formatGitDiffEnobufsMessage("HEAD~1..HEAD", 400, 100);
    const large = formatGitDiffEnobufsMessage("HEAD~1..HEAD", 320000, 80000);
    expect(small).toContain("400 bytes");
    expect(small).toContain("ai.assess.max_diff_chars=100");
    expect(large).toContain("320000 bytes");
    expect(large).toContain("ai.assess.max_diff_chars=80000");
    expect(small).not.toBe(large);
  });
});
