/**
 * @spec_ref SPEC-073 §Design, §Acceptance Criteria AC-073-1/2/3; SPEC-OOB (out-of-box
 *   reporting channel — report-issue self-provisions its upstream config) §Acceptance
 *   Criteria AC-OOB-6
 *
 * e2e regression oracle for `buildReportIssueHint` (`report-issue-hint.ts`) and its
 * two wiring seams — `loader.ts`'s internal-error branches (`errClass: "internal"`)
 * and `commands/gate.ts`'s five blocked-checkpoint branches (`errClass: "gate"`).
 *
 * Spawns the COMPILED `dist/lore` binary (`Bun.spawnSync`) against THROWAWAY
 * corpora created via `mkdtemp(os.tmpdir())` — genuinely outside this repo's own
 * working tree. Never touches the repo's own `.lore/` corpus (project CLAUDE.md
 * hard rule). `assertFreshBinary` (same helper `slugify-compiled.bun.test.ts` /
 * `cli-claim-anchors.bun.test.ts` use) fails loud before any test runs if
 * `dist/lore` is missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src` — run `bun run build` first.
 *
 * "Configured" vs "unconfigured" consumer: a corpus's `.lore/config.yaml` either
 * declares `feedback.upstream` (SPEC-072) or doesn't — `configureUpstream()` writes
 * a full-replace config via `@lore/core/node`'s `saveConfig` (same convention
 * `cli-loader.bun.test.ts`'s `writeConfig` helper uses). The `corpus_path` need not
 * resolve to a real upstream corpus — `buildReportIssueHint` only ever receives a
 * pre-computed `boolean` (presence, not validity) from
 * `report-issue-wiring.ts::resolveFeedbackUpstreamCfg`.
 *
 * AC-OOB-6 (RED, plan-implementation-out-of-box-reporting-channel-self-provision §T2):
 * SPEC-073 deliberately made the unconfigured branch byte-absent — combined with
 * SPEC-072's config being provisioned by no init/setup path, a fresh consumer is
 * NEVER told the reporting channel exists (the self-lock the SPEC-OOB spec closes).
 * The AC-OOB-6 case below asserts BOTH directions in one `-t 'AC-OOB-6'`-addressable
 * test: an unconfigured consumer's gate-denial stderr must gain exactly 1
 * provision-guidance line (today 0 — the RED half, failing until T5 changes
 * `buildReportIssueHint`'s unconfigured branch), AND a configured consumer's
 * gate-denial stderr must stay byte-identical to the AC-073-1 baseline wording (the
 * regression floor — a one-directional test would let the fix silently break the
 * already-working configured path).
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 */

