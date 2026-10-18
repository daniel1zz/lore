/**
 * AC-ROI-2 — actor resolution never reads `$LORE_ACTOR` (BR-1055). Covers both
 * resolvers: `@lore/core/node`'s `resolveActorWithSource` and the CLI adapter's
 * own wider `resolveActorWithSource` / `resolveActorWithIdentitySource`.
 * With no run the order is session, then worktree-derived name, then OS user.
 *
 * Every case passes a LITERAL env object (no `process.env` mutation) and a
 * fixture cwd built from plain files (no git subprocess), so it is parallel-safe.
 *
 * Runner: vitest.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { resolveActorWithSource as resolveCore } from "@lore/core/node";
import {
  resolveActorWithSource as resolveCli,
  resolveActorWithIdentitySource,
  resetActorFallbackWarningForTests,
} from "../../../src/adapters/cli/utils.js";

const root = mkdtempSync(join(tmpdir(), "lore-actor-ignores-lore-actor-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A main-checkout shape: `.git` is a directory, so no worktree name derives. */
function makeMainCheckout(): string {
  const dir = join(root, "main");
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

/** A linked-worktree shape: `.git` file -> gitdir whose HEAD names `branch`. */
function makeLinkedWorktree(branch: string): string {
  const dir = join(root, `wt-${branch}`);
  const gitDir = join(root, `wt-gitdir-${branch}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(dir, ".git"), `gitdir: ${gitDir}\n`);
  writeFileSync(join(gitDir, "HEAD"), `ref: refs/heads/${branch}\n`);
  return dir;
}

const LORE_ACTOR_VALUE = "agent:from-env-must-be-ignored";
const SESSION_ENV = { CLAUDE_CODE_SESSION_ID: "3de02220-5d69-4f0b-8a1e-aaaaaaaaaaaa" };

describe("AC-ROI-2 core resolver ignores LORE_ACTOR", () => {
  it("AC-ROI-2 core: LORE_ACTOR alone resolves to the OS user, source os-fallback", () => {
    const r = resolveCore(undefined, { LORE_ACTOR: LORE_ACTOR_VALUE }, () => userInfo().username);
    expect(r.actor).not.toBe(LORE_ACTOR_VALUE);
    expect(r.source).toBe("os-fallback");
    expect(r.actor).toBe(userInfo().username);
  });

  it("AC-ROI-2 core: session tier wins over LORE_ACTOR", () => {
    const r = resolveCore(undefined, { LORE_ACTOR: LORE_ACTOR_VALUE, ...SESSION_ENV }, () => userInfo().username);
    expect(r).toEqual({ actor: "agent:session-3de02220", source: "session" });
  });

  it("AC-ROI-2 core: explicit still wins and LORE_ACTOR never reports source env", () => {
    const r = resolveCore("alice", { LORE_ACTOR: LORE_ACTOR_VALUE }, () => userInfo().username);
    expect(r).toEqual({ actor: "alice", source: "explicit" });
  });
});

describe("AC-ROI-2 CLI resolver ignores LORE_ACTOR", () => {
  it("AC-ROI-2 cli: LORE_ACTOR alone in a main checkout resolves to OS user", () => {
    const r = resolveCli(undefined, { LORE_ACTOR: LORE_ACTOR_VALUE }, makeMainCheckout());
    expect(r.actor).not.toBe(LORE_ACTOR_VALUE);
    expect(r.source).toBe("os-fallback");
  });

  it("AC-ROI-2 cli: order is session, then worktree, then os", () => {
    const env = { LORE_ACTOR: LORE_ACTOR_VALUE };
    const wt = makeLinkedWorktree("feat-x");
    const main = makeMainCheckout();
    expect(resolveCli(undefined, { ...env, ...SESSION_ENV }, wt)).toEqual({
      actor: "agent:session-3de02220",
      source: "session",
    });
    expect(resolveCli(undefined, env, wt)).toEqual({
      actor: "agent:feat-x",
      source: "worktree-derived",
    });
    expect(resolveCli(undefined, env, main).source).toBe("os-fallback");
  });

  it("AC-ROI-2 cli: resolveActorWithIdentitySource never reports env", () => {
    const wt = makeLinkedWorktree("feat-y");
    const r = resolveActorWithIdentitySource(undefined, { LORE_ACTOR: LORE_ACTOR_VALUE }, wt);
    expect(r).toEqual({ actor: "agent:feat-y", source: "worktree-derived" });
  });
});

describe("AC-ROI-2 retired mechanism is not named in the OS-fallback advisory", () => {
  it("AC-ROI-2 advisory points at lore setup and never names LORE_ACTOR", () => {
    resetActorFallbackWarningForTests();
    const chunks: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string | Uint8Array) => {
      chunks.push(String(c));
      return true;
    }) as typeof process.stderr.write;
    try {
      resolveActorWithIdentitySource(undefined, { LORE_ACTOR: LORE_ACTOR_VALUE }, makeMainCheckout());
    } finally {
      process.stderr.write = original;
    }
    const text = chunks.join("");
    expect(text).toContain("lore setup");
    expect(text).not.toContain("LORE_ACTOR");
  });
});
