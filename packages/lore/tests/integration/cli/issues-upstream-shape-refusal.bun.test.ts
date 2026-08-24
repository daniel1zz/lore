/**
 * @spec_ref spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired
 *   AC-IS-1, AC-IS-2, AC-IS-3, AC-IS-4.
 *
 * RED-FIRST (P1, plan-make-lore-issues-refuse-a-retired-shape-upstream-as-loudly).
 * `lore issues` and `lore report-issue` give OPPOSITE verdicts on a
 * `feedback.upstream` configured with the RETIRED legacy SQLite shape
 * (`{corpus_path, root_prd}`): `report-issue` refuses loudly (exit 4),
 * `issues` silently falls through to reading the LOCAL cwd corpus (exit 0),
 * indistinguishable from "nothing configured". This file is the CLI-surface
 * oracle for the fix (a shared `classifyFeedbackUpstream` classifier both
 * verbs must consume) — written and run BEFORE that classifier exists, so
 * AC-IS-1 and AC-IS-4 are EXPECTED to fail at RED time (see the plan's own
 * "Measured baseline" table). AC-IS-2 and AC-IS-3 are expected to PASS
 * immediately: they pin behaviour that is ALREADY correct at HEAD and exist
 * so AC-IS-1's new assertion has discriminating power (spec D3) rather than
 * being satisfiable by breaking `lore issues` outright.
 *
 * Mechanism: spawns `bun run src/index.ts ...` (Bun.spawnSync) — a REAL,
 * separate OS process, source (not compiled-binary) — against THROWAWAY
 * `mkdtemp` + `lore init` corpora, never this repo's own `.lore/` (project
 * CLAUDE.md hard rule). Mirrors
 * `tests/unit/adapters/report-issue-single-remedy.bun.test.ts`'s own
 * `INDEX_TS` pattern, chosen specifically so this file needs no
 * `bun run build` first.
 *
 * `feedback.upstream` is written via `@lore/core/node`'s `loadConfig` +
 * `saveConfig` (read-then-full-replace, since `saveConfig` has no
 * partial-merge form) rather than hand-authoring YAML — the SAME convention
 * `report-issue-hint.bun.test.ts`'s `configureUpstream` helper uses.
 *
 * The retired shape's `corpus_path` points at a SECOND throwaway corpus
 * (never the same directory `lore issues` runs from) — per the governing
 * task's consumer-harm framing, the defect is that the verb reads LOCAL
 * while a genuinely DIFFERENT upstream was configured; pointing `corpus_path`
 * at the same directory the command already reads would mask that.
 *
 * Six-dimension coverage note: this file's scope is exactly the four ACs it
 * is dispatched to cover (AC-IS-1..4) — AC-IS-5 (stale-comment lint) is a
 * pure `grep` with no describe here, per the governing plan's own P1 scope
 * note.
 *   HAPPY:      AC-IS-3 — `--local` stays exit 0 under both shapes.
 *   NEGATIVE:   AC-IS-1 — the defect cell must refuse, not silently succeed.
 *   BOUNDARY:   AC-IS-2 — the neighbouring GitHub-shape cell, already
 *               correct, must stay exit 4 (proves AC-IS-1 has discriminating
 *               power rather than being satisfiable by a broken command).
 *   ERROR:      AC-IS-1 / AC-IS-4(a) — exact stderr substrings on refusal.
 *   STATE:      AC-IS-4 — the SAME literal fires from both verbs, evidence
 *               that they consume one shared classifier rather than two
 *               independently-drifted `if` chains.
 *   REGRESSION: AC-IS-3 — the legitimate `--local` opt-out must not become
 *               collateral damage of the coming fix.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "@lore/core/node";
import { FeedbackConfigSchema, type FeedbackConfig, type LoreConfig } from "@lore/core";

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ (3 levels up).
const PROJECT_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PROJECT_ROOT, "..", "..");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns `bun run src/index.ts ...args` — a REAL, separate OS process, source
 * (not compiled-binary) so this file needs no `bun run build` first. Exit
 * code read directly from `Bun.spawnSync`'s own `exitCode` field, never
 * measured through a pipe.
 *
 * `maxBuffer` is set explicitly so a chatty command cannot silently truncate
 * (`exitedDueToMaxBuffer` is checked below instead of being swallowed).
 *
 * ⛔ `Bun.spawnSync`'s `SyncSubprocess` has NO `.error` field — unlike Node's
 * `child_process.spawnSync`, a spawn failure (missing binary, permission
 * denied, etc.) THROWS synchronously instead of returning one. The
 * type-sound equivalent of "never let an infrastructure failure read as a
 * normal command exit" (the ENOBUFS-swallowed-as-exit-1 incident this repo
 * already paid for once) is therefore two checks, not a `.error` probe:
 *   1. catch the throw from the spawn call itself and re-raise it naming the
 *      command, so it is never silently swallowed by a caller only checking
 *      `exitCode`;
 *   2. after a successful spawn, reject a non-normal exit — `signalCode` set
 *      (killed/crashed/OOM, `exitedDueToMaxBuffer`/`exitedDueToTimeout` name
 *      two specific causes) — before trusting `exitCode` as the command's
 *      own verdict. Bun's declared type for `exitCode` is `number` even in
 *      this case, but a signal-terminated process's `exitCode` is not a real
 *      command exit code and must not be reported as one; the `typeof`
 *      check below is the defensive half of that same guard.
 */
