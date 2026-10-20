/**
 * Spec: spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 1-5 (BR-1055, BR-1350, BR-1351).
 *
 * resolveInvocationIdentity(argv, env, humanSession) returns `{ identity, argv }`: `argv` is the input with the
 * harness-owned `--harness-run <id>` removed; `identity` is the known party the invocation writes as:
 *   - an attested AGENT run (`--harness-run cc:...`): its run, the name derived from the run (`agent:session-<8>`),
 *     source `run`;
 *   - else the human session of the checkout (named by the person), source `human` — never for a process that carries an
 *     agent harness marker;
 *   - else NO known party: `claimed: null` and a refusal reason naming `lore session start --human` and `lore setup`.
 * `--by`, `$LORE_ACTOR`, the session id, the working copy and the computer's user name supply no name.
 *
 * Every test injects argv/env/human-session explicitly; the real process is never read.
 *
 * Dimensions: HAPPY (run, human), NEGATIVE (no party, marker, non-agent run flag), BOUNDARY (flag forms, empty value),
 * STATE (argv not mutated, the session lookup is lazy), REGRESSION (`--by` stays in argv untouched).
 */
import { describe, expect, it } from "vitest";
import {
  HARNESS_ADAPTERS,
  deriveHumanRunId,
  derivePartyRunId,
  hasAgentHarnessMarker,
  isAgentRunId,
  nameOfAgentRun,
} from "@lore/core";
import type { RunId } from "@lore/core";
import { RunIdentityArgumentError, UnknownPartyError, resolveInvocationIdentity } from "@lore/core/node";

const NO_SESSION = (): null => null;
const DANA = (): { name: string; run: RunId } => ({ name: "dana", run: deriveHumanRunId("a".repeat(64)) });
const SESSION_ID = "3de02220-5d69-4b5a-ac23-d66e14c0261b";

describe("resolveInvocationIdentity", () => {
  describe("--harness-run strip", () => {
    it("returns argv without --harness-run and its value, and keeps the other tokens in order", () => {
      const out = resolveInvocationIdentity(["claim", "t", "--harness-run", "cc:S1", "--json"], {}, NO_SESSION);
      expect(out.argv).toEqual(["claim", "t", "--json"]);
    });

    it("accepts the --harness-run=<id> form", () => {
      const out = resolveInvocationIdentity(["get", "d", "--harness-run=cc:S2"], {}, NO_SESSION);
      expect(out.argv).toEqual(["get", "d"]);
      expect(out.identity.harnessRun).toBe("cc:S2");
    });

    it("does not mutate the caller's argv array", () => {
      const input = ["claim", "t", "--harness-run", "cc:S1"];
      resolveInvocationIdentity(input, {}, NO_SESSION);
      expect(input).toEqual(["claim", "t", "--harness-run", "cc:S1"]);
    });

    it.each([
      [["status", "--harness-run"], "requires a value"],
      [["status", "--harness-run", ""], "must not be empty"],
      [["status", "--harness-run", "   "], "must not be empty"],
    ])("a malformed flag %j is refused loudly (%s)", (argv, reason) => {
      expect(() => resolveInvocationIdentity(argv, {}, NO_SESSION)).toThrow(RunIdentityArgumentError);
      expect(() => resolveInvocationIdentity(argv, {}, NO_SESSION)).toThrow(reason);
    });

    it.each(["human:0123456789abcdef", "api-key:ci-bot", "dashboard:dana", "run-without-prefix"])(
      "a non-agent run id %s cannot be claimed from the command line (no one writes as another party by naming its run)",
      (run) => {
        expect(() => resolveInvocationIdentity(["set", "x", "--harness-run", run], {}, DANA)).toThrow(RunIdentityArgumentError);
      },
    );
  });

  describe("an attested agent run", () => {
    it("is the party: its run, a name derived from the run's session, source run", () => {
      const { identity } = resolveInvocationIdentity(["set", "x", "--harness-run", `cc:${SESSION_ID}`], {}, NO_SESSION);
      expect(identity).toEqual({ harnessRun: `cc:${SESSION_ID}`, claimed: "agent:session-3de02220", claimedSource: "run" });
    });

    it("names a subagent run by its session too, and different sessions get different names", () => {
      const sub = resolveInvocationIdentity(["x", "--harness-run", `cc:${SESSION_ID}:agentabc`], {}, NO_SESSION).identity;
      const other = resolveInvocationIdentity(["x", "--harness-run", "cc:aaaaaaaa-0000"], {}, NO_SESSION).identity;
      expect(sub.claimed).toBe("agent:session-3de02220");
      expect(other.claimed).toBe("agent:session-aaaaaaaa");
    });

    it("wins over an open human session (an attested run is never replaced by a person)", () => {
      const { identity } = resolveInvocationIdentity(["x", "--harness-run", "cc:S9"], {}, DANA);
      expect(identity.claimedSource).toBe("run");
    });

    it("does not consult the human session at all", () => {
      let consulted = false;
      resolveInvocationIdentity(["x", "--harness-run", "cc:S9"], {}, () => {
        consulted = true;
        return null;
      });
      expect(consulted).toBe(false);
    });
  });

  describe("a human session", () => {
    it("is the party for an invocation with no run and no agent marker: the person's name, the session's run, source human", () => {
      const { identity } = resolveInvocationIdentity(["set", "x"], {}, DANA);
      expect(identity).toEqual({ harnessRun: deriveHumanRunId("a".repeat(64)), claimed: "dana", claimedSource: "human" });
    });

    it("is NEVER used by a process carrying an agent harness marker (CLAUDECODE=1): that is no party, with a refusal", () => {
      const { identity } = resolveInvocationIdentity(["set", "x"], { CLAUDECODE: "1" }, DANA);
      expect(identity.claimed).toBeNull();
      expect(identity.harnessRun).toBeNull();
      if (identity.claimed !== null) throw new Error("unreachable");
      expect(identity.unresolvedReason).toContain("agent");
      expect(identity.unresolvedReason).toContain("lore session start --human");
      expect(identity.unresolvedReason).toContain("lore setup");
    });

    it("a marker value other than the harness's own does not mark an agent (only CLAUDECODE=1 does)", () => {
      expect(resolveInvocationIdentity(["x"], { CLAUDECODE: "0" }, DANA).identity.claimedSource).toBe("human");
      expect(resolveInvocationIdentity(["x"], { CLAUDECODE: "" }, DANA).identity.claimedSource).toBe("human");
    });
  });

  describe("no known party", () => {
    it("yields an unresolved identity whose reason names BOTH remedies; reads can still proceed", () => {
      const { identity } = resolveInvocationIdentity(["get", "x"], {}, NO_SESSION);
      expect(identity.harnessRun).toBeNull();
      expect(identity.claimed).toBeNull();
      expect(identity.claimedSource).toBeNull();
      if (identity.claimed !== null) throw new Error("unreachable");
      expect(identity.unresolvedReason).toContain("lore session start --human");
      expect(identity.unresolvedReason).toContain("lore setup");
    });

    it("$LORE_ACTOR, the session id, a worktree and the computer user supply NO name", () => {
      const env = { LORE_ACTOR: "agent:bob", CLAUDE_CODE_SESSION_ID: SESSION_ID, CLAUDE_SESSION_ID: SESSION_ID, USER: "apple", LOGNAME: "apple" };
      expect(resolveInvocationIdentity(["x"], env, NO_SESSION).identity.claimed).toBeNull();
    });

    it("--by supplies no name and stays in argv untouched (a few commands give it their own meaning)", () => {
      const out = resolveInvocationIdentity(["ac", "supersede", "--by", "alice"], {}, NO_SESSION);
      expect(out.identity.claimed).toBeNull();
      expect(out.argv).toEqual(["ac", "supersede", "--by", "alice"]);
    });

    it("an empty --by is not an identity error any more: it is just an argument", () => {
      expect(() => resolveInvocationIdentity(["x", "--by", ""], {}, NO_SESSION)).not.toThrow();
    });

    it("UnknownPartyError carries a VALIDATION_ERROR LoreError on field identity", () => {
      const error = new UnknownPartyError("no party");
      expect(error.loreError).toEqual({ code: "VALIDATION_ERROR", field: "identity", message: "no party" });
    });
  });
});

