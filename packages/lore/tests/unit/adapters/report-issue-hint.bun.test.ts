/**
 * @spec_ref SPEC-073 §Design, §Acceptance Criteria AC-073-1/2/3
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
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 */

import { describe, expect, it, beforeAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { saveConfig } from "@lore/core/node";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";

// tests/unit/adapters/ -> tests/unit/ -> tests/ -> packages/lore/ -> packages/ -> repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

/** Lone token every rendered hint line carries — never split across a wrap point. */
const HINT_TOKEN = "lore report-issue";
/** Re-verify-first clause token (SPEC-073 §Design) — distinguishes the real hint from a coincidental substring match elsewhere in stderr. */
const REVERIFY_TOKEN = "re-checking";

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

describe("AC-073-1: gate-denial hint — configured consumer earns exactly 1 hint line, unconfigured is byte-identical to baseline", () => {
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

  it("BOUNDARY: unconfigured consumer's IDENTICAL gate denial carries 0 hint lines — stderr is EMPTY, matching the pre-SPEC-073 baseline byte-for-byte", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-gate-unc-"));
    initCorpus(tmpDir);
    // deliberately NOT calling configureUpstream() — init's own default
    // config.yaml has no feedback.upstream section at all.

    const result = runLore(
      ["gate", "spec-create", "--input-json", '{"type":"spec","title":"x","content":""}'],
      tmpDir,
    );

    expect(result.exitCode).toBe(4);
    expect(countHintLines(result.stderr)).toBe(0);
    // Pre-SPEC-073, this seam never wrote a single byte to stderr — the ONLY
    // legitimate baseline for "byte-identical" is empty, not merely hint-free.
    expect(result.stderr).toBe("");
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

  it("STATE: unconfigured consumer's SAME corrupted-db failure state carries 0 hint lines (underlying error message unchanged)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-hint-corrupt-unc-"));
    initCorpus(tmpDir);
    corruptDb(tmpDir);

    const result = runLore(["list"], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Storage failure");
    expect(countHintLines(result.stderr)).toBe(0);
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
