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
 * through exactly one level) / ERROR (n/a — no throwing path in
 * `resolveActorWithSource` itself; sanitize-to-empty is exercised at the
 * `sessionActorFromId` unit in `tests/unit/core/session-actor.test.ts`) /
 * STATE (alias precedence between the two session env var names) /
 * REGRESSION (`ActorSource` literal union includes `"session"`; the exact
 * spec-quoted id `"3DE02220-5d69-..."` example from SPEC-069's AC text).
 *
 * Runner: vitest (pure fn, no bun:sqlite, no IO).
 */

import { describe, it, expect } from "vitest";
import { resolveActorWithSource, type ActorSource } from "../../../src/adapters/cli/utils.js";

describe("SPEC-069 AC-069-1: resolveActorWithSource session tier", () => {
  describe("HAPPY", () => {
    it("--by explicit wins even with LORE_ACTOR and a session id both present in env", () => {
      const result = resolveActorWithSource("alice", {
        LORE_ACTOR: "agent:bob",
        CLAUDE_CODE_SESSION_ID: "3de02220-5d69-4b5a-ac23-d66e14c0261b",
      });
      expect(result).toEqual({ actor: "alice", source: "explicit" });
    });

    it("$LORE_ACTOR wins over a present session id when --by is absent", () => {
      const result = resolveActorWithSource(undefined, {
        LORE_ACTOR: "agent:x",
        CLAUDE_CODE_SESSION_ID: "abc",
      });
      expect(result).toEqual({ actor: "agent:x", source: "env" });
    });

    it("session tier fires from CLAUDE_CODE_SESSION_ID when no --by and no $LORE_ACTOR (literal SPEC-069 AC example)", () => {
      const result = resolveActorWithSource(undefined, {
        CLAUDE_CODE_SESSION_ID: "3DE02220-5d69-4b5a-ac23-d66e14c0261b",
      });
      expect(result.actor).toBe("agent:session-3de02220");
      expect(result.source).toBe("session");
    });

    it("falls through to os-fallback when neither --by, $LORE_ACTOR, nor any session var is set", () => {
      const result = resolveActorWithSource(undefined, {});
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
    it("a whitespace-only --by falls through to $LORE_ACTOR", () => {
      const result = resolveActorWithSource("   ", { LORE_ACTOR: "agent:carol" });
      expect(result).toEqual({ actor: "agent:carol", source: "env" });
    });

    it("a whitespace-only $LORE_ACTOR falls through to the session tier", () => {
      const result = resolveActorWithSource(undefined, {
        LORE_ACTOR: "   ",
        CLAUDE_CODE_SESSION_ID: "deadbeef",
      });
      expect(result).toEqual({ actor: "agent:session-deadbeef", source: "session" });
    });

    it("a whitespace-only session id falls through to os-fallback", () => {
      const result = resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "   " });
      expect(result.source).toBe("os-fallback");
    });

    it("an empty-string session id falls through to os-fallback", () => {
      const result = resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "" });
      expect(result.source).toBe("os-fallback");
    });
  });

  describe("NEGATIVE — omitted env keys never crash, missing means absent", () => {
    it("an env object with unrelated keys only still falls through to os-fallback", () => {
      const result = resolveActorWithSource(undefined, { PATH: "/usr/bin", HOME: "/home/x" });
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
});
