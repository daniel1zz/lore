// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired
 *   AC-IS-1, AC-IS-2, AC-IS-4 (AC-IS-3 was superseded by AC-GS-2).
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
 * "Measured baseline" table). AC-IS-2 is expected to PASS
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
 *   HAPPY:      (none — the `--local` opt-out cell was superseded by AC-GS-2).
 *   NEGATIVE:   AC-IS-1 — the defect cell must refuse, not silently succeed.
 *   BOUNDARY:   AC-IS-2 — the neighbouring GitHub-shape cell — ⛔ AMENDED
 *               2026-08-25 (spec-a-github-filed-defect-must-be-claimable-
 *               one-ingest-seam deleted the refusal this cell used to pin):
 *               it now reaches the live GitHub read path under a payload
 *               `gh` stub and exits EXACTLY 0, proving AC-IS-1 has
 *               discriminating power rather than being satisfiable by a
 *               command variant that also exits nonzero on this shape.
 *   ERROR:      AC-IS-1 / AC-IS-4(a) — exact stderr substrings on refusal.
 *   STATE:      AC-IS-4 — the SAME literal fires from both verbs, evidence
 *               that they consume one shared classifier rather than two
 *               independently-drifted `if` chains.
 *   REGRESSION: `--local` is an unknown switch (exit 2) — the opt-out must not return
 *               by accident.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "@lore/core/node";
import { FeedbackConfigSchema, type FeedbackConfig, type LoreConfig } from "@lore/core";
import { buildRetiredFeedbackUpstreamError } from "../../../src/adapters/cli/report-issue-wiring.js";
import { cleanupPayloadGhStubDir, payloadGhStubDir } from "../helpers/payload-gh-stub";

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
function runLore(args: string[], cwd: string, envOverrides: Record<string, string> = {}): RunResult {
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
        ...envOverrides,
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

/**
 * AC-IS-2's seeded GitHub issue number — asserted verbatim in the rendered
 * table (spec's own rejected-forms note: a bare "prints something"
 * assertion is satisfiable by an empty listing; naming this exact number is
 * what closes that hole).
 */
const SEEDED_ISSUE_NUMBER = 84_217;
/** `verifyTarget()`'s `gh api repos/<repo>` response id — unchecked by AC-IS-2 but required by the stub's fixture shape. */
const SEEDED_REPO_ID = 555_000_111;

let retiredDir: string;
let upstreamTargetDir: string;
let githubDir: string;
/** payload gh stub directory for the GitHub-shape green control (AC-IS-2 / AC-MS-4) — serves ONE seeded issue on PATH so `lore issues` reaches a real, stubbed GitHub read path rather than the network. */
let githubGhStubDir: string;

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

  // payload gh stub: one seeded issue, so AC-IS-2's GitHub-shape green
  // control actually reaches a stubbed GitHub read path (never the real
  // network) and its output has exact-value discriminating power.
  githubGhStubDir = payloadGhStubDir({
    repoId: SEEDED_REPO_ID,
    existingIssues: [
      { number: SEEDED_ISSUE_NUMBER, title: "AC-IS-2 seeded fixture issue", state: "open", body: "" },
    ],
    createdNumber: 1,
    createdUrl: "https://example.invalid/never-created",
  });
});

afterAll(() => {
  cleanupPayloadGhStubDir(githubGhStubDir);
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

describe("AC-IS-2 green control: GitHub-shape upstream reaches the GitHub read path", () => {
  it("AC-IS-2 green control: GitHub-shape upstream reaches the GitHub read path", () => {
    // ⛔ AMENDED 2026-08-25: the original asserted "exits EXACTLY 4 naming
    // the later-phase gap" — spec-a-github-filed-defect-must-be-claimable-
    // one-ingest-seam DELETED that refusal (measured on main: Expected 4 /
    // Received 8, since with no reachable `gh` the command now exits the
    // transport code instead). The PURPOSE is unchanged: this cell must not
    // be satisfiable by breaking `lore issues` outright. New form, with
    // exact-value discriminating power on BOTH halves — a command emitting
    // nothing, a blank line, or a bare header would satisfy a weaker
    // "prints its listing" assertion but not this one.
    const result = runLore(["issues"], githubDir, {
      PATH: `${githubGhStubDir}:${process.env.PATH ?? ""}`,
    });
    expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

    const firstLine = result.stdout.split("\n")[0] ?? "";
    expect(firstLine.startsWith("Corpus: ")).toBe(true);
    // The positive half's exact-value discriminator: the seeded issue's own
    // number must appear in the rendered listing.
    expect(result.stdout).toContain(String(SEEDED_ISSUE_NUMBER));
    // The negative half: never the retired-shape refusal this cell used to pin.
    expect(result.stdout).not.toContain("configured with the retired SQLite shape");
    expect(result.stderr).not.toContain("configured with the retired SQLite shape");
  });
});

// reason: `lore issues --local` was removed with the local-corpus read (spec-github-owns-issue-report-state-no-mirror-
// task-work-carries AC-GS-2 superseded the old "--local stays exit 0" criterion): it is an unknown switch under
// every upstream shape. Plain regression, no criterion id.
describe("lore issues --local is an unknown switch", () => {
  it("exits exactly 2 under the retired shape and the GitHub shape, listing nothing", () => {
    for (const dir of [retiredDir, githubDir]) {
      const result = runLore(["issues", "--local"], dir);
      expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(2);
      expect(result.stdout.startsWith("Corpus: ")).toBe(false);
      expect(result.stderr).toContain("--local");
    }
  });
});

describe("AC-IS-4 both verbs source the retired refusal from one classifier", () => {
  it("AC-IS-4 both verbs source the retired refusal from one classifier", () => {
    const issuesResult = runLore(["issues"], retiredDir);
    expect(issuesResult.stderr).toContain(buildRetiredFeedbackUpstreamError().message);

    const reportIssueResult = runLore(["report-issue", ...REPORT_ISSUE_FILING_FLAGS], retiredDir);
    expect(reportIssueResult.stderr).toContain(buildRetiredFeedbackUpstreamError().message);
  });
});

// AC-IL-4 (spec-the-issue-loop-baseline-states-github-owned-issues-stale, BR-506): with nothing configured and with a
// destination in the retired form, BOTH read verbs are refused with exit exactly 4.
describe("AC-IL-4 both read verbs refuse an unconfigured and a retired-form destination with exit 4", () => {
  let unconfiguredDir: string;

  beforeAll(() => {
    unconfiguredDir = mkdtempSync(join(tmpdir(), TMP_PREFIX + "unconfigured-"));
    expect(unconfiguredDir.startsWith(REPO_ROOT)).toBe(false);
    initCorpus(unconfiguredDir);
  });

  afterAll(() => {
    rmSync(unconfiguredDir, { recursive: true, force: true });
  });

  it("AC-IL-4 no destination configured: lore issues and lore report-issue --list each exit exactly 4", () => {
    for (const args of [["issues"], ["report-issue", "--list"]]) {
      const result = runLore(args, unconfiguredDir);
      expect(result.exitCode, `${args.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(4);
      expect(result.stdout.startsWith("Corpus: ")).toBe(false);
    }
  });

  it("AC-IL-4 retired-form destination: lore issues and lore report-issue --list each exit exactly 4", () => {
    for (const args of [["issues"], ["report-issue", "--list"]]) {
      const result = runLore(args, retiredDir);
      expect(result.exitCode, `${args.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(4);
      expect(result.stderr).toContain("retired SQLite shape");
    }
  });
});
