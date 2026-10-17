// @spawns assets/hooks/session-start-resume.mjs
/**
 * session-bootstrap-injection.test.ts —
 * spec-context-provenance-injected-corpus-global-state-and-a D2, AC-CP-10.
 *
 * Behavioral test for the SessionStart hook's Phase E bootstrap-injection
 * relay (`assets/hooks/session-start-resume.mjs`), dedicated to the
 * behaviors this task's change is most likely to silently regress: the
 * fail-open contract of BOTH independent spawns (missing binary / non-zero
 * exit / empty stdout, for the framing-line spawn AND the JSON-payload spawn
 * separately), the `INJECTION_BACKSTOP_CAP` overflow-drop contract, and the
 * outside-fence/inside-fence composition itself. Every case spawns the REAL
 * checked-in hook file as a `node` subprocess against throwaway mkdtemp
 * directories + a PATH-stubbed `lore` binary — never the repo's own working
 * tree or its live `.lore/` corpus (CLAUDE.md's "never write to the repo's
 * own .lore/ from tests" rule; mirrors `session-seat-injection.test.ts` /
 * `session-start-freshness.test.ts`'s established fixture pattern).
 *
 * Every fixture cwd is a plain directory with only a `.lore` marker
 * subdirectory (no `.git`) — Phase D's git probes fail closed on a
 * non-git cwd (pre-existing, unaffected by this task), so `bootstrapArgs`
 * stays the byte-unchanged `['bootstrap', '--injection']` (no
 * `--seat-branch`), isolating every assertion below to Phase E alone.
 *
 * Design corrected mid-task (spec v46): an earlier draft of this file (and
 * of `commands/bootstrap.ts`) had `--injection` print the framing line as
 * its own stdout line ahead of the JSON, requiring this hook to split one
 * mixed stream. That broke SPEC-080 AC-080-3's bare-JSON `--injection`
 * contract and was reverted — the framing line is instead served by a
 * SEPARATE verb, `lore governance bootstrap-framing`, spawned independently
 * exactly as Phase C/D already spawn their own governance topics. This file
 * tests the two-spawn, two-verbatim-relay design.
 *
 * Coverage:
 *   HAPPY:      both spawns succeed — the governance topic's framing line
 *               renders OUTSIDE a `\`\`\`json` fence, the bootstrap JSON
 *               renders INSIDE it, in that order; neither retired string
 *               appears in the rendered output
 *   NEGATIVE:   a literal, case-sensitive search of the checked-in hook
 *               source for both retired strings returns zero hits
 *   BOUNDARY:   JSON stdout exceeding `INJECTION_BACKSTOP_CAP` (12000 chars)
 *               drops the ENTIRE composed block — including a
 *               successfully-fetched framing line — never sliced; a
 *               degradation entry names the observed length
 *   ERROR:      the `lore` binary is genuinely unresolvable on PATH (a
 *               curated PATH containing no directory that provides a `lore`
 *               executable, not merely a stub answering with empty output)
 *               → fail-open: exit 0, no crash, no fenced block, a
 *               degradation entry naming "lore binary not on PATH"
 *   STATE:      (a) the bootstrap spawn answers with a non-zero exit even
 *               though it printed content, AND the governance-framing spawn
 *               independently succeeds — fail-open discards the WHOLE
 *               block, including the already-fetched framing line, never a
 *               half-rendered "boundary line with no data below it"; (b)
 *               the governance-framing spawn fails/empties while the
 *               bootstrap spawn succeeds — the JSON fence still renders
 *               ALONE (no leading framing line), and — matching Phase C/D's
 *               own contract for their topics — NO degradation entry is
 *               added for the missing framing line by itself
 *
 * @spec_ref spec-context-provenance-injected-corpus-global-state-and-a#AC-CP-10
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { BOOTSTRAP_FRAMING_LINE } from "@lore/core";

// packages/lore/tests/unit/hooks/session-bootstrap-injection.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "session-start-resume.mjs");

if (!existsSync(HOOK_PATH)) {
  throw new Error(`test fixture bug: resolved HOOK_PATH does not exist: ${HOOK_PATH}`);
}

const HOOK_SOURCE = readFileSync(HOOK_PATH, "utf8");

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function mkScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

interface LoreStubOptions {
  /**
   * stdout to print for the `bootstrap` subcommand (any argv). Omitted
   * entirely reproduces the "binary ran, exited 0, printed nothing" shape.
   */
  bootstrapStdout?: string;
  /** Exit code for the `bootstrap` subcommand (default 0). */
  bootstrapExitCode?: number;
  /**
   * stdout to print for `governance bootstrap-framing`. Omitted entirely
   * reproduces the same "ran, exited 0, printed nothing" fail-open shape
   * Phase C/D already tolerate for their own governance topics.
   */
  framingStdout?: string;
  /** Exit code for `governance bootstrap-framing` (default 0). */
  framingExitCode?: number;
}

