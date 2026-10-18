/**
 * @spec_ref AC-RID-6
 * Spec: spec-run-identity-slice-1-harness-attested-runs-attested D1, D8, D11.
 *
 * resolveInvocationIdentity(argv, env, detectWorktree?) — contract assumed by these tests
 * (spec §Public interface gives only the name + params; the return shape is a
 * spec gap): returns `{ identity: InvocationIdentity, argv: string[] }` where
 * `argv` is the input with `--harness-run <id>` removed.
 *
 * Name precedence (D11, BR-1055): --by > session > working copy > OS user; $LORE_ACTOR is never read.
 * `claimed` is ALWAYS a non-empty string; harnessRun comes ONLY from --harness-run.
 *
 * Every test injects argv/env explicitly; the real process env is never read.
 * Each test gets a fresh module instance via vi.resetModules() to stay order-independent.
 */
import { userInfo } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Resolve = (
  argv: string[],
  env: Record<string, string | undefined>,
  detectWorktree?: (cwd: string) => string | undefined,
) => { identity: { harnessRun: string | null; claimed: string; claimedSource: string }; argv: string[] };

async function load(): Promise<Resolve> {
  vi.resetModules();
  const mod = (await import("@lore/core/node")) as unknown as {
    resolveInvocationIdentity: (
      argv: string[],
      env: Record<string, string | undefined>,
      osUsername: () => string,
      detectWorktree?: () => string | undefined,
    ) => ReturnType<Resolve>;
  };
  // the OS username and the invocation cwd are now parameters; the tests keep the old (argv, env, detect?(cwd)) shape
  return (argv, env, detectWorktree) =>
    mod.resolveInvocationIdentity(
      argv,
      env,
      () => userInfo().username,
      detectWorktree === undefined ? undefined : () => detectWorktree(process.cwd()),
    );
}

