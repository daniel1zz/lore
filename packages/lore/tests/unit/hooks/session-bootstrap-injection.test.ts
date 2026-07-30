/**
 * session-bootstrap-injection.test.ts —
 * spec-context-provenance-injected-corpus-global-state-and-a D2, AC-CP-3.
 *
 * Behavioral test for the SessionStart hook's Phase E bootstrap-injection
 * relay (`assets/hooks/session-start-resume.mjs`), dedicated to the two
 * behaviors this task's change (moving the "## Lore Bootstrap
 * (hook-injected)" header + "Corpus pointer set …" sentence out of the hook
 * and into the binary's own `BOOTSTRAP_FRAMING_LINE` stdout line) is most
 * likely to silently regress: the fail-open contract (missing binary /
 * non-zero exit / empty stdout) and the `INJECTION_BACKSTOP_CAP`
 * overflow-drop contract. Every case spawns the REAL checked-in hook file as
 * a `node` subprocess against throwaway mkdtemp directories + a
 * PATH-stubbed `lore` binary — never the repo's own working tree or its
 * live `.lore/` corpus (CLAUDE.md's "never write to the repo's own .lore/
 * from tests" rule; mirrors `session-seat-injection.test.ts` /
 * `session-start-freshness.test.ts`'s established fixture pattern).
 *
 * Every fixture cwd is a plain directory with only a `.lore` marker
 * subdirectory (no `.git`) — Phase D's git probes fail closed on a
 * non-git cwd (pre-existing, unaffected by this task), so `bootstrapArgs`
 * stays the byte-unchanged `['bootstrap', '--injection']` (no
 * `--seat-branch`), isolating every assertion below to Phase E alone.
 *
 * Coverage:
 *   HAPPY:      the (stubbed) binary's two-line stdout (framing line, then
 *               JSON) is relayed verbatim inside a bare fenced block, with
 *               NEITHER retired string anywhere in the hook's own source
 *               nor in the rendered `additionalContext`
 *   NEGATIVE:   a literal, case-sensitive search of the checked-in hook
 *               source for both retired strings returns zero hits
 *   BOUNDARY:   stdout exceeding `INJECTION_BACKSTOP_CAP` (12000 chars) is
 *               dropped ENTIRELY — no fenced block, no partial/sliced
 *               fragment of the oversized content anywhere in the output —
 *               and a degradation entry names the observed length
 *   ERROR:      the `lore` binary is genuinely unresolvable on PATH (a
 *               curated PATH containing no directory that provides a `lore`
 *               executable, not merely a stub answering with empty output)
 *               → fail-open: exit 0, no crash, no fenced block, a
 *               degradation entry naming "lore binary not on PATH"
 *   STATE:      the binary answers `bootstrap --injection` with a non-zero
 *               exit (even though it printed content) → fail-open, content
 *               never trusted from a failed call, no fenced block
 *   REGRESSION: the pre-existing fail-open contract (non-zero exit AND
 *               empty-stdout-at-exit-0) and the backstop-overflow contract
 *               are BOTH still byte-identical in effect to before this
 *               task's change — this suite is the regression pin for both,
 *               since no prior test file covered Phase E's own degradation
 *               paths in isolation
 *
 * @spec_ref AC-CP-3
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

interface BootstrapStubOptions {
  /**
   * stdout to print for the `bootstrap` subcommand (any argv). Omitted
   * entirely reproduces the "binary ran, exited 0, printed nothing" shape.
   */
  bootstrapStdout?: string;
  /** Exit code for the `bootstrap` subcommand (default 0). */
  bootstrapExitCode?: number;
}

/**
 * Writes an executable `lore` stub on its own dir, returning that dir for
 * PATH prepending. Answers `bootstrap` (any args) with `opts.bootstrapStdout`
 * at `opts.bootstrapExitCode`; any other subcommand (e.g. Phase F's
 * detached `setup --check` refresh) is answered with a harmless empty
 * `exit 0` — this suite does not exercise Phase F, only isolates it.
 * Content is written to a companion file and `cat`-ed rather than embedded
 * inline in the script, so arbitrarily large fixtures (the BOUNDARY case)
 * need no shell escaping.
 */