/**
 * Writes an executable `lore` stub on its own dir, returning that dir for
 * PATH prepending. Answers `bootstrap` (any args) with `opts.bootstrapStdout`
 * at `opts.bootstrapExitCode`, and `governance bootstrap-framing` with
 * `opts.framingStdout` at `opts.framingExitCode` — the two spawns Phase E
 * now makes independently. Any other subcommand (e.g. Phase F's detached
 * `setup --check` refresh, or Phase C's bare `governance`) is answered with
 * a harmless empty `exit 0` — this suite does not exercise those phases,
 * only isolates them. Content is written to companion files and `cat`-ed
 * rather than embedded inline in the script, so arbitrarily large fixtures
 * (the BOUNDARY case) need no shell escaping.
 */
function makeLoreStub(opts: LoreStubOptions = {}): string {
  const { bootstrapStdout, bootstrapExitCode = 0, framingStdout, framingExitCode = 0 } = opts;
  const stubDir = mkScratchDir("bootstrap-injection-lore-stub-");
  const stubPath = join(stubDir, "lore");

  let bootstrapEmitLine = "";
  if (bootstrapStdout !== undefined) {
    const contentFile = join(stubDir, "bootstrap-stdout.txt");
    writeFileSync(contentFile, bootstrapStdout);
    bootstrapEmitLine = `cat "${contentFile}"`;
  }

  let framingEmitLine = "";
  if (framingStdout !== undefined) {
    const framingFile = join(stubDir, "framing-stdout.txt");
    writeFileSync(framingFile, framingStdout);
    framingEmitLine = `cat "${framingFile}"`;
  }

  writeFileSync(
    stubPath,
    `#!/bin/bash
if [ "$1" = "bootstrap" ]; then
  ${bootstrapEmitLine}
  exit ${bootstrapExitCode}
fi
if [ "$1" = "governance" ] && [ "$2" = "bootstrap-framing" ]; then
  ${framingEmitLine}
  exit ${framingExitCode}
fi
exit 0
`,
  );
  chmodSync(stubPath, 0o755);
  return stubDir;
}

/**
 * A curated, portable PATH that resolves `node` (via the CURRENTLY RUNNING
 * node's own bin dir — never hardcoded) plus the standard Unix system dirs
 * (git/bash/cat all live there) but deliberately excludes every
 * user-profile-managed bin dir (`~/.local/bin`, nvm/homebrew/cargo/etc.) —
 * exactly where a real `lore` CLI gets installed. Used ONLY by the ERROR
 * "binary genuinely missing" case below; every other case prepends a stub
 * dir to the REAL inherited PATH instead (matching this file's sibling
 * suites), which works because the stub shadows any real `lore` earlier in
 * PATH resolution order.
 */
