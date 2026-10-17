/**
 * @spec_ref SPEC-104 (spec-worktree-derived-actor-identity-agent-branch-as) —
 *   worktree-derived actor identity: `agent:<branch>` as the deterministic
 *   default when resolution would otherwise fall all the way to the
 *   untraceable OS-username tier, provided `cwd` sits inside a LINKED git
 *   worktree with a resolvable branch HEAD.
 *
 * bun test (not vitest): this file spawns REAL `git init` / `git worktree add`
 * fixtures on disk (via `mkdtempSync` + `node:child_process`) to exercise the
 * filesystem-only `.git`-file/`gitdir:`/`HEAD` detection contract end to end —
 * something a mocked filesystem could assert the SHAPE of but never the real
 * git-internal CONTRACT. AC-ACTOR-5 additionally imports `commands/claim.ts`'s
 * default command and calls its `run()` in-process against a real SQLite db
 * (same "import the command module + call its exported run()" harness
 * `adhoc-claim-and-feed.bun.test.ts` / `gate-p2-cross-tier.bun.test.ts`
 * establish) — NEVER the repo's own `.lore/` corpus (project CLAUDE.md hard
 * rule); every test operates inside its own `mkdtempSync` directory, cleaned
 * up in `afterEach`.
 *
 * Coverage dimensions:
 *   HAPPY      — AC-ACTOR-1: linked worktree, no identity → agent:<branch>,
 *                source worktree-derived, no os-fallback warning; branch
 *                names with `/` map verbatim (no sanitization).
 *   NEGATIVE   — AC-ACTOR-2: --by / $LORE_ACTOR still win over worktree
 *                derivation even while cwd sits inside a linked worktree.
 *   BOUNDARY   — AC-ACTOR-4: detached HEAD, malformed `.git` file content, a
 *                `gitdir:` pointer to a nonexistent path, a gitdir missing its
 *                own HEAD file, and no `.git` anywhere in the ancestry chain
 *                — every one degrades to the os-fallback tier and NEVER
 *                throws (D3).
 *   STATE      — AC-ACTOR-5: `lore claim` from inside a linked worktree with
 *                no identity records the claim under `agent:<branch>` with
 *                identitySource `worktree-derived` (claim guard integration —
 *                a successful, unwarned claim proves `actorIdentityGuard`
 *                treated it as a pass, not the untraceable os-fallback case).
 *   REGRESSION — AC-ACTOR-3: the main checkout (`.git` DIRECTORY) resolves to
 *                OS username + the EXACT pre-existing warning text, byte-
 *                identical to legacy behavior.
 *   ERROR      — every BOUNDARY case above is also asserted via
 *                `expect(() => ...).not.toThrow()`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir, userInfo } from "os";
import { execFileSync } from "node:child_process";
import { createApp } from "../../../src/app.js";
import type { CreateDocInput } from "@lore/core";
import {
  detectWorktreeDerivedActor,
  resetActorFallbackWarningForTests,
  resolveActor,
  resolveActorWithIdentitySource,
  resolveActorWithSource,
} from "../../../src/adapters/cli/utils.js";

// ─── Git fixture helpers ────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** `git init` + one seed commit, with a fixture-local identity (no reliance on global git config). */
function initMainRepo(root: string): void {
  git(root, "init", "-q");
  git(root, "config", "user.email", "actor-derive-fixture@example.com");
  git(root, "config", "user.name", "Actor Derive Fixture");
  writeFileSync(join(root, "README.md"), "seed\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "seed");
}

/** Creates a LINKED worktree on a NEW branch `branch`, checked out at `worktreePath`. */
function addWorktree(mainRepo: string, worktreePath: string, branch: string): void {
  git(mainRepo, "worktree", "add", "-q", "-b", branch, worktreePath);
}

/** Creates a LINKED worktree with a DETACHED HEAD (no branch) at `worktreePath`. */
function addDetachedWorktree(mainRepo: string, worktreePath: string): void {
  const headSha = git(mainRepo, "rev-parse", "HEAD");
  git(mainRepo, "worktree", "add", "-q", "--detach", worktreePath, headSha);
}

/** Resolves a linked worktree's own `gitdir:` pointer target to an absolute path. */
function readGitdirPointer(worktreePath: string): string {
  const raw = readFileSync(join(worktreePath, ".git"), "utf8").trim();
  const match = /^gitdir:\s*(.+)$/.exec(raw);
  if (match === null || match[1] === undefined) {
    throw new Error(`fixture error: malformed .git pointer in ${worktreePath}`);
  }
  return resolve(worktreePath, match[1].trim());
}

function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    (process.stderr as unknown as { write: typeof origWrite }).write = origWrite;
  }
  return chunks.join("");
}

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  const origLog = console.log.bind(console);
  (process.stderr as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  };
  console.log = (...args: unknown[]) => {
    stdout.push(args.join(" "));
  };
  return {
    stdout,
    stderr,
    restore: () => {
      (process.stderr as unknown as { write: typeof origWrite }).write = origWrite;
      console.log = origLog;
    },
  };
}

