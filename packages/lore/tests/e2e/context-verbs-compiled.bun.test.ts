// @reads assets/**
/**
 * RED (TDD role) — compiled-binary e2e oracle for AC-CTX-3
 * (spec-context-verb-family-two-zone-claude-md-anatomy-lore). The `lore
 * context` verb family (`context init` / `context refresh`) does NOT exist
 * yet: `packages/lore/src/adapters/cli/commands/context.ts` is unwritten (the
 * paired implementation task
 * task-skill-implement-context-init-refresh-cli-flow-orchestration owns it),
 * so `context` is an unregistered top-level command today. This suite MUST
 * FAIL until that task lands.
 *
 * Empirically verified CURRENT (pre-implementation) behavior — this is what
 * makes every case below RED, not a test bug (repo standing lesson: trace
 * every RED failure to the real gap, never a mistyped assertion):
 *   - `dist/lore context init` (and any other `context <anything>`) — citty
 *     has no `context` entry in its command map at all, so it prints
 *     ` ERROR  Unknown command context` to stderr, the top-level usage block
 *     to stdout, and exits **1** (verified directly: `dist/lore context init
 *     >out 2>err; echo $?` → `1`, `err` == exactly one line, ` ERROR  Unknown
 *     command context`). This is DIFFERENT from the strict-flags family's
 *     exit-2 convention (SPEC-051/SPEC-073) — citty's unknown-COMMAND path is
 *     a separate code path from the unknown-FLAG path those specs cover — so
 *     every exit-code assertion below (0, 2, whatever the target scenario
 *     needs) fails against today's flat `1`.
 *   - No CLAUDE.md is ever written by this call, so every content assertion
 *     (managed markers present, fingerprint comment format, byte-identity
 *     across two runs) also fails today — there is nothing on disk to read.
 *
 * Target behavior under test (AC-CTX-3, §Public Interface, §Design
 * Decisions D3/D5): `lore context init` in a repo with no usable AI
 * provider configured exits 0, writes a root CLAUDE.md containing the
 * lore-managed (Z1) zone — wrapped in the SAME `CLAUDE_MD_MARKER_START` /
 * `CLAUDE_MD_MARKER_END` literals `@lore/core`'s `memory-markers.ts` exports
 * (byte-identical to `setup-project-flow.ts`'s own copies, SPEC-076 D7) —
 * and prints a stderr warning naming the skeleton fallback (D3: "skeleton +
 * loud stderr warning, exit 0, report.narrative='skeleton'"). An immediately
 * following `lore context refresh` is idempotent (byte-identical output,
 * D5/AC-CTX-1's splice-idempotency invariant lifted to the CLI). A
 * hand-edit inside one managed section's body invalidates that section's
 * stored fingerprint hash, so the next `refresh` must report it
 * `diverged_skip` (the literal `SpliceSectionState` from
 * `service/context-projection.ts`) and leave the file's bytes untouched
 * (never silently overwritten, D5's core divergence-detection guarantee).
 *
 * Modeled on `tests/e2e/governance-claude-md-compiled.bun.test.ts` (compiled
 * `dist/lore` harness conventions: `assertFreshBinary` guard, `REPO_ROOT`
 * derivation, `Bun.spawnSync` wrapper) and
 * `tests/e2e/bootstrap-injection-compiled.bun.test.ts` (mkdtemp throwaway
 * corpus, `HOME` pointed at the temp dir, `CLAUDECODE=1` in the child env so
 * the "agent" caller surface (SPEC-024) resolves AI default OFF — this repo
 * never writes to its own `.lore/` corpus, project CLAUDE.md hard rule).
 *
 * Coverage:
 *   HAPPY:      `context init` in a fresh temp repo (no AI provider
 *               configured) exits 0 and writes a root CLAUDE.md whose
 *               content contains BOTH the literal `CLAUDE_MD_MARKER_START`
 *               and `CLAUDE_MD_MARKER_END` strings (imported from
 *               `@lore/core`, never hand-copied) — the two-zone skeleton is
 *               genuinely on disk, not merely reported.
 *   BOUNDARY:   the written file is non-empty, ends with a trailing
 *               newline, and contains at least one well-formed fingerprint
 *               comment line matching the `<!-- lore:managed section=<id>
 *               hash=<8hex> -->` grammar `@lore/core`'s
 *               `MANAGED_SECTION_HASH_PATTERN`/format helper define — pins
 *               the boundary byte independently so a truncated or
 *               malformed-fingerprint regression fails unambiguously from
 *               the byte-identity assertion above.
 *   REGRESSION: an immediately-following `context refresh` (no edits in
 *               between) exits 0 and reproduces byte-identical file content
 *               — regenerating the projection from unchanged reality must
 *               never drift, even before any hand-edit enters the picture.
 *   ERROR:      `context bogus-topic` (unrecognized subcommand/topic) exits
 *               2 with a usage-style message naming the bad token — the
 *               target contract's usage-error path, distinct from the
 *               flat-1 "Unknown command" citty falls back to today.
 *   STATE:      hand-editing one line inside a managed section's body (kept
 *               between its fingerprint comment and the next
 *               fingerprint/end-marker line) invalidates that section's
 *               stored hash; the next `context refresh` reports that
 *               section's id with state `diverged_skip` (stdout/JSON) and
 *               leaves the file bytes BYTE-IDENTICAL to the post-hand-edit
 *               snapshot (not reverted, not re-overwritten).
 *   NEGATIVE:   `context init --bogus-flag` (unknown flag on a real,
 *               registered subcommand) is rejected via the SPEC-051/073
 *               strict-flags convention (exit 2, message names
 *               `--bogus-flag`) — distinguishes "bad flag on a known verb"
 *               from the ERROR case's "unknown verb entirely", both
 *               presently masked by the same flat `Unknown command context`
 *               exit-1 path.
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   §Public Interface, §Design Decisions D3/D5, AC-CTX-3; task
 *   task-skill-test-red-compiled-binary-e2e-for-context-init-and.
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CLAUDE_MD_MARKER_START, CLAUDE_MD_MARKER_END, MANAGED_SECTION_HASH_PATTERN } from "@lore/core";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// tests/e2e/context-verbs-compiled.bun.test.ts -> repo root is 4 levels up,
// same derivation as tests/e2e/bootstrap-injection-compiled.bun.test.ts and
// tests/e2e/governance-claude-md-compiled.bun.test.ts.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const CLAUDE_MD_FILENAME = "CLAUDE.md";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the COMPILED `dist/lore` binary with `cwd`/`HOME` both pointed at
 * the throwaway temp repo, `CLAUDECODE=1` in the child env so the "agent"
 * caller surface (SPEC-024) resolves the AI default OFF, and every known AI
 * provider credential env var stripped so no accidental real-provider call
 * is even reachable — the fixture genuinely has "no usable AI provider
 * configured" per the task's setup requirement, not merely "AI defaulted
 * off but a key happens to be present in the ambient shell".
 */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: cwd, CLAUDECODE: "1" };
  delete env["ANTHROPIC_API_KEY"];
  delete env["OPENAI_API_KEY"];
  delete env["LORE_AI_DEFAULT"];
  const proc = await runLoreInProcess(args, { cwd, env });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