const MINIMAL_SAFE_PATH = [dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");

interface RunOpts {
  cwd: string;
  extraEnv?: Record<string, string>;
}

function runHook({ cwd, extraEnv = {} }: RunOpts) {
  const stateBase = mkScratchDir("bootstrap-injection-state-");
  const claudeDir = mkScratchDir("bootstrap-injection-claude-dir-");
  return spawnSync("node", [HOOK_PATH], {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      CLAUDE_SESSION_ID: `bootstrap-injection-test-${Math.random().toString(36).slice(2)}`,
      CLAUDE_STATE_BASE_OVERRIDE: stateBase,
      CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      ...extraEnv,
    },
  });
}

function parseAdditionalContext(stdout: string): string {
  const parsed = JSON.parse(stdout);
  return parsed?.hookSpecificOutput?.additionalContext ?? "";
}

/** Plain (non-git) cwd with a `.lore` marker — the shared shape every Phase E test needs. */
function mkLoreCwd(): string {
  const cwd = mkScratchDir("bootstrap-injection-cwd-");
  mkdirSync(join(cwd, ".lore"));
  return cwd;
}

// ─── NEGATIVE — the two retired strings are gone from the hook's own source ───

describe("session-bootstrap-injection — NEGATIVE", () => {
  it("a literal, case-sensitive search of the hook source for both retired strings returns zero hits", () => {
    expect(HOOK_SOURCE).not.toContain("## Lore Bootstrap (hook-injected)");
    expect(HOOK_SOURCE).not.toContain("Corpus pointer set");
  });
});

// ─── HAPPY — framing line outside the fence, JSON inside it ───────────────────

describe("session-bootstrap-injection — HAPPY", () => {
  it("the governance framing line renders OUTSIDE a ```json fence, the bootstrap JSON renders INSIDE it, neither retired string present", () => {
    const cwd = mkLoreCwd();
    const jsonPayload = '{"scope_declaration":"x","my_claims":[]}';
    const stubDir = makeLoreStub({
      bootstrapStdout: jsonPayload,
      framingStdout: BOOTSTRAP_FRAMING_LINE,
    });

    const result = runHook({ cwd, extraEnv: { PATH: `${stubDir}:${process.env.PATH}` } });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);

    const fenceIdx = ctx.indexOf("```json");
    const framingIdx = ctx.indexOf(BOOTSTRAP_FRAMING_LINE);
    const jsonIdx = ctx.indexOf(jsonPayload);

    expect(fenceIdx).toBeGreaterThanOrEqual(0);
    expect(framingIdx).toBeGreaterThanOrEqual(0);
    expect(jsonIdx).toBeGreaterThan(fenceIdx);
    // The framing line sits BEFORE the fence opens — outside it, not inside.
    expect(framingIdx).toBeLessThan(fenceIdx);

    // The two retired strings never appear anywhere in the rendered output,
    // not just the hook's own source (NEGATIVE, above, covers the source).
    expect(ctx).not.toContain("## Lore Bootstrap (hook-injected)");
    expect(ctx).not.toContain("Corpus pointer set");
  });

  it("bare `--injection` stdout stays PURE compact JSON — this hook never mixes prose into that stream (SPEC-080 AC-080-3)", () => {
    // This is a compositional invariant of the HOOK's own two-spawn design,
    // not a claim about the CLI itself (that's bootstrap-injection-compiled.bun.test.ts's
    // job) — proven here by a stub whose "bootstrap" branch answers with
    // bare JSON and nothing else, matching the real command's contract.
    const cwd = mkLoreCwd();
    const jsonPayload = '{"a":1}';
    const stubDir = makeLoreStub({ bootstrapStdout: jsonPayload, framingStdout: BOOTSTRAP_FRAMING_LINE });

    const result = runHook({ cwd, extraEnv: { PATH: `${stubDir}:${process.env.PATH}` } });
    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);

    // The fenced JSON content is EXACTLY the payload — no framing text leaked inside the fence.
    const fenceStart = ctx.indexOf("```json\n") + "```json\n".length;
    const fenceEnd = ctx.indexOf("\n```", fenceStart);
    expect(ctx.slice(fenceStart, fenceEnd)).toBe(jsonPayload);
  });
});