function runLore(args: string[], cwd: string): RunResult {
  const commandLabel = `'bun run src/index.ts ${args.join(" ")}' in ${cwd}`;
  let proc: Bun.SyncSubprocess<"pipe", "pipe">;
  try {
    proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: cwd,
        CLAUDECODE: "1",
        LORE_ACTOR: "agent:issues-upstream-shape-refusal-probe",
      },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (spawnError) {
    throw new Error(`Bun.spawnSync threw for ${commandLabel}: ${String(spawnError)}`);
  }
  if (typeof proc.exitCode !== "number" || proc.signalCode !== undefined) {
    throw new Error(
      `${commandLabel} did not exit normally (signalCode=${String(proc.signalCode)}, ` +
        `exitedDueToMaxBuffer=${String(proc.exitedDueToMaxBuffer)}, ` +
        `exitedDueToTimeout=${String(proc.exitedDueToTimeout)}) — refusing to report ` +
        `exitCode=${String(proc.exitCode)} as a real command result.`,
    );
  }
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode,
  };
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed in ${dir}: ${result.stderr}`);
  }
}

type UpstreamCfgInput = NonNullable<NonNullable<LoreConfig["feedback"]>["upstream"]>;

/**
 * `FeedbackConfigSchema`'s own defaults (`stale_after_days`/`inbound`), parsed
 * from `{}` — the SSOT for "no `feedback` section at all" rather than a
 * hand-typed literal duplicating the schema's `.default(...)` values. Used to
 * widen `loaded.value.feedback` (`FeedbackConfig | undefined`, since a fresh
 * `lore init` corpus has no `feedback` key yet) to a definite `FeedbackConfig`
 * BEFORE spreading it — spreading a possibly-`undefined` value directly makes
 * every property of the result optional in TypeScript's eyes, which is
 * exactly the shape mismatch (`stale_after_days`/`inbound` required on
 * `LoreConfig["feedback"]`, optional on the spread) `bun run typecheck`
 * caught. Fixing it this way needs no `as`/`!` — the object handed to
 * `saveConfig` genuinely satisfies `LoreConfig`.
 */
const DEFAULT_FEEDBACK: FeedbackConfig = FeedbackConfigSchema.parse({});

/** Read-then-full-replace write of `feedback.upstream` — `saveConfig` has no partial-merge form. */
function configureUpstream(dir: string, upstream: UpstreamCfgInput): void {
  const loaded = loadConfig(dir);
  if (!loaded.ok) {
    throw new Error(`loadConfig failed for ${dir}: ${loaded.error.code}`);
  }
  const feedback: FeedbackConfig = loaded.value.feedback ?? DEFAULT_FEEDBACK;
  const next: LoreConfig = {
    ...loaded.value,
    feedback: {
      ...feedback,
      upstream,
    },
  };
  const saved = saveConfig(dir, next);
  if (!saved.ok) {
    throw new Error(`saveConfig failed for ${dir}: ${saved.error.code}`);
  }
}

/** Required flags to get `lore report-issue` past its own flag validation (measured 2026-08-24). */
const REPORT_ISSUE_FILING_FLAGS = [
  "--title",
  "shape-refusal-probe",
  "--severity",
  "medium",
  "--category",
  "shape-refusal-probe",
  "--description",
  "d",
  "--expected",
  "e",
  "--actual",
  "a",
];

const TMP_PREFIX = "lore-issues-upstream-shape-refusal-";

let retiredDir: string;
let upstreamTargetDir: string;
let githubDir: string;

beforeAll(() => {
  retiredDir = mkdtempSync(join(tmpdir(), TMP_PREFIX + "retired-"));
  upstreamTargetDir = mkdtempSync(join(tmpdir(), TMP_PREFIX + "upstream-target-"));
  githubDir = mkdtempSync(join(tmpdir(), TMP_PREFIX + "github-"));

  // Never inside this repo — every probed corpus is a throwaway (root
  // CLAUDE.md hard rule: never write to this repo's own live `.lore/`).
  for (const dir of [retiredDir, upstreamTargetDir, githubDir]) {
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
  }

  initCorpus(retiredDir);
  initCorpus(upstreamTargetDir);
  initCorpus(githubDir);

  // Retired shape: {corpus_path, root_prd} — corpus_path points at a SECOND,
  // genuinely different throwaway corpus, so the "reads local instead of the
  // configured upstream" defect is the real consumer-harm case, not a
  // same-directory coincidence.
  configureUpstream(retiredDir, {
    corpus_path: realpathSync(upstreamTargetDir),
    root_prd: "prd-fake-upstream-root",
  });

  // GitHub shape: {repo} — mutually exclusive union branch, no legacy keys.
  configureUpstream(githubDir, {
    repo: "acme/widget",
  });
});

afterAll(() => {
  for (const dir of [retiredDir, upstreamTargetDir, githubDir]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of a throwaway dir */
    }
  }
});

describe("AC-IS-1 retired-shape upstream refuses the upstream read", () => {
  it("AC-IS-1 retired-shape upstream refuses the upstream read", () => {
    const result = runLore(["issues"], retiredDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("retired SQLite shape");
    expect(result.stderr).toContain("feedback.upstream.repo");
  });
});

describe("AC-IS-2 green control: GitHub-shape upstream still refuses", () => {
  it("AC-IS-2 green control: GitHub-shape upstream still refuses", () => {
    const result = runLore(["issues"], githubDir);
    expect(result.exitCode).toBe(4);
    // spec-the-retired-shape-refusal-message-has-two-byte-identical D4: a
    // bare exitCode-4 assertion is satisfiable by ANY unrelated exit-4, so it
    // carries no proof that this specific refusal names the later-phase gap
    // (the AC-IS-2 statement's own promise). Chosen over the equally-present
    // "reading it via 'lore issues' is not yet supported" because this
    // literal has no single quotes and needs no escaping.
    expect(result.stderr).toContain("a later phase of spec-the-defect-channel-reaches-no-machine");
  });
});

describe("AC-IS-3 --local stays exit 0 under both shapes", () => {
  it("AC-IS-3 --local stays exit 0 under both shapes", () => {
    const retiredResult = runLore(["issues", "--local"], retiredDir);
    expect(retiredResult.exitCode).toBe(0);
    const retiredFirstLine = retiredResult.stdout.split("\n")[0] ?? "";
    expect(retiredFirstLine.startsWith("Corpus: ")).toBe(true);
    expect(retiredFirstLine).toBe(`Corpus: ${realpathSync(retiredDir)}`);

    const githubResult = runLore(["issues", "--local"], githubDir);
    expect(githubResult.exitCode).toBe(0);
    const githubFirstLine = githubResult.stdout.split("\n")[0] ?? "";
    expect(githubFirstLine.startsWith("Corpus: ")).toBe(true);
    expect(githubFirstLine).toBe(`Corpus: ${realpathSync(githubDir)}`);
  });
});

describe("AC-IS-4 both verbs source the retired refusal from one classifier", () => {
  it("AC-IS-4 both verbs source the retired refusal from one classifier", () => {
    const issuesResult = runLore(["issues"], retiredDir);
    expect(issuesResult.stderr).toContain("configured with the retired SQLite shape");

    const reportIssueResult = runLore(["report-issue", ...REPORT_ISSUE_FILING_FLAGS], retiredDir);
    expect(reportIssueResult.stderr).toContain("configured with the retired SQLite shape");
  });
});
