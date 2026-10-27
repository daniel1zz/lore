/**
 * RED table for the run-identity carrier functions: rewriteBashCommand,
 * rewriteMcpInput, HARNESS_RUN_FLAG, and run id derivation through the
 * harness registry.
 *
 * Dimensions: HAPPY (flag inserted after each command-position lore word),
 * NEGATIVE (quoted text / heredoc body / `echo lore` untouched), BOUNDARY
 * (&&, ||, ;, |, VAR=value prefix, bare `lore`), STATE (idempotence, caller
 * flag overwritten, input not mutated), ERROR (unknown harness rejected).
 *
 * Expected values come from the spec (AC-RID-15, D2, D10), not from code.
 *
 * @spec_ref AC-RID-15
 */
import { describe, it, expect } from "vitest";
import {
  HARNESS_ADAPTERS,
  HARNESS_RUN_FLAG,
  deriveRunId,
  rewriteBashCommand,
  type RunId,
} from "@lore/core";

const R = "cc:sess-R" as RunId;
const R2 = "cc:sess-R2" as RunId;

describe("run-identity exports exist", () => {
  it("exports the rewrite functions and the flag constant", () => {
    expect(typeof rewriteBashCommand).toBe("function");
    expect(HARNESS_RUN_FLAG).toBe("--harness-run");
  });
});

describe("rewriteBashCommand: insertion at command positions", () => {
  it("inserts the flag directly after the lore word", () => {
    expect(rewriteBashCommand("lore claim t --by x", R)).toBe("lore --harness-run cc:sess-R claim t --by x");
  });

  it("uses the run id it was given (different runs, different output)", () => {
    expect(rewriteBashCommand("lore claim t", R2)).toBe("lore --harness-run cc:sess-R2 claim t");
  });

  it("handles a bare `lore` command", () => {
    expect(rewriteBashCommand("lore", R)).toBe("lore --harness-run cc:sess-R");
  });

  it("rewrites after && and leaves the rest alone", () => {
    expect(rewriteBashCommand("cd a && lore evidence t | tail -1", R)).toBe(
      "cd a && lore --harness-run cc:sess-R evidence t | tail -1",
    );
  });

  it("rewrites after ||", () => {
    expect(rewriteBashCommand("false || lore get d", R)).toBe("false || lore --harness-run cc:sess-R get d");
  });

  it("rewrites after ;", () => {
    expect(rewriteBashCommand("cd a; lore get d", R)).toBe("cd a; lore --harness-run cc:sess-R get d");
  });

  it("rewrites after a pipe", () => {
    expect(rewriteBashCommand("echo x | lore set d", R)).toBe("echo x | lore --harness-run cc:sess-R set d");
  });

  it("rewrites after a VAR=value prefix", () => {
    expect(rewriteBashCommand("FOO=1 lore set d", R)).toBe("FOO=1 lore --harness-run cc:sess-R set d");
  });

  it("rewrites after several VAR=value prefixes", () => {
    expect(rewriteBashCommand("A=1 B=two lore set d", R)).toBe("A=1 B=two lore --harness-run cc:sess-R set d");
  });

  it("rewrites every lore word in a chain, each exactly once", () => {
    const out = rewriteBashCommand("lore get a && lore get b; lore get c", R);
    expect(out).toBe(
      "lore --harness-run cc:sess-R get a && lore --harness-run cc:sess-R get b; lore --harness-run cc:sess-R get c",
    );
  });
});

