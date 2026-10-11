/**
 * AC-069-1 — `resolveActorWithSource`'s full precedence chain, gaining the
 * SPEC-069 F1 "session" tier between `$LORE_ACTOR` and OS-username fallback:
 * `--by` (explicit) > `$LORE_ACTOR` (env) > `$CLAUDE_CODE_SESSION_ID` /
 * `$CLAUDE_SESSION_ID` (session) > OS username (os-fallback).
 *
 * Every case here passes a LITERAL env object as the function's second
 * parameter (SPEC-069 §Design Decisions D8) — ZERO `process.env` mutation
 * anywhere in this file, so this suite can run in parallel with any other
 * vitest file without env-pollution hazards (unlike the pre-existing
 * `tests/unit/adapters/cli-utils.test.ts` os-fallback suite, which mutates
 * real `process.env["LORE_ACTOR"]` and is therefore — pre-existing, out of
 * this task's file anchors — sensitive to a REAL `$CLAUDE_CODE_SESSION_ID`
 * inherited from the ambient shell; not this file's concern since it never
 * touches `process.env`).
 *
 * Six-dimension coverage: HAPPY (env tier, session tier both id-var forms) /
 * NEGATIVE (explicit beats a fully-populated env — every lower tier present
 * simultaneously) / BOUNDARY (whitespace-only values at each tier fall
 * through exactly one level; a NON-whitespace value that still sanitizes to
 * empty — e.g. "---", "!!!" — passes the `.trim() !== ""` guard but must not
 * throw out of `resolveActorWithSource`, see the review-fix ERROR case below) /
 * ERROR (a sanitize-to-empty session id degrades to os-fallback instead of
 * propagating `sessionActorFromId`'s throw — `sessionActorFromId` itself
 * stays fail-loud, unit-tested at `tests/unit/core/session-actor.test.ts`;
 * this suite covers the CLI tier's catch-and-degrade wrapper) / STATE (alias
 * precedence between the two session env var names) / REGRESSION
 * (`ActorSource` literal union includes `"session"`; the exact spec-quoted
 * id `"3DE02220-5d69-..."` example from SPEC-069's AC text).
 *
 * Runner: vitest (pure fn, no bun:sqlite, no IO).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveActorWithSource,
  resolveActor,
  resetActorFallbackWarningForTests,
  type ActorSource,
} from "../../../src/adapters/cli/utils.js";

/**
 * SPEC-104 fallout (`knowledge-spec-104-fallout-changed-tests-ts-porcelain-path-bug`):
 * `resolveActorWithSource`'s default `cwd` is now load-bearing — an ambient
 * cwd sitting inside a linked git worktree (this repo's OWN standard
 * subagent-dispatch pattern) correctly resolves `agent:<branch>` instead of
 * falling through to the os-fallback tier every "os-fallback" assertion in
 * this file expects. This fixture is a real `.git` DIRECTORY (a "main
 * checkout" shape, per `detectWorktreeDerivedActor`'s own contract), pinned
 * explicitly as the 3rd `cwd` argument wherever an os-fallback result is
 * asserted — never relying on the ambient test-process cwd.
 */
function makeNonWorktreeCwdFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-actor-session-tier-non-worktree-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "actor-session-tier-fixture@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Actor Session Tier Fixture"], { cwd: dir });
  return dir;
}