describe("run identity helpers", () => {
  it("every shipped agent integration declares its harness marker (BR-1350)", () => {
    for (const adapter of Object.values(HARNESS_ADAPTERS)) {
      expect(adapter.marker.env).not.toBe("");
      expect(adapter.marker.value).not.toBe("");
      expect(adapter.runIdPrefix).not.toBe("");
    }
    expect(HARNESS_ADAPTERS["claude-code"]?.marker).toEqual({ env: "CLAUDECODE", value: "1" });
  });

  it("hasAgentHarnessMarker matches exactly the declared marker", () => {
    expect(hasAgentHarnessMarker({ CLAUDECODE: "1" })).toBe(true);
    expect(hasAgentHarnessMarker({ CLAUDECODE: "true" })).toBe(false);
    expect(hasAgentHarnessMarker({})).toBe(false);
  });

  it("isAgentRunId separates agent runs from party runs", () => {
    expect(isAgentRunId("cc:S1")).toBe(true);
    expect(isAgentRunId(deriveHumanRunId("b".repeat(64)))).toBe(false);
    expect(isAgentRunId(derivePartyRunId("api-key", "ci-bot"))).toBe(false);
    expect(isAgentRunId(derivePartyRunId("dashboard", "dana"))).toBe(false);
  });

  it("nameOfAgentRun derives agent:session-<8> and refuses a run that is not an agent run", () => {
    expect(nameOfAgentRun(`cc:${SESSION_ID}` as RunId)).toBe("agent:session-3de02220");
    expect(() => nameOfAgentRun("human:0123456789abcdef" as RunId)).toThrow();
  });

  it("a human run id derives from the token hash (16 hex) and needs a full SHA-256", () => {
    expect(deriveHumanRunId("0123456789abcdef".repeat(4))).toBe("human:0123456789abcdef");
    expect(() => deriveHumanRunId("short")).toThrow();
  });

  it("api-key and dashboard run ids are stable per name and distinct per name, even for names with odd characters", () => {
    expect(derivePartyRunId("api-key", "ci-bot")).toBe("api-key:ci-bot");
    expect(derivePartyRunId("dashboard", "Dana Q")).toBe("dashboard:Dana%20Q");
    expect(derivePartyRunId("dashboard", "a b")).not.toBe(derivePartyRunId("dashboard", "a_b"));
    expect(() => derivePartyRunId("api-key", "  ")).toThrow();
  });
});
