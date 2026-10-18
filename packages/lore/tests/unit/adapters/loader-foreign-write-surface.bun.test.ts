/**
 * @spec_ref spec-corpus-resolution-carries-provenance-and-a-foreign-write#AC-CP-5
 *   (§D5 adapter matrix — THE HTTP ROW, driven at the WIRED path)
 *
 * WHY THIS FILE EXISTS AT ALL, and why it is a `.bun.test.ts` rather than
 * assertions added to its vitest sibling
 * (`foreign-corpus-write-adapters.test.ts`):
 *
 *   AC-CP-5(c) already pins "the HTTP predicate sees `provenance: null`" — but
 *   it observes that on a BARE `new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)))`, which carries the
 *   documented constructor default `{provenance: null, enabled: true}`. A bare
 *   service is null by construction, so that assertion CANNOT go red when the
 *   COMPOSITION ROOT wires something else. It did: `loader.ts` derived the
 *   context from the SERVER's own startup `process.cwd()` for every surface
 *   booting through `loadLoreApp()`, so `lore serve` launched from inside a
 *   nested worktree gave HTTP a `git_common_dir` provenance and refused EVERY
 *   HTTP write — a lockout, because an HTTP caller has neither a per-call
 *   directory nor a claim lease through which to declare intent.
 *   (`task-the-http-exemption-is-conditional-on-where-lore-serve-was`.)
 *
 *   Closing that gap means driving `loadLoreApp()` itself. `loader.ts` imports
 *   `app.ts` → `bun:sqlite`, which vitest cannot resolve (root CLAUDE.md,
 *   "Test file convention"), so the wired-path oracle CANNOT live in the
 *   vitest sibling. It lives here; the sibling keeps the predicate-boundary
 *   spy work it can do without `bun:sqlite`, plus the production-wiring census
 *   that proves every `startHttpServer` mount actually passes the HTTP surface.
 *
 * The two halves are a MATCHED PAIR against ONE fixture (a repo with its own
 * `.lore/`, plus a nested linked worktree carrying none), and neither half is
 * sufficient alone:
 *
 *   HTTP boot  → the write is ACCEPTED (the §D5 exemption is delivered).
 *   CLI boot   → the SAME write from the SAME directory is REFUSED with the
 *                exact `FOREIGN_CORPUS_WRITE_TOKEN`.
 *
 * The CLI half is the DISCRIMINATING one: it is what goes red under the
 * degenerate "just pass null everywhere" fix, which the HTTP half alone would
 * happily certify.
 *
 * Six-dimension coverage:
 *   HAPPY:      HTTP boot from a nested worktree → corpus write accepted, doc read back
 *   NEGATIVE:   CLI boot from the SAME directory → refused, `field` === the exact token
 *   BOUNDARY:   CLI boot from a repo that OWNS its corpus → accepted (the guard
 *               is provenance-keyed, not "refuse every CLI write")
 *   ERROR:      the `foreign_corpus_write.enabled: false` knob still governs the
 *               CLI branch, so "accepted" is reachable by TWO independent routes
 *               and the HTTP branch is not silently doing the knob's job
 *   STATE:      both boots alive in ONE process from ONE cwd disagree — the
 *               context is per-App, never process-global
 *   REGRESSION: the LIFECYCLE half of the same wiring (`guardTaskLifecycleWrites`,
 *               loader.ts's second consumer of the very same context object)
 *               tracks the boot surface identically
 *
 * Fixture discipline: every corpus is a fresh `mkdtemp` directory — this repo's
 * own `.lore/` corpus is never touched (root CLAUDE.md).
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoreError, Result } from "@lore/core";
import { saveConfig } from "@lore/core/node";
import { createApp, type App } from "../../../src/app.js";
import { loadLoreApp } from "../../../src/adapters/cli/loader.js";
import { FOREIGN_CORPUS_WRITE_TOKEN } from "../../../src/service/foreign-corpus-write-guard.js";
import { liveAmbient, liveInvocation } from "../../live-invocation.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const scratchDirs: string[] = [];

/** `realpathSync` — macOS `/var` → `/private/var`, so `process.chdir` and the
 *  git-reported tree root compare equal. */
function mkScratchDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratchDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initGitRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "loader-foreign-write-surface-test@example.invalid"]);
  git(dir, ["config", "user.name", "loader-foreign-write-surface test"]);
  writeFileSync(join(dir, "README.md"), "loader foreign-write surface fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
}

/** A REAL `.lore/lore.db` (not a touched empty file) — `loadLoreApp` opens it. */
function makeCorpus(dir: string): void {
  const loreDir = join(dir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient());
  (app as App).close();
}

