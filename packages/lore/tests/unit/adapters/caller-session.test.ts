/**
 * @spec_ref spec-one-worktree-removal-test-for-the-guard-lore-done-and-a (D2: the caller's session)
 * @task task-single-worktree-removal-test-used-by-the-hook-lore-done
 */

import { describe, expect, it } from "vitest";
import { resolveCallerSession } from "../../../src/adapters/cli/caller-session.js";

describe("resolveCallerSession", () => {
  it("--session wins over the environment, trimmed", () => {
    expect(resolveCallerSession(" S9 ", { CLAUDE_CODE_SESSION_ID: "S1" })).toBe("S9");
  });

  it("CLAUDE_CODE_SESSION_ID is read before CLAUDE_SESSION_ID, raw (not the sanitized claim discriminator)", () => {
    expect(resolveCallerSession(undefined, { CLAUDE_CODE_SESSION_ID: "3DE02220-5d69", CLAUDE_SESSION_ID: "other" })).toBe("3DE02220-5d69");
    expect(resolveCallerSession(undefined, { CLAUDE_SESSION_ID: "fallback" })).toBe("fallback");
  });

  it("absent or blank everywhere is unknown (undefined) — never an empty-string owner", () => {
    expect(resolveCallerSession(undefined, {})).toBeUndefined();
    expect(resolveCallerSession("  ", { CLAUDE_CODE_SESSION_ID: "   " })).toBeUndefined();
  });
});