async function initCorpus(dir: string): Promise<void> {
  const result = await runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed in fixture setup: ${result.stderr}`);
  }
}

/** Extracts every fingerprint-comment section id found in `content`'s managed zone, in document order — used to pick a real section to hand-edit without hardcoding an id the future implementation might name differently. */
function extractSectionIds(content: string): string[] {
  const pattern = /<!-- lore:managed section=(\S+) hash=([0-9a-f]{8}) -->/g;
  const ids: string[] = [];
  for (const match of content.matchAll(pattern)) {
    const id = match[1];
    if (id !== undefined) {
      ids.push(id);
    }
  }
  return ids;
}

describe("AC-CTX-3: compiled dist/lore context init/refresh two-zone CLAUDE.md lifecycle (RED — target D3/D5 behavior)", () => {
  it("HAPPY: `context init` in a temp repo with no usable AI provider exits 0 and writes a root CLAUDE.md carrying the lore-managed (Z1) zone markers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-context-init-happy-"));
    // Never the repo's own .lore/ corpus (project CLAUDE.md hard rule) — a
    // genuine os.tmpdir() path is never a prefix of REPO_ROOT.
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    try {
      await initCorpus(dir);

      const result = await runLore(["context", "init"], dir);
      expect(result.exitCode).toBe(0);

      const claudeMdPath = join(dir, CLAUDE_MD_FILENAME);
      const content = readFileSync(claudeMdPath, "utf8");
      expect(content).toContain(CLAUDE_MD_MARKER_START);
      expect(content).toContain(CLAUDE_MD_MARKER_END);

      // D3: provider absent -> skeleton fallback, loud stderr warning, never
      // silent. Key on lone tokens (standing lesson), not a remembered
      // contiguous phrase.
      const stderrLower = result.stderr.toLowerCase();
      const namesSkeletonOrProvider = stderrLower.includes("skeleton") || stderrLower.includes("provider");
      expect(namesSkeletonOrProvider).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("BOUNDARY: the written CLAUDE.md is non-empty, ends with a trailing newline, and contains at least one well-formed fingerprint comment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-context-init-boundary-"));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    try {
      await initCorpus(dir);
      const initResult = await runLore(["context", "init"], dir);
      expect(initResult.exitCode).toBe(0);

      const content = readFileSync(join(dir, CLAUDE_MD_FILENAME), "utf8");
      expect(content.length).toBeGreaterThan(0);
      expect(content.endsWith("\n")).toBe(true);

      const sectionIds = extractSectionIds(content);
      expect(sectionIds.length).toBeGreaterThan(0);
      const firstMatch = /<!-- lore:managed section=(\S+) hash=([0-9a-f]{8}) -->/.exec(content);
      expect(firstMatch).not.toBeNull();
      const hash = firstMatch?.[2] ?? "";
      expect(MANAGED_SECTION_HASH_PATTERN.test(hash)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("REGRESSION: an immediately-following `context refresh` (no edits) reproduces byte-identical CLAUDE.md content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-context-refresh-idempotent-"));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    try {
      await initCorpus(dir);
      const initResult = await runLore(["context", "init"], dir);
      expect(initResult.exitCode).toBe(0);

      const claudeMdPath = join(dir, CLAUDE_MD_FILENAME);
      const beforeRefresh = readFileSync(claudeMdPath, "utf8");

      const refreshResult = await runLore(["context", "refresh"], dir);
      expect(refreshResult.exitCode).toBe(0);

      const afterRefresh = readFileSync(claudeMdPath, "utf8");
      expect(afterRefresh).toBe(beforeRefresh);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ERROR: `context bogus-topic` (unrecognized topic) exits 2 with a usage message naming the bad token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-context-error-topic-"));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    try {
      await initCorpus(dir);
      const result = await runLore(["context", "bogus-topic"], dir);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("bogus-topic");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("STATE: hand-editing one line inside a managed section makes the next `refresh` report diverged_skip for that section and leave the file bytes untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-context-refresh-diverged-"));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    try {
      await initCorpus(dir);
      const initResult = await runLore(["context", "init"], dir);
      expect(initResult.exitCode).toBe(0);

      const claudeMdPath = join(dir, CLAUDE_MD_FILENAME);
      const original = readFileSync(claudeMdPath, "utf8");
      const sectionIds = extractSectionIds(original);
      expect(sectionIds.length).toBeGreaterThan(0);
      const targetSectionId = sectionIds[0] as string;

      // Hand-edit exactly one line: find the fingerprint comment for
      // targetSectionId and mutate the very next line (its body's first
      // line) — a real edit strictly BETWEEN the fingerprint comment and the
      // section's end, never touching the fingerprint line itself (that
      // would just look like corruption, not a legitimate hand-edit of the
      // body the fingerprint no longer matches).
      const lines = original.split("\n");
      const fingerprintLineIdx = lines.findIndex((line) =>
        line.includes(`section=${targetSectionId} `),
      );
      expect(fingerprintLineIdx).toBeGreaterThanOrEqual(0);
      const bodyLineIdx = fingerprintLineIdx + 1;
      expect(bodyLineIdx).toBeLessThan(lines.length);
      lines[bodyLineIdx] = `${lines[bodyLineIdx]} <<< HAND-EDITED BY TEST >>>`;
      const handEdited = lines.join("\n");
      writeFileSync(claudeMdPath, handEdited, "utf8");

      const postEditSnapshot = readFileSync(claudeMdPath, "utf8");
      expect(postEditSnapshot).toBe(handEdited);

      // Exit code is deliberately NOT asserted to a single value here — the
      // task explicitly hedges "exit 0 (or documented non-zero — assert on
      // the REPORTED state)". What must hold is the REPORTED divergence and
      // the untouched bytes.
      const refreshResult = await runLore(["context", "refresh"], dir);
      const reportedDivergence =
        refreshResult.stdout.includes("diverged_skip") || refreshResult.stderr.includes("diverged_skip");
      expect(reportedDivergence).toBe(true);
      expect(refreshResult.stdout).toContain(targetSectionId);

      const afterRefresh = readFileSync(claudeMdPath, "utf8");
      expect(afterRefresh).toBe(postEditSnapshot);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("NEGATIVE: `context init --bogus-flag` (unknown flag on a registered verb) is rejected by strict-flags, exit 2, naming --bogus-flag", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-context-negative-flag-"));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    try {
      await initCorpus(dir);
      const result = await runLore(["context", "init", "--bogus-flag"], dir);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("--bogus-flag");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