/**
 * A repo owning its corpus, plus a NESTED linked worktree at
 * `<repo>/.claude/worktrees/agent-x` with NO `.lore/` of its own — the harness
 * layout the whole spec is about. `resolveCorpus(worktreePath)` reaches the
 * PARENT corpus through the §M4 git-common-dir fallback, so every write from
 * there is genuinely foreign.
 */
function makeNestedWorktreeFixture(prefix: string): { repoRoot: string; worktreePath: string } {
  const repoRoot = mkScratchDir(`${prefix}-repo-`);
  initGitRepo(repoRoot);
  makeCorpus(repoRoot);

  mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
  const worktreeRelPath = join(".claude", "worktrees", "agent-x");
  git(repoRoot, ["worktree", "add", "-b", `${prefix}-agent-x`, worktreeRelPath]);

  return { repoRoot, worktreePath: join(repoRoot, worktreeRelPath) };
}

/** A plain repo with its OWN `.lore/` — provenance `"own"`, nothing foreign. */
function makeOwnCorpusFixture(prefix: string): string {
  const repoRoot = mkScratchDir(`${prefix}-own-`);
  initGitRepo(repoRoot);
  makeCorpus(repoRoot);
  return repoRoot;
}

/**
 * The refusal shape under test, extracted so every assertion below keys on the
 * EXACT imported token rather than on "some error came back" — an unrelated
 * failure (a gate denial, a missing doc) must never be readable as this guard
 * firing, and vice versa.
 */
function isForeignWriteRefusal(result: Result<unknown, LoreError>): boolean {
  // `LoreError` is a discriminated union — only some variants carry `field`,
  // so the `in` narrowing is required, not defensive noise.
  return !result.ok && "field" in result.error && result.error.field === FOREIGN_CORPUS_WRITE_TOKEN;
}

let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

// ─── HAPPY — the §D5 HTTP exemption, delivered by the composition root ─────

describe("loadLoreApp — the HTTP exemption is a property of the SURFACE, not of the launch directory", () => {
  it("HTTP boot from inside a nested worktree: the corpus write is ACCEPTED and the doc reads back", async () => {
    const { worktreePath } = makeNestedWorktreeFixture("http-exempt");
    process.chdir(worktreePath);

    const { app } = loadLoreApp({ surface: "http", inv: liveInvocation() });
    try {
      const created = await app.corpusService.create({ type: "prd", title: "HTTP write from a nested worktree" });

      expect(isForeignWriteRefusal(created)).toBe(false);
      expect(created.ok).toBe(true);

      // Positive landing proof — read the doc BACK, never just "no error".
      if (created.ok) {
        const fetched = await app.corpusService.get(created.value.id);
        expect(fetched.ok).toBe(true);
        if (fetched.ok) expect(fetched.value.doc.title).toBe("HTTP write from a nested worktree");
      }
    } finally {
      app.close();
    }
  });
});

// ─── NEGATIVE — the discriminating control ─────────────────────────────────

describe("loadLoreApp — the CLI surface still derives provenance from its own cwd", () => {
  it("CLI boot from the SAME nested worktree: the SAME write is REFUSED carrying the exact foreign-write token", async () => {
    const { worktreePath } = makeNestedWorktreeFixture("cli-control");
    process.chdir(worktreePath);

    const { app } = loadLoreApp({ inv: liveInvocation() });
    try {
      const created = await app.corpusService.create({ type: "prd", title: "CLI write from a nested worktree" });

      expect(created.ok).toBe(false);
      if (!created.ok) {
        expect("field" in created.error && created.error.field).toBe(FOREIGN_CORPUS_WRITE_TOKEN);
        expect("message" in created.error && created.error.message).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
      }

      // Positive proof nothing landed — an error object alone cannot
      // distinguish "the guard refused" from "the write half-succeeded".
      const listed = await app.corpusService.list({});
      expect(listed.ok).toBe(true);
      if (listed.ok) expect(listed.value.total).toBe(0);
    } finally {
      app.close();
    }
  });
});

// ─── BOUNDARY — the guard is provenance-keyed, not surface-keyed ───────────

describe("loadLoreApp — a CLI boot inside a repo that OWNS its corpus is untouched", () => {
  it("CLI boot with provenance 'own': the write is ACCEPTED, so the CLI branch does not refuse everything", async () => {
    const ownRoot = makeOwnCorpusFixture("cli-own");
    process.chdir(ownRoot);

    const { app } = loadLoreApp({ inv: liveInvocation() });
    try {
      const created = await app.corpusService.create({ type: "prd", title: "CLI write in its own tree" });
      expect(isForeignWriteRefusal(created)).toBe(false);
      expect(created.ok).toBe(true);
    } finally {
      app.close();
    }
  });
});