import { describe, expect, it, beforeAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { saveConfig } from "@lore/core/node";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";
import { buildReportIssueHint } from "../../../src/adapters/cli/report-issue-hint.js";

// tests/unit/adapters/ -> tests/unit/ -> tests/ -> packages/lore/ -> packages/ -> repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

/** Lone token every rendered hint line carries — never split across a wrap point. */
const HINT_TOKEN = "lore report-issue";
/** Re-verify-first clause token (SPEC-073 §Design) — distinguishes the real hint from a coincidental substring match elsewhere in stderr. */
const REVERIFY_TOKEN = "re-checking";
/**
 * Provision-guidance token (SPEC-OOB §Design + task-t5-unlock-the-spec-073-hint-s-
 * unconfigured-branch: "pointing at the provision path (the --auto-config command)")
 * — the literal flag every future unconfigured-branch hint must name, distinguishing
 * the NEW self-provision guidance line from the pre-existing configured-branch hint
 * (which carries {@link HINT_TOKEN} + {@link REVERIFY_TOKEN} but never this token).
 */
const PROVISION_TOKEN = "--auto-config";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the compiled `dist/lore` binary with `cwd` as its working directory.
 * `CLAUDECODE: "1"` resolves the CLI's "agent" caller surface (SPEC-024) so no
 * gate-feeding AI call is ever attempted; `HOME` is redirected into the throwaway
 * dir so no ambient `~/.config/lore/config.yaml` on the host machine leaks in.
 */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Counts lines containing {@link HINT_TOKEN} — the AC's "EXACTLY 1 hint line" assertion. */
function countHintLines(text: string): number {
  return text.split("\n").filter((line) => line.includes(HINT_TOKEN)).length;
}

/** Generic "count lines containing `token`" helper for AC-OOB-6's provision-guidance assertion. */
function countLinesContaining(text: string, token: string): number {
  return text.split("\n").filter((line) => line.includes(token)).length;
}

/** Counts non-empty physical lines — a structural "exactly 1 line" check independent of token content. */
function nonEmptyLineCount(text: string): number {
  return text.split("\n").filter((line) => line.length > 0).length;
}

function initCorpus(tmpDir: string): void {
  const result = runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

/**
 * Full-replace `config.yaml` write declaring `feedback.upstream` — mirrors
 * `cli-loader.bun.test.ts`'s `writeConfig` convention (no partial-merge writer
 * exists for `saveConfig`, so every field this corpus needs is restated here).
 */
function configureUpstream(tmpDir: string): void {
  const result = saveConfig(tmpDir, {
    project: { name: "report-issue-hint-probe", author: "tester" },
    feedback: {
      upstream: {
        corpus_path: "/tmp/lore-report-issue-hint-test-upstream",
        root_prd: "prd-upstream-root",
      },
    },
  } as never);
  if (!result.ok) {
    throw new Error(`saveConfig failed: ${result.error.code}`);
  }
}

/**
 * Overwrites the just-initialised corpus's `.lore/lore.db` with non-SQLite bytes —
 * `bun:sqlite`'s `Database` constructor throws SYNCHRONOUSLY on open (proven
 * empirically: `file is not a database`), reproducing the "internal unexpected
 * throw" errClass AC-073-3 targets. Removes the WAL/SHM sidecar files first so a
 * stale one can't mask the corruption.
 */
function corruptDb(tmpDir: string): void {
  const loreDir = join(tmpDir, ".lore");
  rmSync(join(loreDir, "lore.db-shm"), { force: true });
  rmSync(join(loreDir, "lore.db-wal"), { force: true });
  writeFileSync(join(loreDir, "lore.db"), "garbage-not-a-sqlite-file-xyz");
}

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-073-1: gate-denial hint — configured consumer earns exactly 1 hint line; unconfigured now carries the SPEC-OOB provision-guidance line", () => {
  it("HAPPY: configured consumer's `lore gate spec-create` denial carries EXACTLY 1 hint line naming lore report-issue + the re-verify-first clause", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-gate-cfg-"));
    initCorpus(tmpDir);
    configureUpstream(tmpDir);

    const result = runLore(
      ["gate", "spec-create", "--input-json", '{"type":"spec","title":"x","content":""}'],
      tmpDir,
    );

    expect(result.exitCode).toBe(4);
    expect(countHintLines(result.stderr)).toBe(1);
    expect(result.stderr).toContain(HINT_TOKEN);
    expect(result.stderr.toLowerCase()).toContain(REVERIFY_TOKEN);
    // The pre-existing feeding-pack content (stdout) is untouched by this seam.
    expect(result.stdout).toContain("PARENT_REQUIRED");
  });

  it("BOUNDARY: unconfigured consumer's IDENTICAL gate denial now carries exactly 1 provision-guidance line naming --auto-config (SPEC-OOB supersedes the old SPEC-073 byte-absent baseline)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-gate-unc-"));
    initCorpus(tmpDir);
    // deliberately NOT calling configureUpstream() — init's own default
    // config.yaml has no feedback.upstream section at all.

    const result = runLore(
      ["gate", "spec-create", "--input-json", '{"type":"spec","title":"x","content":""}'],
      tmpDir,
    );

    expect(result.exitCode).toBe(4);
    // SPEC-OOB (task T5/T7) intentionally changed this seam: the unconfigured
    // branch now emits a provision-guidance hint instead of staying byte-absent.
    // AC-OOB-6 is the new authoritative baseline for this scenario — the old
    // SPEC-073 empty-stderr expectation is superseded, not violated.
    expect(countLinesContaining(result.stderr, PROVISION_TOKEN)).toBe(1);
    // Structural check independent of token content: the entire stderr is
    // exactly one non-empty physical line (mirrors the AC-OOB-6 idiom below).
    expect(nonEmptyLineCount(result.stderr)).toBe(1);
    expect(result.stderr).not.toBe("");
    // The pre-existing feeding-pack content (stdout) is untouched by this seam.
    expect(result.stdout).toContain("PARENT_REQUIRED");
  });
});