function makeLoreStub(opts: BootstrapStubOptions = {}): string {
  const { bootstrapStdout, bootstrapExitCode = 0 } = opts;
  const stubDir = mkScratchDir("bootstrap-injection-lore-stub-");
  const stubPath = join(stubDir, "lore");
  let emitLine = "";
  if (bootstrapStdout !== undefined) {
    const contentFile = join(stubDir, "bootstrap-stdout.txt");
    writeFileSync(contentFile, bootstrapStdout);
    emitLine = `cat "${contentFile}"`;
  }
  writeFileSync(
    stubPath,
    `#!/bin/bash
if [ "$1" = "bootstrap" ]; then
  ${emitLine}
  exit ${bootstrapExitCode}
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

// ─── HAPPY — binary's two-line stdout is relayed verbatim, fenced ─────────────

describe("session-bootstrap-injection — HAPPY", () => {
  it("the framing line + JSON stdout is relayed verbatim inside a fence, with neither retired string in the rendered output", () => {
    const cwd = mkLoreCwd();
    const jsonPayload = '{"scope_declaration":"x","my_claims":[]}';
    const stubDir = makeLoreStub({ bootstrapStdout: `${BOOTSTRAP_FRAMING_LINE}\n${jsonPayload}` });

    const result = runHook({ cwd, extraEnv: { PATH: `${stubDir}:${process.env.PATH}` } });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);

    // Both lines the binary printed are present, verbatim, inside a fence —
    // the hook authored neither of them.
    expect(ctx).toContain("```\n");
    expect(ctx).toContain(BOOTSTRAP_FRAMING_LINE);
    expect(ctx).toContain(jsonPayload);

    // The two retired strings never appear anywhere in the rendered output,
    // not just the hook's own source (NEGATIVE, above, covers the source).
    expect(ctx).not.toContain("## Lore Bootstrap (hook-injected)");
    expect(ctx).not.toContain("Corpus pointer set");
  });
});

// ─── BOUNDARY — INJECTION_BACKSTOP_CAP overflow drops the whole block ─────────

describe("session-bootstrap-injection — BOUNDARY", () => {
  it("stdout exceeding the 12000-char backstop is dropped ENTIRELY (never sliced), with a degradation entry naming the length", () => {
    const cwd = mkLoreCwd();
    const oversized = "x".repeat(12005);
    const stubDir = makeLoreStub({ bootstrapStdout: oversized });

    const result = runHook({ cwd, extraEnv: { PATH: `${stubDir}:${process.env.PATH}` } });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);

    // Never sliced: not even a fragment of the oversized payload appears.
    expect(ctx).not.toContain(oversized);
    expect(ctx).not.toContain("x".repeat(50));
    // No fenced block at all — the whole thing is dropped, not truncated.
    expect(ctx).not.toContain("```");

    expect(ctx).toContain("Degradation Report");
    expect(ctx).toContain("lore bootstrap");
    expect(ctx).toContain("12005 chars exceeds 12000 backstop");
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

// ─── STATE — a non-zero exit is fail-open even with stdout content ────────────

describe("session-bootstrap-injection — STATE", () => {
  it("a non-zero exit from bootstrap --injection is fail-open — stdout content is never trusted from a failed call", () => {
    const cwd = mkLoreCwd();
    const stubDir = makeLoreStub({
      bootstrapStdout: `${BOOTSTRAP_FRAMING_LINE}\n{"ok":true}`,
      bootstrapExitCode: 1,
    });

    const result = runHook({ cwd, extraEnv: { PATH: `${stubDir}:${process.env.PATH}` } });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);
    expect(ctx).not.toContain("```");
    expect(ctx).not.toContain(BOOTSTRAP_FRAMING_LINE);
    expect(ctx).toContain("Degradation Report");
    expect(ctx).toContain("lore bootstrap failed (exit 1)");
  });
});

// ─── REGRESSION — fail-open (empty stdout at exit 0) is unchanged ─────────────

describe("session-bootstrap-injection — REGRESSION", () => {
  it("exit 0 with empty stdout is fail-open — same pre-existing degradation message, no fenced block", () => {
    const cwd = mkLoreCwd();
    // Omitting bootstrapStdout entirely reproduces "binary ran, exited 0,
    // printed nothing" — the pre-existing empty-stdout fail-open shape,
    // byte-unchanged by this task's D2 change.
    const stubDir = makeLoreStub({});

    const result = runHook({ cwd, extraEnv: { PATH: `${stubDir}:${process.env.PATH}` } });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);
    expect(ctx).not.toContain("```");
    expect(ctx).toContain("Degradation Report");
    expect(ctx).toContain("lore bootstrap failed (exit 0)");
  });
});