// ─── ERROR — the config knob is still the other, independent allow route ───

describe("loadLoreApp — the foreign_corpus_write knob still governs the CLI branch", () => {
  it("CLI boot from a nested worktree with foreign_corpus_write.enabled=false: ACCEPTED — 'accepted' has two independent routes, so the HTTP branch is not silently doing the knob's job", async () => {
    const { repoRoot, worktreePath } = makeNestedWorktreeFixture("knob-off");
    saveConfig(repoRoot, {
      project: { name: "knob-off", author: "tester" },
      workflow: { gates: { "corpus-write": { foreign_corpus_write: { enabled: false } } } },
    } as never);
    process.chdir(worktreePath);

    const { app } = loadLoreApp({ inv: liveInvocation() });
    try {
      const created = await app.corpusService.create({ type: "prd", title: "CLI write with the guard disabled" });
      expect(isForeignWriteRefusal(created)).toBe(false);
      expect(created.ok).toBe(true);
    } finally {
      app.close();
    }
  });
});

// ─── STATE — the context is per-App, never process-global ──────────────────

describe("loadLoreApp — two boots in ONE process from ONE directory", () => {
  it("the HTTP App accepts and the CLI App refuses the identical write, concurrently — so the surface keying is per-App state, not a process-wide switch", async () => {
    const { worktreePath } = makeNestedWorktreeFixture("state-pair");
    process.chdir(worktreePath);

    const { app: httpApp } = loadLoreApp({ surface: "http", inv: liveInvocation() });
    const { app: cliApp } = loadLoreApp({ inv: liveInvocation() });
    try {
      const viaHttp = await httpApp.corpusService.create({ type: "prd", title: "state pair — http" });
      const viaCli = await cliApp.corpusService.create({ type: "prd", title: "state pair — cli" });

      expect(viaHttp.ok).toBe(true);
      expect(isForeignWriteRefusal(viaCli)).toBe(true);
    } finally {
      httpApp.close();
      cliApp.close();
    }
  });
});

// ─── REGRESSION — the lifecycle half of the SAME context object ────────────

describe("loadLoreApp — guardTaskLifecycleWrites reads the same surface-keyed context", () => {
  it("claim WITHOUT declared intent: refused on a CLI boot, NOT refused by this guard on an HTTP boot", async () => {
    const { repoRoot, worktreePath } = makeNestedWorktreeFixture("lifecycle");

    // Seed prd → plan → task from INSIDE the owning repo (provenance "own",
    // so seeding is never itself subject to the refusal under test).
    process.chdir(repoRoot);
    const seed = loadLoreApp({ inv: liveInvocation() });
    let taskId: string;
    try {
      const prd = await seed.app.corpusService.create({ type: "prd", title: "lifecycle prd" });
      expect(prd.ok).toBe(true);
      if (!prd.ok) throw new Error("fixture seeding failed: prd");
      const plan = await seed.app.corpusService.create({
        type: "plan",
        title: "lifecycle plan",
        parent_id: prd.value.id,
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error("fixture seeding failed: plan");
      const task = await seed.app.corpusService.create({
        type: "task",
        title: "lifecycle task",
        parent_id: plan.value.id,
        extra: { plan_id: plan.value.id },
      });
      expect(task.ok).toBe(true);
      if (!task.ok) throw new Error("fixture seeding failed: task");
      taskId = task.value.id;
    } finally {
      seed.app.close();
    }

    process.chdir(worktreePath);

    const { app: cliApp } = loadLoreApp({ inv: liveInvocation() });
    try {
      const claimed = await cliApp.taskWorkflowService.claim(taskId, { by: "agent:lifecycle-probe" });
      expect(isForeignWriteRefusal(claimed)).toBe(true);
    } finally {
      cliApp.close();
    }

    const { app: httpApp } = loadLoreApp({ surface: "http", inv: liveInvocation() });
    try {
      const claimed = await httpApp.taskWorkflowService.claim(taskId, { by: "agent:lifecycle-probe" });
      // Keyed on the TOKEN, not on `ok` — an unrelated denial (a task-claim
      // gate verdict) must never be readable as this guard firing.
      expect(isForeignWriteRefusal(claimed)).toBe(false);
    } finally {
      httpApp.close();
    }
  });
});