describe("AC-073-2: hint scoping negatives — a usage error and a plain non-gate VALIDATION_ERROR never earn a hint, even when configured", () => {
  it("NEGATIVE: unknown flag (exit 2 usage error), configured consumer — 0 hint lines", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-usage-"));
    initCorpus(tmpDir);
    configureUpstream(tmpDir);

    const result = runLore(["list", "--bogus-flag"], tmpDir);

    expect(result.exitCode).toBe(2);
    expect(countHintLines(result.stderr)).toBe(0);
  });

  it("NEGATIVE: plain non-gate VALIDATION_ERROR (illegal draft→archived transition), configured consumer — 0 hint lines", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-validation-"));
    initCorpus(tmpDir);
    configureUpstream(tmpDir);

    const created = runLore(
      ["create", "prd", "--title", "Probe Root", "--content", "x", "--json"],
      tmpDir,
    );
    expect(created.exitCode).toBe(0);
    const { data } = JSON.parse(created.stdout) as { data: { slug: string } };

    const result = runLore(["set", data.slug, "--status", "archived"], tmpDir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("Cannot transition");
    expect(countHintLines(result.stderr)).toBe(0);
  });
});

describe("AC-073-3: internal-error hint — a corrupted .lore/lore.db earns exactly 1 hint line when configured, 0 when not", () => {
  it("ERROR: configured consumer's corrupted-db failure carries EXACTLY 1 hint line", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-corrupt-cfg-"));
    initCorpus(tmpDir);
    configureUpstream(tmpDir);
    corruptDb(tmpDir);

    const result = runLore(["list"], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Storage failure");
    expect(countHintLines(result.stderr)).toBe(1);
    expect(result.stderr).toContain(HINT_TOKEN);
  });

  it("STATE: unconfigured consumer's SAME corrupted-db failure state now carries exactly 1 provision-guidance line naming --auto-config (underlying error message unchanged; SPEC-OOB supersedes the old SPEC-073 byte-absent baseline)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-corrupt-unc-"));
    initCorpus(tmpDir);
    corruptDb(tmpDir);

    const result = runLore(["list"], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Storage failure");
    expect(countLinesContaining(result.stderr, PROVISION_TOKEN)).toBe(1);
  });
});