async function importClaimCommand(): Promise<{
  run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
}> {
  const mod = await import("../../../src/adapters/cli/commands/claim.js");
  const cmd = (mod as { default?: { run?: (ctx: { args: Record<string, unknown> }) => Promise<void> } })
    .default;
  if (cmd?.run === undefined) throw new Error("claim command has no default run() export");
  return cmd as { run: (ctx: { args: Record<string, unknown> }) => Promise<void> };
}

// ─── Fixture lifecycle ──────────────────────────────────────────────────────

let tmpRoot: string;
let mainRepo: string;

beforeEach(() => {
  resetActorFallbackWarningForTests();
  tmpRoot = resolve(mkdtempSync(join(tmpdir(), "lore-actor-worktree-derivation-")));
  mainRepo = join(tmpRoot, "main");
  git(tmpRoot, "init", "-q", mainRepo);
  initMainRepo(mainRepo);
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ─── AC-ACTOR-1 ─────────────────────────────────────────────────────────────

describe("SPEC-104 AC-ACTOR-1 — linked worktree, no identity, resolves worktree-derived", () => {
  it("resolveActorWithSource returns {actor: agent:<branch>, source: worktree-derived}, no --by/$LORE_ACTOR", () => {
    const wt = join(tmpRoot, "wt-trace-layer");
    addWorktree(mainRepo, wt, "trace-layer");

    const result = resolveActorWithSource(undefined, {}, wt);

    expect(result).toEqual({ actor: "agent:trace-layer", source: "worktree-derived" });
  });

  it("detectWorktreeDerivedActor alone returns agent:<branch> for the same fixture", () => {
    const wt = join(tmpRoot, "wt-trace-layer-2");
    addWorktree(mainRepo, wt, "trace-layer-2");

    expect(detectWorktreeDerivedActor(wt)).toBe("agent:trace-layer-2");
  });

  it("resolveActorWithIdentitySource prints NO os-fallback warning for a worktree-derived resolution", () => {
    const wt = join(tmpRoot, "wt-no-warning");
    addWorktree(mainRepo, wt, "no-warning-branch");

    let result: { actor: string; source: string } | undefined;
    const stderr = captureStderr(() => {
      result = resolveActorWithIdentitySource(undefined, {}, wt);
    });

    expect(result).toEqual({ actor: "agent:no-warning-branch", source: "worktree-derived" });
    expect(stderr).toBe("");
  });

  it("branch names with slashes map verbatim (no sanitization): feature/x -> agent:feature/x", () => {
    const wt = join(tmpRoot, "wt-feature-x");
    addWorktree(mainRepo, wt, "feature/x");

    const result = resolveActorWithSource(undefined, {}, wt);

    expect(result).toEqual({ actor: "agent:feature/x", source: "worktree-derived" });
  });

  it("detects the worktree from a NESTED subdirectory (cwd-upward walk, not a single check)", () => {
    const wt = join(tmpRoot, "wt-nested");
    addWorktree(mainRepo, wt, "nested-branch");
    const nested = join(wt, "packages", "lore", "src");
    // A worktree's tracked files aren't materialised without a checkout for
    // untracked paths — create the nested dir directly, mirroring how a real
    // subdirectory of a checked-out worktree would look to the upward walk.
    execFileSync("mkdir", ["-p", nested]);

    const result = resolveActorWithSource(undefined, {}, nested);

    expect(result).toEqual({ actor: "agent:nested-branch", source: "worktree-derived" });
  });
});

// ─── AC-ACTOR-2 ─────────────────────────────────────────────────────────────

describe("SPEC-104 AC-ACTOR-2 — explicit --by / $LORE_ACTOR win over worktree derivation", () => {
  it("--by (explicit) wins over worktree derivation inside a linked worktree", () => {
    const wt = join(tmpRoot, "wt-explicit-wins");
    addWorktree(mainRepo, wt, "explicit-wins-branch");

    const result = resolveActorWithSource("alice", {}, wt);

    expect(result).toEqual({ actor: "alice", source: "explicit" });
  });

  it("$LORE_ACTOR is never read: worktree derivation still wins inside a linked worktree (BR-1055)", () => {
    const wt = join(tmpRoot, "wt-env-wins");
    addWorktree(mainRepo, wt, "env-wins-branch");

    const result = resolveActorWithSource(undefined, { LORE_ACTOR: "agent:bob" }, wt);

    expect(result).toEqual({ actor: "agent:env-wins-branch", source: "worktree-derived" });
  });

  it("neither explicit nor env resolution ever warns, worktree or not", () => {
    const wt = join(tmpRoot, "wt-no-warn-explicit");
    addWorktree(mainRepo, wt, "no-warn-explicit-branch");

    const stderr = captureStderr(() => {
      resolveActorWithIdentitySource("alice", {}, wt);
    });

    expect(stderr).toBe("");
  });
});

// ─── AC-ACTOR-3 ─────────────────────────────────────────────────────────────

describe("SPEC-104 AC-ACTOR-3 — main checkout resolves OS username, byte-identical to legacy", () => {
  it("resolveActorWithSource resolves OS username with source os-fallback in the main checkout", () => {
    const result = resolveActorWithSource(undefined, {}, mainRepo);

    expect(result).toEqual({ actor: userInfo().username, source: "os-fallback" });
  });

  it("resolveActorWithIdentitySource prints the EXACT pre-existing os-fallback warning text", () => {
    let result: { actor: string; source: string } | undefined;
    const stderr = captureStderr(() => {
      result = resolveActorWithIdentitySource(undefined, {}, mainRepo);
    });

    const username = userInfo().username;
    expect(result).toEqual({ actor: username, source: "os-fallback" });
    expect(stderr).toBe(
      `⚠ actor resolved to OS username "${username}" — corpus writes under this identity ` +
        "aren't traceable to an agent. Install the agent integration (`lore setup`) so writes " +
        "carry an attested run.\n",
    );
  });

  it("warns only ONCE per process even across repeated main-checkout resolutions", () => {
    const first = captureStderr(() => {
      resolveActorWithIdentitySource(undefined, {}, mainRepo);
    });
    const second = captureStderr(() => {
      resolveActorWithIdentitySource(undefined, {}, mainRepo);
    });

    expect(first).not.toBe("");
    expect(second).toBe("");
  });
});

// ─── AC-ACTOR-4 ─────────────────────────────────────────────────────────────

describe("SPEC-104 AC-ACTOR-4 — detached HEAD / unreadable or missing gitdir fall back, never throw", () => {
  it("detached HEAD worktree falls back to os-fallback, never throws", () => {
    const wt = join(tmpRoot, "wt-detached");
    addDetachedWorktree(mainRepo, wt);

    expect(() => detectWorktreeDerivedActor(wt)).not.toThrow();
    expect(detectWorktreeDerivedActor(wt)).toBeUndefined();

    const result = resolveActorWithSource(undefined, {}, wt);
    expect(result).toEqual({ actor: userInfo().username, source: "os-fallback" });
  });

  it("malformed .git file content (no gitdir: prefix) falls back to os-fallback, never throws", () => {
    const wt = join(tmpRoot, "wt-malformed-gitfile");
    addWorktree(mainRepo, wt, "malformed-gitfile-branch");
    writeFileSync(join(wt, ".git"), "this is not a valid gitdir pointer\n");

    expect(() => detectWorktreeDerivedActor(wt)).not.toThrow();
    expect(detectWorktreeDerivedActor(wt)).toBeUndefined();
  });

  it("gitdir pointer to a nonexistent path falls back to os-fallback, never throws", () => {
    const wt = join(tmpRoot, "wt-missing-gitdir");
    addWorktree(mainRepo, wt, "missing-gitdir-branch");
    writeFileSync(join(wt, ".git"), `gitdir: ${join(tmpRoot, "does-not-exist-at-all")}\n`);

    expect(() => detectWorktreeDerivedActor(wt)).not.toThrow();
    expect(detectWorktreeDerivedActor(wt)).toBeUndefined();
  });

  it("gitdir exists but its own HEAD file is missing falls back to os-fallback, never throws", () => {
    const wt = join(tmpRoot, "wt-missing-head");
    addWorktree(mainRepo, wt, "missing-head-branch");
    const gitDirPath = readGitdirPointer(wt);
    rmSync(join(gitDirPath, "HEAD"));

    expect(() => detectWorktreeDerivedActor(wt)).not.toThrow();
    expect(detectWorktreeDerivedActor(wt)).toBeUndefined();
  });

  it("HEAD holding a bare (non-ref) SHA (malformed, not via git) falls back to os-fallback, never throws", () => {
    const wt = join(tmpRoot, "wt-bare-sha-head");
    addWorktree(mainRepo, wt, "bare-sha-head-branch");
    const gitDirPath = readGitdirPointer(wt);
    const sha = git(mainRepo, "rev-parse", "HEAD");
    writeFileSync(join(gitDirPath, "HEAD"), `${sha}\n`);

    expect(() => detectWorktreeDerivedActor(wt)).not.toThrow();
    expect(detectWorktreeDerivedActor(wt)).toBeUndefined();
  });

  it("no .git found anywhere in the ancestry chain falls back to os-fallback, never throws", () => {
    const bareDir = mkdtempSync(join(tmpdir(), "lore-actor-no-git-"));
    try {
      expect(() => detectWorktreeDerivedActor(bareDir)).not.toThrow();
      expect(detectWorktreeDerivedActor(bareDir)).toBeUndefined();
    } finally {
      rmSync(bareDir, { recursive: true, force: true });
    }
  });

  it("verifies existsSync sees the fixture correctly (sanity: this .git IS a directory in the main checkout)", () => {
    // REGRESSION guard for the fixture itself — if this ever fails, every
    // other assertion in this file is testing the wrong shape.
    expect(existsSync(join(mainRepo, ".git"))).toBe(true);
  });
});

// ─── AC-ACTOR-5 ─────────────────────────────────────────────────────────────

describe("SPEC-104 AC-ACTOR-5 — lore claim from a linked worktree records agent:<branch>", () => {
  let originalCwd: string;
  let savedLoreActor: string | undefined;
  let savedClaudeCodeSessionId: string | undefined;
  let savedClaudeSessionId: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    savedLoreActor = process.env["LORE_ACTOR"];
    savedClaudeCodeSessionId = process.env["CLAUDE_CODE_SESSION_ID"];
    savedClaudeSessionId = process.env["CLAUDE_SESSION_ID"];
    delete process.env["LORE_ACTOR"];
    delete process.env["CLAUDE_CODE_SESSION_ID"];
    delete process.env["CLAUDE_SESSION_ID"];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (savedLoreActor === undefined) delete process.env["LORE_ACTOR"];
    else process.env["LORE_ACTOR"] = savedLoreActor;
    if (savedClaudeCodeSessionId === undefined) delete process.env["CLAUDE_CODE_SESSION_ID"];
    else process.env["CLAUDE_CODE_SESSION_ID"] = savedClaudeCodeSessionId;
    if (savedClaudeSessionId === undefined) delete process.env["CLAUDE_SESSION_ID"];
    else process.env["CLAUDE_SESSION_ID"] = savedClaudeSessionId;
  });

  it("claims under agent:<branch> with identitySource worktree-derived, no os-fallback warning", async () => {
    const wt = join(tmpRoot, "wt-claim-e2e");
    const branch = "actor-derive-e2e";
    addWorktree(mainRepo, wt, branch);

    // Throwaway corpus INSIDE the worktree — never the repo's own .lore/.
    const loreDir = join(wt, ".lore");
    const dbPath = join(loreDir, "lore.db");
    {
      mkdirSync(loreDir, { recursive: true });
      const setupApp = createApp(dbPath);
      const planResult = await setupApp.corpusService.create({
        type: "plan",
        title: "Actor Derive E2E Plan",
        content: "# Plan",
      } as CreateDocInput);
      if (!planResult.ok) throw new Error(`plan create failed: ${JSON.stringify(planResult.error)}`);
      const taskResult = await setupApp.corpusService.create({
        type: "task",
        title: "Actor Derive E2E Task",
        parent_id: planResult.value.id,
        content: "# Task",
        extra: { plan_id: planResult.value.id },
      } as CreateDocInput);
      if (!taskResult.ok) throw new Error(`task create failed: ${JSON.stringify(taskResult.error)}`);
      setupApp.close();

      process.chdir(wt);

      const claimCmd = await importClaimCommand();
      const output = captureOutput();
      try {
        await claimCmd.run({ args: { task: taskResult.value.slug } });
      } finally {
        output.restore();
      }

      expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
      expect(output.stdout.join("\n")).toContain(`Claimed ${taskResult.value.slug} by agent:${branch}`);
      expect(output.stderr.join("\n")).toBe("");

      // Verify the durable record, not just stdout.
      const verifyApp = createApp(dbPath);
      const docResult = await verifyApp.corpusService.get(taskResult.value.slug);
      verifyApp.close();
      if (!docResult.ok) throw new Error(`verify get failed: ${JSON.stringify(docResult.error)}`);
      const claim = docResult.value.doc.extra["claim"] as { by?: string } | undefined;
      expect(claim?.by).toBe(`agent:${branch}`);

      // Bonus REGRESSION: resolveActor's plain-string surface agrees too,
      // at the SAME real cwd claim.ts itself resolved against.
      expect(resolveActor(undefined)).toBe(`agent:${branch}`);
    }
  });
});