describe("rewriteBashCommand: text that must stay byte-identical", () => {
  it.each([
    ['echo "lore claim t"'],
    ["echo 'lore claim t'"],
    ["echo lore"],
    ["echo lore claim t"],
    ["ls"],
    ["explore claim t"],
    ["git commit -m 'run lore claim'"],
    ["cat <<EOF\nlore claim t\nEOF"],
    ["cat <<'EOF'\nlore claim t\nEOF"],
  ])("returns %j unchanged", (cmd) => {
    expect(rewriteBashCommand(cmd, R)).toBe(cmd);
  });

  it("rewrites the lore command but not a heredoc body that mentions lore", () => {
    const cmd = "lore set d <<EOF\nlore claim t\nEOF";
    expect(rewriteBashCommand(cmd, R)).toBe("lore --harness-run cc:sess-R set d <<EOF\nlore claim t\nEOF");
  });

  it("rewrites the lore command but not a quoted argument that mentions lore", () => {
    expect(rewriteBashCommand('lore set d --body "lore claim t"', R)).toBe(
      'lore --harness-run cc:sess-R set d --body "lore claim t"',
    );
  });

  it("does not rewrite a quoted lore after && while rewriting the real one", () => {
    expect(rewriteBashCommand('echo "lore x" && lore get d', R)).toBe(
      'echo "lore x" && lore --harness-run cc:sess-R get d',
    );
  });
});

describe("rewriteBashCommand: caller-written flag and idempotence", () => {
  it("removes a caller-written run id and inserts the given one once", () => {
    const out = rewriteBashCommand("lore --harness-run X claim t", R);
    expect(out).toBe("lore --harness-run cc:sess-R claim t");
  });

  it("removes a caller-written run id placed after the subcommand", () => {
    const out = rewriteBashCommand("lore claim t --harness-run X", R);
    expect(out.match(/--harness-run/g)).toHaveLength(1);
    expect(out).not.toContain(" X");
    expect(out).toContain("lore --harness-run cc:sess-R claim t");
  });

  it("is idempotent for a simple command", () => {
    const once = rewriteBashCommand("lore claim t --by x", R);
    expect(rewriteBashCommand(once, R)).toBe(once);
  });

  it("is idempotent for a compound command with a VAR prefix and a pipe", () => {
    const once = rewriteBashCommand("cd a && FOO=1 lore evidence t | tail -1; lore get d", R);
    expect(rewriteBashCommand(once, R)).toBe(once);
  });

  it("is idempotent for text it leaves untouched", () => {
    const cmd = 'echo "lore claim t"';
    expect(rewriteBashCommand(rewriteBashCommand(cmd, R), R)).toBe(cmd);
  });

  it("replaces the run when re-rewritten with a different run", () => {
    const first = rewriteBashCommand("lore claim t", R);
    expect(rewriteBashCommand(first, R2)).toBe(rewriteBashCommand("lore claim t", R2));
  });
});

describe("run id derivation (D2)", () => {
  const adapter = () => HARNESS_ADAPTERS["claude-code"];

  it("registry has a claude-code adapter", () => {
    expect(adapter()).toBeDefined();
    expect(adapter().harness).toBe("claude-code");
  });

  it("main run is cc:<session>", () => {
    expect(adapter().derive({ sessionId: "S" })).toBe("cc:S");
    expect(adapter().derive({ sessionId: "S2" })).toBe("cc:S2");
  });

  it("subagent run is cc:<session>:<agent>", () => {
    expect(adapter().derive({ sessionId: "S", agentId: "A" })).toBe("cc:S:A");
  });

  it("two agents of one session get two different runs", () => {
    const a = adapter().derive({ sessionId: "S", agentId: "A1" });
    const b = adapter().derive({ sessionId: "S", agentId: "A2" });
    expect(a).not.toBe(b);
  });

  it("a subagent run differs from its session's main run", () => {
    expect(adapter().derive({ sessionId: "S", agentId: "A" })).not.toBe(adapter().derive({ sessionId: "S" }));
  });

  // ASSUMED SIGNATURE: the spec lists deriveRunId as public but does not state
  // its parameters. Assumed (harness, ids) delegating to the registry.
  it("deriveRunId('claude-code', ids) agrees with the adapter", () => {
    expect(deriveRunId("claude-code", { sessionId: "S" })).toBe("cc:S");
    expect(deriveRunId("claude-code", { sessionId: "S", agentId: "A" })).toBe("cc:S:A");
  });

  it("deriveRunId rejects an unknown harness instead of guessing", () => {
    expect(() => deriveRunId("no-such-harness", { sessionId: "S" })).toThrow(/no-such-harness/);
  });
});