describe("AC-OOB-6: self-lock broken, both directions — unconfigured gate-denial gains exactly 1 provision-guidance line, configured gate-denial stays byte-identical to the AC-073-1 baseline", () => {
  it("AC-OOB-6: unconfigured consumer earns exactly 1 --auto-config provision-guidance line (RED — today 0); configured consumer's hint stays byte-identical to the SPEC-073 baseline (regression floor)", () => {
    // ---- Direction 1: UNCONFIGURED consumer — the self-lock scenario. ----
    // Deliberately NOT calling configureUpstream(): a fresh consumer whose
    // `.lore/config.yaml` has no `feedback.upstream` at all is exactly the state
    // SPEC-OOB names as unreachable — the promotion mechanism's trigger condition
    // (upstreamConfigured) is exactly the configuration nothing ever provisions.
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-oob6-unc-"));
    initCorpus(tmpDir);

    const unconfigured = runLore(
      ["gate", "spec-create", "--input-json", '{"type":"spec","title":"x","content":""}'],
      tmpDir,
    );
    // Clean up this half's throwaway dir now — the second half below reassigns
    // `tmpDir` to a fresh mkdtemp for `afterEach` to catch; doing it manually here
    // means a mid-test failure still leaves at most one leaked dir behind.
    rmSync(tmpDir, { recursive: true, force: true });

    expect(unconfigured.exitCode).toBe(4);
    // RED: `buildReportIssueHint(errClass, false)` unconditionally returns `null`
    // today (see report-issue-hint.ts: `if (errClass === null || !upstreamConfigured)
    // return null`), so `emitGateReportIssueHint` writes nothing and this stderr is
    // byte-EMPTY (0 lines) — this is a missing-behaviour failure, not a wording typo.
    // It stays RED until T5 (GREEN) changes the unconfigured branch to return a
    // provision-guidance line naming `--auto-config`.
    expect(countLinesContaining(unconfigured.stderr, PROVISION_TOKEN)).toBe(1);
    // Independent structural condition (not just "the token appears somewhere"):
    // the ENTIRE stderr is exactly one non-empty physical line.
    expect(nonEmptyLineCount(unconfigured.stderr)).toBe(1);
    expect(unconfigured.stderr).not.toBe("");

    // ---- Direction 2: CONFIGURED consumer — the AC-073-1 regression floor. ----
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-oob6-cfg-"));
    initCorpus(tmpDir);
    configureUpstream(tmpDir);

    const configured = runLore(
      ["gate", "spec-create", "--input-json", '{"type":"spec","title":"x","content":""}'],
      tmpDir,
    );

    // `buildReportIssueHint` is the single wording SSOT (SPEC-073 §Design) — pin the
    // CLI's actual stderr against the SSOT's own current output, not a copied
    // literal, so wording drift in the SSOT is caught wherever it happens.
    const expectedConfiguredHint = buildReportIssueHint("gate", true);
    if (expectedConfiguredHint === null) {
      throw new Error(
        "buildReportIssueHint('gate', true) returned null — the configured branch " +
          "must never be byte-absent; SSOT contract broken",
      );
    }

    expect(configured.exitCode).toBe(4);
    // Byte-identical: `emitGateReportIssueHint` writes ONLY `hint + "\n"` to
    // stderr on a gate denial (verified against commands/gate.ts — the feeding
    // pack goes to stdout via console.log), so the entire stderr content is
    // pinned exactly, not merely "contains the hint".
    expect(configured.stderr).toBe(expectedConfiguredHint + "\n");
    expect(countHintLines(configured.stderr)).toBe(1);
    expect(configured.stderr.toLowerCase()).toContain(REVERIFY_TOKEN);

    // The two directions must render genuinely DIFFERENT text — a stub that
    // ignores `upstreamConfigured` and always emits the configured wording (or
    // vice versa) would defeat direction 1's provision-token check only by
    // coincidence; explicitly reject that shape.
    expect(unconfigured.stderr).not.toBe(configured.stderr);
  });
});

describe("REGRESSION: the hint wiring never fires on an ALLOW branch", () => {
  it("a configured consumer's PASSING `lore gate spec-create` still prints only 'gate: pass' — 0 hint lines, empty stderr", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-allow-"));
    initCorpus(tmpDir);
    configureUpstream(tmpDir);

    const prdResult = runLore(
      ["create", "prd", "--title", "Root", "--content", "x", "--json"],
      tmpDir,
    );
    expect(prdResult.exitCode).toBe(0);
    const { data } = JSON.parse(prdResult.stdout) as { data: { id: string } };

    const result = runLore(
      [
        "gate",
        "spec-create",
        "--input-json",
        JSON.stringify({
          type: "spec",
          title: "x",
          parent_id: data.id,
          content: "## Overview\nsomething",
          extra: { spec_kind: "feature" },
        }),
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("gate: pass");
    expect(result.stderr).toBe("");
    expect(countHintLines(result.stderr)).toBe(0);
  });
});
