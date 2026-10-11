/**
 * @spec_ref AC-RID-6
 * Spec: spec-run-identity-slice-1-harness-attested-runs-attested D1, D8, D11.
 *
 * resolveInvocationIdentity(argv, env, warn) — contract assumed by these tests
 * (spec §Public interface gives only the name + params; the return shape is a
 * spec gap): returns `{ identity: InvocationIdentity, argv: string[] }` where
 * `argv` is the input with `--harness-run <id>` removed.
 *
 * Name precedence (D11, BR-1055): --by > session > working copy > OS user; $LORE_ACTOR is never read.
 * `claimed` is ALWAYS a non-empty string; harnessRun comes ONLY from --harness-run.
 *
 * Every test injects argv/env/warn explicitly; the real process env is never read.
 * Each test gets a fresh module instance via vi.resetModules() to stay order-independent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Resolve = (
  argv: string[],
  env: Record<string, string | undefined>,
  warn: (line: string) => void,
) => { identity: { harnessRun: string | null; claimed: string; claimedSource: string }; argv: string[] };

async function load(): Promise<Resolve> {
  vi.resetModules();
  const mod = (await import("@lore/core/node")) as unknown as { resolveInvocationIdentity: Resolve };
  return mod.resolveInvocationIdentity;
}

describe("resolveInvocationIdentity", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("--harness-run strip (D1)", () => {
    it("returns argv without --harness-run and its value, and keeps the other tokens in order", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--harness-run", "cc:S1", "--by", "x"], {}, vi.fn());
      expect(out.argv).toEqual(["claim", "t", "--by", "x"]);
    });

    it("reports the stripped run id as harnessRun (different ids give different results)", async () => {
      const resolve = await load();
      const a = resolve(["get", "d", "--harness-run", "cc:AAA"], {}, vi.fn());
      const b = resolve(["get", "d", "--harness-run", "cc:BBB"], {}, vi.fn());
      expect([a.identity.harnessRun, b.identity.harnessRun]).toEqual(["cc:AAA", "cc:BBB"]);
    });

    it("strips the flag when it is the last pair and leaves argv untouched when absent", async () => {
      const resolve = await load();
      const withFlag = resolve(["status", "--harness-run", "cc:Z"], {}, vi.fn());
      const without = resolve(["status", "--json"], {}, vi.fn());
      expect([withFlag.argv, without.argv]).toEqual([["status"], ["status", "--json"]]);
    });

    it("does not mutate the caller's argv array", async () => {
      const resolve = await load();
      const input = ["claim", "t", "--harness-run", "cc:S1"];
      resolve(input, {}, vi.fn());
      expect(input).toEqual(["claim", "t", "--harness-run", "cc:S1"]);
    });

    it("harnessRun is null when no --harness-run flag is present", async () => {
      const resolve = await load();
      const out = resolve(["get", "d", "--by", "x"], {}, vi.fn());
      expect(out.identity.harnessRun).toBeNull();
    });
  });

  describe("name sources (D11)", () => {
    it("--by X gives claimed X with source flag", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--by", "x"], {}, vi.fn());
      expect([out.identity.claimed, out.identity.claimedSource]).toEqual(["x", "flag"]);
    });

    it("--by with a different value gives that value (not a hardcoded name)", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--by", "agent:other"], {}, vi.fn());
      expect(out.identity.claimed).toBe("agent:other");
    });

    it("LORE_ACTOR=Y is ignored: claimed is not Y and the source is never env", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t"], { LORE_ACTOR: "agent:y" }, vi.fn());
      expect(out.identity.claimed).not.toBe("agent:y");
      expect(out.identity.claimedSource).not.toBe("env");
      expect(["worktree", "os"]).toContain(out.identity.claimedSource);
    });

    it("--by and LORE_ACTOR both set: the flag value wins", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--by", "flagname"], { LORE_ACTOR: "envname" }, vi.fn());
      expect([out.identity.claimed, out.identity.claimedSource]).toEqual(["flagname", "flag"]);
    });

    it("CLAUDE_CODE_SESSION_ID alone gives source session and a non-empty claimed name", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t"], { CLAUDE_CODE_SESSION_ID: "3de02220-aaaa-bbbb-cccc-111111111111" }, vi.fn());
      expect(out.identity.claimedSource).toBe("session");
      expect(out.identity.claimed.length).toBeGreaterThan(0);
    });

    it("session claimed name differs for different session ids", async () => {
      const resolve = await load();
      const a = resolve(["x"], { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-1111-2222-3333-444444444444" }, vi.fn());
      const b = resolve(["x"], { CLAUDE_CODE_SESSION_ID: "bbbbbbbb-1111-2222-3333-444444444444" }, vi.fn());
      expect(a.identity.claimed).not.toBe(b.identity.claimed);
    });

    it("the session tier wins when LORE_ACTOR is also set", async () => {
      const resolve = await load();
      const out = resolve(["x"], { LORE_ACTOR: "agent:y", CLAUDE_CODE_SESSION_ID: "3de02220-aaaa" }, vi.fn());
      expect([out.identity.claimed, out.identity.claimedSource]).toEqual(["agent:session-3de02220", "session"]);
    });

    it("with nothing supplied, claimed is a non-empty string (never null) from the working-copy or OS tier", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t"], {}, vi.fn());
      expect(typeof out.identity.claimed).toBe("string");
      expect(out.identity.claimed.length).toBeGreaterThan(0);
      expect(["worktree", "os"]).toContain(out.identity.claimedSource);
    });

    it("with nothing supplied harnessRun is null", async () => {
      const resolve = await load();
      const out = resolve([], {}, vi.fn());
      expect(out.identity.harnessRun).toBeNull();
    });

    it("an empty --by value is rejected loudly instead of silently falling through", async () => {
      const resolve = await load();
      expect(typeof resolve).toBe("function"); // a missing export must not satisfy toThrow via TypeError
      expect(() => resolve(["claim", "t", "--by", ""], { LORE_ACTOR: "agent:y" }, vi.fn())).toThrow(/--by/);
    });
  });

  describe("names are never attestation (BR-1033)", () => {
    it("harnessRun stays null when only --by is given", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--by", "cc:S1"], {}, vi.fn());
      expect(out.identity.harnessRun).toBeNull();
    });

    it("harnessRun stays null when only LORE_ACTOR is given, even if it looks like a run id", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t"], { LORE_ACTOR: "cc:S1" }, vi.fn());
      expect(out.identity.harnessRun).toBeNull();
    });

    it("harnessRun is the flag value, independent of a different --by and LORE_ACTOR", async () => {
      const resolve = await load();
      const out = resolve(["claim", "t", "--by", "other", "--harness-run", "cc:S9"], { LORE_ACTOR: "env" }, vi.fn());
      expect([out.identity.harnessRun, out.identity.claimed]).toEqual(["cc:S9", "other"]);
    });
  });

  describe("no LORE_ACTOR warning (BR-1055)", () => {
    it("LORE_ACTOR set across three resolutions emits no warning", async () => {
      const resolve = await load();
      const warn = vi.fn();
      resolve(["a"], { LORE_ACTOR: "agent:y" }, warn);
      resolve(["b"], { LORE_ACTOR: "agent:y" }, warn);
      resolve(["c"], { LORE_ACTOR: "agent:y" }, warn);
      expect(warn).not.toHaveBeenCalled();
    });

    it("LORE_ACTOR set produces no stderr line from the default sink either", async () => {
      const resolve = await load();
      const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        (resolve as unknown as (a: string[], e: Record<string, string>) => unknown)(["a"], { LORE_ACTOR: "agent:y" });
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("does not warn when only --by is given", async () => {
      const resolve = await load();
      const warn = vi.fn();
      resolve(["a", "--by", "x"], {}, warn);
      expect(warn).not.toHaveBeenCalled();
    });

    it("does not warn for the session tier or the fallback tiers", async () => {
      const resolve = await load();
      const warn = vi.fn();
      resolve(["a"], { CLAUDE_CODE_SESSION_ID: "3de02220-aaaa" }, warn);
      resolve(["a"], {}, warn);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