describe("SPEC-069 AC-069-1: resolveActorWithSource session tier", () => {
  let nonWorktreeCwd: string;

  beforeAll(() => {
    nonWorktreeCwd = makeNonWorktreeCwdFixture();
  });

  afterAll(() => {
    rmSync(nonWorktreeCwd, { recursive: true, force: true });
  });

  describe("HAPPY", () => {
    it("--by explicit wins even with LORE_ACTOR and a session id both present in env", () => {
      const result = resolveActorWithSource("alice", {
        LORE_ACTOR: "agent:bob",
        CLAUDE_CODE_SESSION_ID: "3de02220-5d69-4b5a-ac23-d66e14c0261b",
      });
      expect(result).toEqual({ actor: "alice", source: "explicit" });
    });

    it("a present session id wins over a set $LORE_ACTOR (which is never read, BR-1055)", () => {
      const result = resolveActorWithSource(undefined, {
        LORE_ACTOR: "agent:x",
        CLAUDE_CODE_SESSION_ID: "abc",
      });
      expect(result).toEqual({ actor: "agent:session-abc", source: "session" });
    });

    it("session tier fires from CLAUDE_CODE_SESSION_ID when no --by and no $LORE_ACTOR (literal SPEC-069 AC example)", () => {
      const result = resolveActorWithSource(undefined, {
        CLAUDE_CODE_SESSION_ID: "3DE02220-5d69-4b5a-ac23-d66e14c0261b",
      });
      expect(result.actor).toBe("agent:session-3de02220");
      expect(result.source).toBe("session");
    });

    it("falls through to os-fallback when neither --by, $LORE_ACTOR, nor any session var is set", () => {
      const result = resolveActorWithSource(undefined, {}, nonWorktreeCwd);
      expect(result.source).toBe("os-fallback");
      expect(result.actor.length).toBeGreaterThan(0);
    });
  });

  describe("STATE — CLAUDE_SESSION_ID alias", () => {
    it("the CLAUDE_SESSION_ID alias fires the session tier when CLAUDE_CODE_SESSION_ID is absent", () => {
      const result = resolveActorWithSource(undefined, { CLAUDE_SESSION_ID: "abcdef12" });
      expect(result).toEqual({ actor: "agent:session-abcdef12", source: "session" });
    });

    it("CLAUDE_CODE_SESSION_ID takes precedence over the CLAUDE_SESSION_ID alias when both are set", () => {
      const result = resolveActorWithSource(undefined, {
        CLAUDE_CODE_SESSION_ID: "primary1",
        CLAUDE_SESSION_ID: "alias0002",
      });
      expect(result).toEqual({ actor: "agent:session-primary1", source: "session" });
    });
  });

  describe("BOUNDARY — whitespace-only values fall through exactly one tier", () => {
    it("a whitespace-only --by falls through to the session tier, never to $LORE_ACTOR", () => {
      const result = resolveActorWithSource("   ", {
        LORE_ACTOR: "agent:carol",
        CLAUDE_CODE_SESSION_ID: "deadbeef",
      });
      expect(result).toEqual({ actor: "agent:session-deadbeef", source: "session" });
    });

    it("a whitespace-only $LORE_ACTOR falls through to the session tier", () => {
      const result = resolveActorWithSource(undefined, {
        LORE_ACTOR: "   ",
        CLAUDE_CODE_SESSION_ID: "deadbeef",
      });
      expect(result).toEqual({ actor: "agent:session-deadbeef", source: "session" });
    });

    it("a whitespace-only session id falls through to os-fallback", () => {
      const result = resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "   " }, nonWorktreeCwd);
      expect(result.source).toBe("os-fallback");
    });

    it("an empty-string session id falls through to os-fallback", () => {
      const result = resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "" }, nonWorktreeCwd);
      expect(result.source).toBe("os-fallback");
    });

    it("a non-whitespace session id that sanitizes to empty (\"---\") falls through to os-fallback without throwing", () => {
      expect(() =>
        resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "---" }, nonWorktreeCwd),
      ).not.toThrow();
      const result = resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "---" }, nonWorktreeCwd);
      expect(result.source).toBe("os-fallback");
      expect(result.actor.length).toBeGreaterThan(0);
    });

    it("a non-whitespace session id that sanitizes to empty (\"!!!\") falls through to os-fallback without throwing", () => {
      expect(() =>
        resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "!!!" }, nonWorktreeCwd),
      ).not.toThrow();
      const result = resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "!!!" }, nonWorktreeCwd);
      expect(result.source).toBe("os-fallback");
      expect(result.actor.length).toBeGreaterThan(0);
    });

    it("the CLAUDE_SESSION_ID alias also degrades to os-fallback on a sanitize-to-empty value, not a throw", () => {
      const result = resolveActorWithSource(undefined, { CLAUDE_SESSION_ID: "___" }, nonWorktreeCwd);
      expect(result.source).toBe("os-fallback");
    });
  });

  describe("NEGATIVE — omitted env keys never crash, missing means absent", () => {
    it("an env object with unrelated keys only still falls through to os-fallback", () => {
      const result = resolveActorWithSource(undefined, { PATH: "/usr/bin", HOME: "/home/x" }, nonWorktreeCwd);
      expect(result.source).toBe("os-fallback");
    });
  });

  describe("REGRESSION", () => {
    it("ActorSource's literal union accepts 'session' (compile-time pin)", () => {
      const source: ActorSource = "session";
      expect(source).toBe("session");
    });

    it("omitting the env param entirely still type-checks and returns a ResolvedActor (default-param regression)", () => {
      const result = resolveActorWithSource("zed");
      expect(result).toEqual({ actor: "zed", source: "explicit" });
    });
  });

  // This describe block deliberately breaks the file's own "zero process.env
  // mutation" rule (see module docstring) — `resolveActor` (unlike
  // `resolveActorWithSource`) always reads real `process.env`, so exercising
  // its stderr advisory side effect on the sanitize-to-empty degrade path
  // requires real env vars. Full save/restore keeps this file parallel-safe.
  describe("ERROR — resolveActor's stderr advisory path still fires on the degrade route", () => {
    const ORIGINAL_ENV = { ...process.env };
    // `resolveActor` (unlike `resolveActorWithSource`) has no `cwd` parameter
    // — it always reads real `process.cwd()`. chdir into the same non-
    // worktree fixture for this test's duration (restored in `afterEach`) so
    // the os-fallback degrade path asserted below isn't shadowed by
    // worktree-derivation when this suite runs inside a linked worktree.
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      process.chdir(nonWorktreeCwd);
      delete process.env["LORE_ACTOR"];
      delete process.env["CLAUDE_CODE_SESSION_ID"];
      delete process.env["CLAUDE_SESSION_ID"];
      resetActorFallbackWarningForTests();
    });

    afterEach(() => {
      process.chdir(originalCwd);
      process.env = { ...ORIGINAL_ENV };
      resetActorFallbackWarningForTests();
    });

    it("a sanitize-to-empty CLAUDE_CODE_SESSION_ID (\"---\") degrades to os-fallback AND still emits the OS-fallback stderr advisory, without throwing", () => {
      process.env["CLAUDE_CODE_SESSION_ID"] = "---";
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      let actor = "";
      expect(() => {
        actor = resolveActor(undefined);
      }).not.toThrow();
      expect(actor.length).toBeGreaterThan(0);
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const [firstCallArg] = stderrSpy.mock.calls[0] as [string];
      expect(firstCallArg).toMatch(/OS username/);
      stderrSpy.mockRestore();
    });
  });
});