// ─── BOUNDARY — INJECTION_BACKSTOP_CAP overflow drops the whole composed block ─

describe("session-bootstrap-injection — BOUNDARY", () => {
  it("JSON stdout exceeding the 10000-char hook cap drops the ENTIRE block (framing line included), never sliced, with a degradation entry naming the length", () => {
    const cwd = mkLoreCwd();
    const oversized = "x".repeat(12005);
    const stubDir = makeLoreStub({ bootstrapStdout: oversized, framingStdout: BOOTSTRAP_FRAMING_LINE });

    const result = runHook({ cwd, extraEnv: { PATH: `${stubDir}:${process.env.PATH}` } });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);

    // Never sliced: not even a fragment of the oversized payload appears.
    expect(ctx).not.toContain(oversized);
    expect(ctx).not.toContain("x".repeat(50));
    // No fenced block at all — the whole thing is dropped, not truncated.
    expect(ctx).not.toContain("```");
    // The already-fetched framing line is discarded too — a boundary line
    // describing data that isn't shown would be misleading on its own.
    expect(ctx).not.toContain(BOOTSTRAP_FRAMING_LINE);

    expect(ctx).toContain("Degradation Report");
    expect(ctx).toContain("lore bootstrap");
    expect(ctx).toContain("chars dropped whole: session-start output");
  });
});

// ─── ERROR — the binary is genuinely unresolvable on PATH ─────────────────────

describe("session-bootstrap-injection — ERROR", () => {
  it("a genuinely missing lore binary is fail-open: exit 0, no crash, no fenced block, a degradation entry naming the missing binary", () => {
    const cwd = mkLoreCwd();

    const result = runHook({ cwd, extraEnv: { PATH: MINIMAL_SAFE_PATH } });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);
    expect(ctx).not.toContain("```");
    expect(ctx).toContain("Degradation Report");
    expect(ctx).toContain("lore binary not on PATH");
  });
});

// ─── STATE — the two spawns fail independently of each other ──────────────────

describe("session-bootstrap-injection — STATE", () => {
  it("(a) bootstrap exits non-zero while governance-framing succeeds — the WHOLE block is discarded, including the already-fetched framing line", () => {
    const cwd = mkLoreCwd();
    const stubDir = makeLoreStub({
      bootstrapStdout: '{"ok":true}',
      bootstrapExitCode: 1,
      framingStdout: BOOTSTRAP_FRAMING_LINE,
    });

    const result = runHook({ cwd, extraEnv: { PATH: `${stubDir}:${process.env.PATH}` } });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);
    expect(ctx).not.toContain("```");
    expect(ctx).not.toContain(BOOTSTRAP_FRAMING_LINE);
    expect(ctx).toContain("Degradation Report");
    expect(ctx).toContain("lore bootstrap failed (exit 1)");
  });

  it("(b) governance-framing fails/empties while bootstrap succeeds — the JSON fence renders ALONE, with NO degradation entry for the missing framing line (matches Phase C/D's own contract)", () => {
    const cwd = mkLoreCwd();
    const jsonPayload = '{"ok":true}';
    // framingStdout omitted entirely -> the stub's governance branch exits 0
    // printing nothing, the same "ran but returned nothing useful" shape
    // Phase C/D already tolerate for their own topics.
    const stubDir = makeLoreStub({ bootstrapStdout: jsonPayload });

    const result = runHook({ cwd, extraEnv: { PATH: `${stubDir}:${process.env.PATH}` } });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);
    expect(ctx).toContain(`\`\`\`json\n${jsonPayload}\n\`\`\``);
    expect(ctx).not.toContain(BOOTSTRAP_FRAMING_LINE);
    // The missing framing line is advisory, not critical — no degradation
    // entry names it (Phase C's own workflowBlock failure is silent the
    // same way).
    expect(ctx).not.toContain("Degradation Report");
  });
});
