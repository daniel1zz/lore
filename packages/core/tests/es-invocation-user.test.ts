/**
 * ES-D: the OS user lookup failing is an explicit Invocation value, not an entry crash
 * (spec-process-state-end-state-one-invocation-per-entry-returned D1, rule AS-26).
 *
 * Mechanism under test: `resolveInvocation` records the lookup outcome in `Invocation.user`; actor resolution fails
 * loud only when the OS-username tier is the one selected.
 */
import { describe, expect, it } from "vitest";
import { OsUserLookupError, resolveActorWithSource, resolveActorWithWorktree, resolveInvocation } from "@lore/core/node";
import type { InvocationResolvers } from "@lore/core/node";

const FAILED_REASON = "ENOENT: no passwd entry for uid 4242";

function resolversWith(osUsername: () => string, worktreeActor: () => string | undefined = () => undefined): InvocationResolvers {
  return {
    claudeDir: ({ home }) => `${home}/.claude`,
    userConfigDir: (_env, home) => `${home}/.config/lore`,
    worktreeActor,
    osUsername,
    projectRoot: () => null,
  };
}

function throwingLookup(): string {
  throw new Error(FAILED_REASON);
}

describe("AC-ES-D resolveInvocation records the user lookup", () => {
  it("a lookup that throws still returns an Invocation whose user is the failure with the thrown message", () => {
    const inv = resolveInvocation(["--by", "alice"], resolversWith(throwingLookup));
    expect(inv.user).toEqual({ ok: false, reason: FAILED_REASON });
    expect(inv.identity.claimed).toBe("alice");
  });

  it("a lookup that succeeds records the name", () => {
    const inv = resolveInvocation(["--by", "alice"], resolversWith(() => "bob"));
    expect(inv.user).toEqual({ ok: true, name: "bob" });
  });

  it("a worktree-derived name makes a failed lookup irrelevant at the entry", () => {
    const inv = resolveInvocation([], resolversWith(throwingLookup, () => "agent:branch-x"));
    // the live env's session tier (when present) outranks the working copy; either way nothing throws
    expect(inv.user).toEqual({ ok: false, reason: FAILED_REASON });
    expect(inv.identity.claimedSource === "worktree" || inv.identity.claimedSource === "session").toBe(true);
  });

  it("the OS tier selected with a failed lookup fails loud at the entry, naming the reason", () => {
    const env = { ...process.env };
    delete env["CLAUDE_CODE_SESSION_ID"];
    delete env["CLAUDE_SESSION_ID"];
    expect(() => resolveActorWithSource(undefined, env, { ok: false, reason: FAILED_REASON })).toThrow(OsUserLookupError);
  });
});

describe("AC-ES-D actor resolution with a failed lookup", () => {
  const failed = { ok: false, reason: FAILED_REASON } as const;
  const session = { CLAUDE_CODE_SESSION_ID: "3de02220-aaaa-bbbb-cccc-111122223333" };

  it("an explicit identity succeeds", () => {
    expect(resolveActorWithSource("alice", {}, failed)).toEqual({ actor: "alice", source: "explicit" });
  });

  it("a session identity succeeds", () => {
    expect(resolveActorWithSource(undefined, session, failed)).toEqual({ actor: "agent:session-3de02220", source: "session" });
  });

  it("a worktree-derived identity succeeds", () => {
    expect(resolveActorWithWorktree(undefined, {}, failed, () => "agent:feature-x")).toEqual({
      actor: "agent:feature-x",
      source: "worktree-derived",
    });
  });

  it("falling through to the OS tier raises the LoreError naming the reason", () => {
    let thrown: unknown;
    try {
      resolveActorWithWorktree(undefined, {}, failed, () => undefined);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OsUserLookupError);
    const loreError = (thrown as OsUserLookupError).loreError;
    expect(loreError.code).toBe("VALIDATION_ERROR");
    expect(loreError.message).toContain(FAILED_REASON);
  });

  it("a session id that sanitizes to nothing falls through to the OS tier and fails loud", () => {
    expect(() => resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "!!!" }, failed)).toThrow(OsUserLookupError);
  });

  it("a successful lookup is the OS-tier name", () => {
    expect(resolveActorWithSource(undefined, {}, { ok: true, name: "bob" })).toEqual({ actor: "bob", source: "os-fallback" });
  });
});