describe("resolveInvocationIdentity", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("--harness-run strip (D1)", () => {
    it("returns argv without --harness-run and its value, and keeps the other tokens in order", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--harness-run", "cc:S1", "--by", "x"], {});
      expect(out.argv).toEqual(["claim", "t", "--by", "x"]);
    });

    it("reports the stripped run id as harnessRun (different ids give different results)", async () => {
      const resolve = await load();
      const a = resolve(["get", "d", "--harness-run", "cc:AAA"], {});
      const b = resolve(["get", "d", "--harness-run", "cc:BBB"], {});
      expect([a.identity.harnessRun, b.identity.harnessRun]).toEqual(["cc:AAA", "cc:BBB"]);
    });

    it("strips the flag when it is the last pair and leaves argv untouched when absent", async () => {
      const resolve = await load();
      const withFlag = resolve(["status", "--harness-run", "cc:Z"], {});
      const without = resolve(["status", "--json"], {});
      expect([withFlag.argv, without.argv]).toEqual([["status"], ["status", "--json"]]);
    });

    it("does not mutate the caller's argv array", async () => {
      const resolve = await load();
      const input = ["claim", "t", "--harness-run", "cc:S1"];
      resolve(input, {});
      expect(input).toEqual(["claim", "t", "--harness-run", "cc:S1"]);
    });

    it("harnessRun is null when no --harness-run flag is present", async () => {
      const resolve = await load();
      const out = resolve(["get", "d", "--by", "x"], {});
      expect(out.identity.harnessRun).toBeNull();
    });
  });

  describe("name sources (D11)", () => {
    it("--by X gives claimed X with source flag", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--by", "x"], {});
      expect([out.identity.claimed, out.identity.claimedSource]).toEqual(["x", "flag"]);
    });

    it("--by with a different value gives that value (not a hardcoded name)", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--by", "agent:other"], {});
      expect(out.identity.claimed).toBe("agent:other");
    });

    it("LORE_ACTOR=Y is ignored: claimed is not Y and the source is never env", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t"], { LORE_ACTOR: "agent:y" });
      expect(out.identity.claimed).not.toBe("agent:y");
      expect(out.identity.claimedSource).not.toBe("env");
      expect(["worktree", "os"]).toContain(out.identity.claimedSource);
    });

    it("--by and LORE_ACTOR both set: the flag value wins", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--by", "flagname"], { LORE_ACTOR: "envname" });
      expect([out.identity.claimed, out.identity.claimedSource]).toEqual(["flagname", "flag"]);
    });

    it("CLAUDE_CODE_SESSION_ID alone gives source session and a non-empty claimed name", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t"], { CLAUDE_CODE_SESSION_ID: "3de02220-aaaa-bbbb-cccc-111111111111" });
      expect(out.identity.claimedSource).toBe("session");
      expect(out.identity.claimed.length).toBeGreaterThan(0);
    });

    it("session claimed name differs for different session ids", async () => {
      const resolve = await load();
      const a = resolve(["x"], { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-1111-2222-3333-444444444444" });
      const b = resolve(["x"], { CLAUDE_CODE_SESSION_ID: "bbbbbbbb-1111-2222-3333-444444444444" });
      expect(a.identity.claimed).not.toBe(b.identity.claimed);
    });

    it("the session tier wins when LORE_ACTOR is also set", async () => {
      const resolve = await load();
      const out = resolve(["x"], { LORE_ACTOR: "agent:y", CLAUDE_CODE_SESSION_ID: "3de02220-aaaa" });
      expect([out.identity.claimed, out.identity.claimedSource]).toEqual(["agent:session-3de02220", "session"]);
    });

    it("with nothing supplied, claimed is a non-empty string (never null) from the working-copy or OS tier", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t"], {});
      expect(typeof out.identity.claimed).toBe("string");
      expect(out.identity.claimed.length).toBeGreaterThan(0);
      expect(["worktree", "os"]).toContain(out.identity.claimedSource);
    });

    it("with nothing supplied harnessRun is null", async () => {
      const resolve = await load();
      const out = resolve([], {});
      expect(out.identity.harnessRun).toBeNull();
    });

    it("an empty --by value is rejected loudly instead of silently falling through", async () => {
      const resolve = await load();
      expect(typeof resolve).toBe("function"); // a missing export must not satisfy toThrow via TypeError
      expect(() => resolve(["claim", "t", "--by", ""], { LORE_ACTOR: "agent:y" })).toThrow(/--by/);
    });
  });

  describe("names are never attestation (BR-1033)", () => {
    it("harnessRun stays null when only --by is given", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--by", "cc:S1"], {});
      expect(out.identity.harnessRun).toBeNull();
    });

    it("harnessRun stays null when only LORE_ACTOR is given, even if it looks like a run id", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t"], { LORE_ACTOR: "cc:S1" });
      expect(out.identity.harnessRun).toBeNull();
    });

    it("harnessRun is the flag value, independent of a different --by and LORE_ACTOR", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--by", "other", "--harness-run", "cc:S9"], { LORE_ACTOR: "env" });
      expect([out.identity.harnessRun, out.identity.claimed]).toEqual(["cc:S9", "other"]);
    });
  });

  describe("resolution is silent (BR-1055)", () => {
    function expectNoStderr(run: () => void): void {
      const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        run();
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    }

    it("an ignored environment variable across three resolutions writes nothing to stderr", async () => {
      const resolve = await load();
      expectNoStderr(() => {
        resolve(["a"], { LORE_ACTOR: "agent:y" });
        resolve(["b"], { LORE_ACTOR: "agent:y" });
        resolve(["c"], { LORE_ACTOR: "agent:y" });
      });
    });

    it("an explicit --by writes nothing to stderr", async () => {
      const resolve = await load();
      expectNoStderr(() => {
        resolve(["a", "--by", "x"], {});
      });
    });

    it("the session tier and the fallback tiers write nothing to stderr", async () => {
      const resolve = await load();
      expectNoStderr(() => {
        resolve(["a"], { CLAUDE_CODE_SESSION_ID: "3de02220-aaaa" });
        resolve(["a"], {});
      });
    });
  });
});
