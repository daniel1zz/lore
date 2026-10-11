/**
 * Compiled-binary e2e oracle for the resume-ticket COVERAGE FLOOR's two
 * shipping surfaces (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the,
 * task-t4-governance-rule-manifest-regeneration-fresh-install-e2e).
 *
 * T1/T2/T3/T5 landed the mechanism (ordinal render at `renderHandoffContent`,
 * the floor append on `feed-flow.ts`'s single-record path, the
 * `lore handoff coverage-check` verb, the blind-pipe Stop hook) and each has
 * unit coverage of its own piece. This file's job is the DISTRIBUTION half of
 * the spec's delivery constraint: prove the grammar actually reaches a
 * consumer on BOTH render surfaces of the freshly compiled binary, and that
 * the new hook plus the edited governance asset actually SHIP (installed
 * bytes + embedded manifest digests), not merely exist in `assets/`.
 *
 * Three ACs, each addressed by its own `-t` filter. MEASURED matched counts (a
 * zero/partial-match filtered run is this repo's most-measured false-pass
 * vector, so the count is part of the contract, not a detail):
 *   `-t "both surfaces"`       -> 3 tests (the AC-RC-4 test plus the BOUNDARY
 *                                 and REGRESSION tests, whose names also carry
 *                                 the phrase because they too assert across
 *                                 BOTH surfaces — all three are AC-RC-4
 *                                 evidence, so the wider match is intended,
 *                                 not accidental).
 *   `-t "install parity"`      -> 1 test.
 *   `-t "stop hook registered"`-> 1 test (the phrase lives in that test's own
 *                                 name, NOT in its describe, so the filter
 *                                 cannot silently widen).
 * A run reporting any other count means a test was renamed or dropped; treat
 * it as a failed oracle, never as a pass.
 *
 *   "both surfaces"  (AC-RC-4) — the compiled `dist/lore feed session-resume`
 *                     stdout AND the MCP `lore_feed {checkpoint:
 *                     "session-resume"}` response each INDEPENDENTLY carry the
 *                     ordinal tags, the cardinality line, and
 *                     `RESUME_COVERAGE_FLOOR`. Asserted as two separate
 *                     structural comparisons over two separately-obtained
 *                     texts — never one assertion over a merged blob, which is
 *                     the exact defect SPEC-CP D3 measured (a CLI-only
 *                     assertion left every MCP consumer on the old
 *                     behaviour). A third, in-test CONTROL comparison runs the
 *                     same report builder over deliberately mutilated copies
 *                     of the CLI text and asserts it reports FALSE — so
 *                     neither surface's half can pass vacuously through a
 *                     report builder that always answers true (D7:
 *                     every blocking assertion carries a liveness control).
 *
 *   "install parity" (AC-RC-8) — `lore setup --claude-dir <throwaway>`
 *                     installs `hooks/stop-handoff-coverage.mjs`
 *                     byte-identical to its `assets/` SSOT, and the EMBEDDED
 *                     manifest's sha256 for BOTH changed assets (the new hook
 *                     AND the edited `governance/corpus-workflow.md`) equals
 *                     the on-disk digest. Storage parity is not distribution:
 *                     the oracle for the hook is the INSTALLED file read back
 *                     from the throwaway claude-dir. `governance/corpus-workflow.md`
 *                     is RETIRED from the machine install set (SPEC-083 D3),
 *                     so it is asserted ABSENT there and its own distribution
 *                     oracle is the binary's runtime `lore governance` verb.
 *                     Liveness controls: a whole-tree digest recompute (so
 *                     "asset edited, manifest not regenerated" cannot pass),
 *                     and a post-assertion perturbation of the installed copy
 *                     proving the byte comparison actually discriminates.
 *
 *   "stop hook registered" (AC-RC-13) — installed is not WIRED. The same
 *                     `lore setup --claude-dir <throwaway>` run's
 *                     `settings.json` carries a Stop registration for the new
 *                     hook, compared by deep equality against the entry
 *                     DERIVED from the exported `HOOK_REGISTRATIONS` (via
 *                     `buildHookSettingsEntries(targetDir)`) — never a
 *                     hand-written command string, so a rename that misses the
 *                     registry fails instead of drifting silently. Control
 *                     against a vacuous pass: the SAME parsed file must also
 *                     carry the incumbent `stop-doc-sync` Stop entry, so an
 *                     unparsed/empty/hook-less settings file cannot read as
 *                     "registered". Further liveness controls: a fabricated
 *                     never-registered command and a right-command/wrong-event
 *                     pair must both be ABSENT (so the containment comparison
 *                     is proven to discriminate), and the registered command's
 *                     target path must exist and be executable (a registration
 *                     pointing at nothing never fires either).
 *
 * Mode asymmetry is INTENTIONAL and deliberately not asserted as equality:
 * `SetupService` writes every `kind === "hook"` asset with the executable bit
 * (`setup-service.ts`, `write.kind === "hook" ? { executable: true }`) while
 * the repo blob is `100644`. The comparison is therefore over CONTENT bytes;
 * the STATE test below pins the executable bit on the installed copy
 * separately, because a hook that ships non-executable never runs.
 *
 * ⛔ Two hard environment rules this file obeys:
 *   - Every `lore setup` invocation passes `--claude-dir <mkdtemp path>`.
 *     A bare `lore setup` on a dev machine resolves removals THROUGH the dev
 *     symlinks in `~/.claude/` and deletes this repo's own `assets/` SSOT
 *     (measured twice, 2026-07-30; `spec-lore-setup-follows-a-dev-symlink-into-assets-and`).
 *     The "install parity" and "stop hook registered" tests each assert their
 *     target dir is neither inside this repo nor the real `~/.claude` BEFORE
 *     invoking setup.
 *   - No scenario writes to this repo's own `.lore/` corpus (project CLAUDE.md
 *     hard rule). Every corpus write goes to a throwaway `mkdtemp` root
 *     outside the repo tree; the only repo-directed calls are the read-only
 *     `lore governance` verb and `readFileSync` over `assets/`.
 *
 * Freshness: `beforeAll` runs `assertFreshBinary` (CLAUDE.md false-oracle
 * vector #4). That guard only compares `.ts` mtimes, so it cannot see a
 * post-build `assets/` edit — the "install parity" test's own whole-tree
 * digest recompute covers that blind spot explicitly.
 *
 * Coverage dimensions:
 *   HAPPY:      both surfaces carry the full grammar; the hook installs
 *               byte-identical and both manifest digests are current; the fresh
 *               install's settings.json carries the derived Stop registration.
 *   NEGATIVE:   the report builder answers FALSE for text with the floor
 *               removed / the ordinals stripped / the cardinality line
 *               altered; the installed-byte comparison answers FALSE once the
 *               installed copy is perturbed; a never-registered command and a
 *               right-command/wrong-event pair are both ABSENT from the parsed
 *               settings.json.
 *   BOUNDARY:   each ordinal id tags EXACTLY ONE line (not "at least one");
 *               the cardinality line is identity-matched against the exported
 *               pure renderer applied to the fixture array lengths; the Stop
 *               registration carries NO matcher (Stop does not scope by one).
 *   ERROR:      the MCP call is asserted non-error and the CLI exit code 0 —
 *               a failed dispatch cannot masquerade as absent grammar; the
 *               settings.json flattener throws on every structural surprise
 *               rather than returning a silently-empty list.
 *   STATE:      the installed hook carries the executable bit though its repo
 *               blob does not (install transforms mode, never content); the
 *               corpus's stored SSOT array lengths equal the fixture's;
 *               installed / registered / executable are asserted as three
 *               separate states of the same file.
 *   REGRESSION: `RESUME_SCOPE_CLOSURE` is still the TRAILING block on both
 *               surfaces and is a DISTINCT string from the floor — the
 *               pre-existing upper bound was not disturbed or merged.
 *
 * @spec_ref spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 *   §Design Decisions D2, D3, D6, D7, D8, D10; §Acceptance Criteria AC-RC-4,
 *   AC-RC-8 (task task-t4-governance-rule-manifest-regeneration-fresh-install-e2e),
 *   AC-RC-13 (task task-t6-wire-the-stop-hook-into-settings-json-auto-registration).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  buildHookSettingsEntries,
  formatResumeItemId,
  HOOK_REGISTRATIONS,
  renderResumeCoverageCardinalityLine,
  RESUME_COVERAGE_FLOOR,
  RESUME_DISPOSITION_DEFERRED_PREFIX,
  RESUME_DISPOSITION_DONE,
  RESUME_DISPOSITION_MARKER,
  RESUME_ITEM_ID_PREFIX_KEY_DECISION,
  RESUME_ITEM_ID_PREFIX_NEXT_STEP,
  RESUME_SCOPE_CLOSURE,
} from "@lore/core";
import { buildManifest } from "../../../../scripts/embed-assets-manifest.mjs";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import { registerTools } from "../../src/adapters/mcp/tools.js";
import { EMBEDDED_ASSETS_MANIFEST } from "../../src/generated/assets-manifest.js";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";
import { withSessionIdentity } from "../helpers/session-actor";

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels
// up), the same derivation every sibling compiled-binary e2e suite uses.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const ASSETS_ROOT = join(REPO_ROOT, "assets");

/** The two assets this task changed — the manifest must carry a CURRENT digest for BOTH. */
const HOOK_ASSET_REL = "hooks/stop-handoff-coverage.mjs";
// RE-BASELINE (task-skill-implement-hooks-new-session-start-fragments-thin): the
// governance prose carrying the per-item disposition obligation moved from the
// retired assets/governance/corpus-workflow.md to the FEED context fragment
// (spec-context-fragments-config-driven-layered-rule-injection D9); its delivery
// surface is the project CLAUDE.md Z1 written by `lore context refresh`.
// D15 RE-BASELINE (task-skill-test-d15-red-static-fragments-as-lore-rules-files, owner
// decision 2026-10-07): that delivery surface is now the lore-owned rules file
// `.claude/rules/lore-corpus-workflow-feed.md`, NOT a CLAUDE.md Z1 section. Correction, not
// weakening: the same ACCOUNT / id-prefix / disposition-grammar assertions run against the new file.
const GOVERNANCE_ASSET_REL = "context/corpus-workflow-1-feed.md";
const HOOK_SSOT_PATH = join(ASSETS_ROOT, "hooks", "stop-handoff-coverage.mjs");
const GOVERNANCE_SSOT_PATH = join(ASSETS_ROOT, "context", "corpus-workflow-1-feed.md");

/**
 * `lore init` + `lore context init` + `lore context refresh` in a throwaway corpus; returns the text of
 * the FEED fragment's lore rules file (the fragments' D15 delivery surface), or "" when refresh did not
 * write it — so a missing D15 behaviour fails the caller's `toContain`, not this helper.
 */
function refreshedFeedRulesFile(prefix: string): string {
  const dir = makeThrowawayDir(prefix);
  initCorpus(dir);
  const ctxInit = runLore(["context", "init"], dir);
  if (ctxInit.exitCode !== 0) {
    throw new Error(`lore context init failed (exit ${ctxInit.exitCode}): ${ctxInit.stderr}`);
  }
  const refresh = runLore(["context", "refresh"], dir);
  if (refresh.exitCode !== 0) {
    throw new Error(`lore context refresh failed (exit ${refresh.exitCode}): ${refresh.stderr}`);
  }
  const rulesPath = join(dir, ".claude", "rules", "lore-corpus-workflow-feed.md");
  return existsSync(rulesPath) ? readFileSync(rulesPath, "utf8") : "";
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the COMPILED `dist/lore` with `cwd`/`HOME` both inside the throwaway corpus. `CLAUDECODE=1` resolves the "agent" caller surface (SPEC-024) so no write path risks a nested AI invocation. */
/** `actor` names the writer through the session tier (no write command takes `--by`); `null` = unnamed (OS user). */
function runLore(args: string[], cwd: string, actor: string | null = null): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, CLAUDECODE: "1" }, actor) as Record<string, string>,
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

const cleanupDirs: string[] = [];

/** Registers `dir` for `afterAll` removal and asserts it is genuinely out-of-tree (never this repo, never the real `~/.claude`). */
function trackThrowawayDir(dir: string): string {
  if (dir.startsWith(REPO_ROOT)) {
    throw new Error(`throwaway dir must be outside the repo tree, got: ${dir}`);
  }
  if (dir === join(homedir(), ".claude") || dir === homedir()) {
    throw new Error(`throwaway dir must never be the real home/claude dir, got: ${dir}`);
  }
  cleanupDirs.push(dir);
  return dir;
}

function makeThrowawayDir(prefix: string): string {
  return trackThrowawayDir(mkdtempSync(join(tmpdir(), prefix)));
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed (exit ${result.exitCode}): ${result.stderr}`);
  }
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse slug from output: ${stdout}`);
  }
  return slug;
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// ─── Handoff fixture — the SSOT both surfaces' expectations derive from ──────

/**
 * The fixture's two arrays. Every expectation below is COMPUTED from these
 * (lengths and 1-based order), never from a hand-typed id list or a remembered
 * cardinality sentence (D7) — so changing an array here changes the
 * expectations in lockstep and cannot leave a stale literal behind.
 *
 * Deliberately different lengths (3 vs 4) so a KD/NS prefix mix-up, or a
 * cardinality line that reports one array's length twice, fails.
 */
const FIXTURE_DECISIONS = ["first decision@80", "second decision@70", "third decision@60"] as const;
const FIXTURE_NEXT_STEPS = ["next one", "next two", "next three", "next four"] as const;

/** `KD1..KDn` then `NS1..NSm`, built through the exported id formatter — never `"KD" + i`. */
const EXPECTED_ITEM_IDS: readonly string[] = [
  ...FIXTURE_DECISIONS.map((_v, i) => formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, i + 1)),
  ...FIXTURE_NEXT_STEPS.map((_v, i) => formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, i + 1)),
];

/** Identity source for the cardinality line — the exported pure renderer over the fixture lengths (AC-RC-2's discipline, applied here across a process boundary). */
const EXPECTED_CARDINALITY_LINE = renderResumeCoverageCardinalityLine(
  FIXTURE_DECISIONS.length,
  FIXTURE_NEXT_STEPS.length,
);

/** `--decision`/`--next` are repeatable flags; the stored arrays are these values in this order. */
/** The handoff is written under a DISTINCT session identity from the resuming caller: the coverage floor renders for a ticket authored by someone else (SPEC-112 D10 multi-actor). */
function handoffArgs(planSlug: string): string[] {
  return [
    "handoff",
    "--plan",
    planSlug,
    ...FIXTURE_DECISIONS.flatMap((d) => ["--decision", d]),
    ...FIXTURE_NEXT_STEPS.flatMap((n) => ["--next", n]),
  ];
}

// ─── Per-surface coverage-grammar report (one builder, two independent calls) ─

interface CoverageGrammarReport {
  readonly surface: string;
  readonly hasCardinalityLine: boolean;
  readonly hasCoverageFloor: boolean;
  readonly hasScopeClosure: boolean;
  /** How many of `EXPECTED_ITEM_IDS` tag EXACTLY ONE line — a `>= 1` count would tolerate a duplicated render. */
  readonly idsTaggedExactlyOnce: number;
  /** How many fixture item texts are rendered on the SAME line as their own id — proves id↔item mapping, not just tag presence. */
  readonly idsCarryingTheirOwnItemText: number;
}

/**
 * Builds the structural coverage-grammar facts for ONE surface's text.
 *
 * Pure (no IO, no wall-clock). Returned as a record rather than asserted
 * inline so each surface gets its OWN single `toEqual` comparison whose diff
 * names the surface and the failing property — and so the same builder can be
 * run against mutilated text as a liveness control.
 */
function coverageGrammarReport(surface: string, text: string): CoverageGrammarReport {
  const lines = text.split("\n");
  const linesTaggedWith = (id: string): string[] =>
    lines.filter((line) => new RegExp(String.raw`\b${id}\b`).test(line));

  const fixtureItemTextFor = (id: string): string => {
    const kdIndex = EXPECTED_ITEM_IDS.indexOf(id);
    return kdIndex < FIXTURE_DECISIONS.length
      ? // `--decision "<judgment>[@<conf>]"`: the rendered table cell carries the judgment only.
        FIXTURE_DECISIONS[kdIndex]!.split("@")[0]!
      : FIXTURE_NEXT_STEPS[kdIndex - FIXTURE_DECISIONS.length]!;
  };

  return {
    surface,
    hasCardinalityLine: text.includes(EXPECTED_CARDINALITY_LINE),
    hasCoverageFloor: text.includes(RESUME_COVERAGE_FLOOR),
    hasScopeClosure: text.includes(RESUME_SCOPE_CLOSURE),
    idsTaggedExactlyOnce: EXPECTED_ITEM_IDS.filter((id) => linesTaggedWith(id).length === 1).length,
    idsCarryingTheirOwnItemText: EXPECTED_ITEM_IDS.filter((id) => {
      const tagged = linesTaggedWith(id);
      return tagged.length === 1 && tagged[0]!.includes(fixtureItemTextFor(id));
    }).length,
  };
}

/** The all-present expectation for a given surface label. */
function fullCoverageGrammar(surface: string): CoverageGrammarReport {
  return {
    surface,
    hasCardinalityLine: true,
    hasCoverageFloor: true,
    hasScopeClosure: true,
    idsTaggedExactlyOnce: EXPECTED_ITEM_IDS.length,
    idsCarryingTheirOwnItemText: EXPECTED_ITEM_IDS.length,
  };
}

// ─── In-process MCP surface (same shape mcp-tools-feed.test.ts uses) ────────

type McpServerInternal = {
  _registeredTools: Record<
    string,
    { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }
  >;
};

function getToolHandler(
  server: McpServer,
  name: string,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  const tool = (server as unknown as McpServerInternal)._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return (args) => tool.handler(args, {} as unknown);
}

function parseToolResult(result: CallToolResult): unknown {
  const content = result.content[0];
  if (!content || content.type !== "text") throw new Error("Expected text content");
  return JSON.parse(content.text);
}

// ─── Shared fixture lifecycle ───────────────────────────────────────────────

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

afterAll(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

// ─── AC-RC-4 — "both surfaces" ──────────────────────────────────────────────

describe("AC-RC-4: the coverage-floor grammar reaches BOTH shipping render surfaces of the compiled binary (D8, D10)", () => {
  let dir: string;
  let planSlug: string;
  let handoffSlug: string;
  let app: App;
  let server: McpServer;

  beforeAll(() => {
    dir = makeThrowawayDir("lore-t4-both-surfaces-");
    initCorpus(dir);

    const prdResult = runLore(
      ["create", "prd", "--title", "T4 Coverage Floor PRD", "--content", "root", "--no-ai"],
      dir,
    );
    expect(prdResult.exitCode).toBe(0);
    const prdSlug = parseSlug(prdResult.stdout);

    const planResult = runLore(
      ["create", "plan", "--title", "T4 Coverage Floor Plan", "--parent", prdSlug, "--content", "x", "--no-ai"],
      dir,
    );
    expect(planResult.exitCode).toBe(0);
    planSlug = parseSlug(planResult.stdout);

    const handoffResult = runLore(handoffArgs(planSlug), dir, "t4-both-surfaces");
    expect(handoffResult.exitCode).toBe(0);
    handoffSlug = parseSlug(handoffResult.stdout);

    // A REAL SQLiteStore-backed App over the SAME on-disk db the compiled CLI
    // just wrote to — never InMemoryStore — so the two surfaces below read
    // genuinely shared state rather than two independently-seeded fixtures
    // that happen to agree (context-provenance-compiled.bun.test.ts precedent).
    app = createApp(join(dir, ".lore", "lore.db"));
    server = new McpServer({ name: "t4-resume-coverage", version: "0.0.0" });
    registerTools(server, app);
  });

  afterAll(() => {
    app.close();
  });

  it("both surfaces — compiled CLI stdout and the MCP lore_feed response EACH independently carry the ordinal tags, the cardinality line, and RESUME_COVERAGE_FLOOR", async () => {
    // ── Surface 1: the compiled binary's CLI stdout ──────────────────────────
    const cliResult = runLore(["feed", "session-resume", "--plan", planSlug], dir);
    // ERROR dimension: a failed dispatch must not read as "grammar absent".
    expect(cliResult.exitCode).toBe(0);
    expect(cliResult.stdout.length).toBeGreaterThan(0);

    const cliSurface = "compiled CLI stdout";
    expect(coverageGrammarReport(cliSurface, cliResult.stdout)).toEqual(
      fullCoverageGrammar(cliSurface),
    );

    // ── Surface 2: the MCP `lore_feed` response ─────────────────────────────
    // Obtained through a wholly separate code path (tool handler -> textContent
    // -> JSON payload). Its own assertion below is INDEPENDENT of surface 1's:
    // if this surface regressed while the CLI kept working, this comparison
    // fails on its own — the CLI-only blind spot SPEC-CP D3 measured.
    const callFeed = getToolHandler(server, "lore_feed");
    const mcpResult = await callFeed({ checkpoint: "session-resume", plan: planSlug });
    expect(mcpResult.isError).toBeFalsy();

    const outcome = parseToolResult(mcpResult) as { feed?: unknown };
    expect(typeof outcome.feed).toBe("string");
    const mcpFeed = outcome.feed as string;
    expect(mcpFeed.length).toBeGreaterThan(0);

    const mcpSurface = "MCP lore_feed response";
    expect(coverageGrammarReport(mcpSurface, mcpFeed)).toEqual(fullCoverageGrammar(mcpSurface));

    // ── NEGATIVE / liveness control (D7) ────────────────────────────────────
    // The report builder must DISCRIMINATE. Run it over three mutilations of
    // the same CLI text and assert each corresponding property flips to false
    // — otherwise both surface comparisons above could be passing through a
    // builder that answers true unconditionally.
    const floorRemoved = cliResult.stdout.split(RESUME_COVERAGE_FLOOR).join("");
    expect(coverageGrammarReport("control", floorRemoved).hasCoverageFloor).toBe(false);

    const cardinalityAltered = cliResult.stdout
      .split(EXPECTED_CARDINALITY_LINE)
      .join(renderResumeCoverageCardinalityLine(FIXTURE_DECISIONS.length + 1, FIXTURE_NEXT_STEPS.length));
    expect(coverageGrammarReport("control", cardinalityAltered).hasCardinalityLine).toBe(false);

    // Strip every ordinal tag (the id text only — the floor's own literal
    // `KD<n>`/`NS<n>` mention is untouched, and must not be mistaken for a tag).
    const ordinalsStripped = EXPECTED_ITEM_IDS.reduce(
      (acc, id) => acc.split(id).join("XX"),
      cliResult.stdout,
    );
    expect(coverageGrammarReport("control", ordinalsStripped).idsTaggedExactlyOnce).toBe(0);
    expect(coverageGrammarReport("control", ordinalsStripped).idsCarryingTheirOwnItemText).toBe(0);

    // Sanity: the fixture is non-degenerate, so "0 of 0 ids covered" cannot
    // masquerade as full coverage in either surface comparison above.
    expect(EXPECTED_ITEM_IDS.length).toBe(FIXTURE_DECISIONS.length + FIXTURE_NEXT_STEPS.length);
    expect(EXPECTED_ITEM_IDS.length).toBeGreaterThan(0);
  });

  it("BOUNDARY: the cardinality line is identity-equal to the exported renderer over the STORED SSOT array lengths, and both surfaces agree on it", async () => {
    // STATE: the corpus's stored arrays — not the fixture literals — are what
    // the render path reads. Reading them back closes the gap between "the
    // ticket is internally consistent" and "the ticket matches the record".
    const getResult = runLore(["get", handoffSlug, "--json"], dir);
    expect(getResult.exitCode).toBe(0);
    const parsed = JSON.parse(getResult.stdout) as {
      data: { doc: { extra: { handoff: { key_decisions: unknown[]; next_steps: unknown[] } } } };
    };
    const stored = parsed.data.doc.extra.handoff;
    expect(stored.key_decisions.length).toBe(FIXTURE_DECISIONS.length);
    expect(stored.next_steps.length).toBe(FIXTURE_NEXT_STEPS.length);

    const storedCardinalityLine = renderResumeCoverageCardinalityLine(
      stored.key_decisions.length,
      stored.next_steps.length,
    );
    expect(storedCardinalityLine).toBe(EXPECTED_CARDINALITY_LINE);

    const cliResult = runLore(["feed", "session-resume", "--plan", planSlug], dir);
    expect(cliResult.stdout).toContain(storedCardinalityLine);

    const callFeed = getToolHandler(server, "lore_feed");
    const mcpResult = await callFeed({ checkpoint: "session-resume", plan: planSlug });
    const mcpFeed = (parseToolResult(mcpResult) as { feed: string }).feed;
    expect(mcpFeed).toContain(storedCardinalityLine);
  });

  it("REGRESSION: the pre-existing upper bound is undisturbed — RESUME_SCOPE_CLOSURE is still the TRAILING block on both surfaces and is a DISTINCT string from the floor", async () => {
    // D3: the two constants must never collapse into one string.
    expect(RESUME_COVERAGE_FLOOR).not.toBe(RESUME_SCOPE_CLOSURE);
    expect(RESUME_SCOPE_CLOSURE).not.toContain(RESUME_COVERAGE_FLOOR);
    expect(RESUME_COVERAGE_FLOOR).not.toContain(RESUME_SCOPE_CLOSURE);

    const cliResult = runLore(["feed", "session-resume", "--plan", planSlug], dir);
    expect(cliResult.stdout.trimEnd().endsWith(RESUME_SCOPE_CLOSURE)).toBe(true);
    // The floor is appended BEFORE the closure (feed-flow.ts's stated invariant).
    expect(cliResult.stdout.indexOf(RESUME_COVERAGE_FLOOR)).toBeLessThan(
      cliResult.stdout.indexOf(RESUME_SCOPE_CLOSURE),
    );

    const callFeed = getToolHandler(server, "lore_feed");
    const mcpResult = await callFeed({ checkpoint: "session-resume", plan: planSlug });
    const mcpFeed = (parseToolResult(mcpResult) as { feed: string }).feed;
    expect(mcpFeed.trimEnd().endsWith(RESUME_SCOPE_CLOSURE)).toBe(true);
    expect(mcpFeed.indexOf(RESUME_COVERAGE_FLOOR)).toBeLessThan(mcpFeed.indexOf(RESUME_SCOPE_CLOSURE));
  });
});

// ─── AC-RC-8 — "install parity" ─────────────────────────────────────────────

describe("AC-RC-8: both changed assets actually SHIP — installed hook bytes + embedded manifest digests (spec §Delivery constraint)", () => {
  it("install parity — the new Stop hook installs byte-identical from a throwaway claude-dir, and the embedded manifest sha256 for BOTH changed assets equals the on-disk digest", () => {
    // ── (a) Embedded manifest digests, per changed asset ────────────────────
    // The manifest stores a digest, not content, so this is the strongest
    // available byte-comparison against the EMBEDDED manifest — and it is
    // asserted for BOTH changed paths, so regenerating for only one fails.
    const hookSsotBytes = readFileSync(HOOK_SSOT_PATH);
    const governanceSsotBytes = readFileSync(GOVERNANCE_SSOT_PATH);
    expect(hookSsotBytes.length).toBeGreaterThan(0);
    expect(governanceSsotBytes.length).toBeGreaterThan(0);
    expect(HOOK_ASSET_REL).not.toBe(GOVERNANCE_ASSET_REL);

    const entryFor = (relPath: string) =>
      EMBEDDED_ASSETS_MANIFEST.entries.find((e) => e.path === relPath);

    const hookEntry = entryFor(HOOK_ASSET_REL);
    const governanceEntry = entryFor(GOVERNANCE_ASSET_REL);
    // Fail LOUD with the repair command rather than degrading to optional-chained
    // `undefined === undefined` comparisons, which would pass vacuously for an
    // asset missing from the manifest entirely — the exact regression this AC
    // exists to catch.
    if (hookEntry === undefined || governanceEntry === undefined) {
      throw new Error(
        `embedded assets manifest is missing an entry for "${HOOK_ASSET_REL}" and/or ` +
          `"${GOVERNANCE_ASSET_REL}" — regenerate with: bun scripts/embed-assets-manifest.mjs`,
      );
    }
    expect(hookEntry.sha256).toBe(sha256OfFile(HOOK_SSOT_PATH));
    expect(governanceEntry.sha256).toBe(sha256OfFile(GOVERNANCE_SSOT_PATH));
    // The new hook must be classified as a hook — that is what earns it the
    // executable bit at install time (asserted in the STATE test below).
    expect(hookEntry.kind).toBe("hook");

    // Liveness control for (a): the digest comparison must discriminate. A
    // wrong-file digest must NOT satisfy either entry.
    expect(hookEntry.sha256).not.toBe(sha256OfFile(GOVERNANCE_SSOT_PATH));
    expect(governanceEntry.sha256).not.toBe(sha256OfFile(HOOK_SSOT_PATH));

    // Whole-tree liveness control: `assertFreshBinary` only compares `.ts`
    // mtimes, so an `assets/` edit made after the last build is invisible to
    // it. Recomputing the manifest from the CURRENT tree and comparing the
    // tree digest catches exactly that ("asset edited, manifest not
    // regenerated") — the failure this AC exists to prevent.
    const recomputed = buildManifest(ASSETS_ROOT, REPO_ROOT);
    expect(recomputed.tree_digest).toBe(EMBEDDED_ASSETS_MANIFEST.tree_digest);
    expect(recomputed.entries.length).toBe(EMBEDDED_ASSETS_MANIFEST.entries.length);

    // ── (b) Distribution, not storage: run setup into a THROWAWAY dir ───────
    // ⛔ `--claude-dir` is mandatory here (see this file's header): a bare
    // `lore setup` resolves removals through `~/.claude/`'s dev symlinks and
    // deletes this repo's own assets/ SSOT.
    const scratch = makeThrowawayDir("lore-t4-setup-");
    const targetDir = join(scratch, ".claude");
    expect(targetDir.startsWith(REPO_ROOT)).toBe(false);
    expect(targetDir).not.toBe(join(homedir(), ".claude"));
    // A virgin target — nothing pre-existing could be mistaken for an install.
    expect(existsSync(targetDir)).toBe(false);

    // `PATH: ""` forces `claude` ENOENT deterministically (MCP registration
    // fails), so this never touches the dev machine's real `claude` CLI;
    // asset files still write (setup.test.ts's established convention).
    const setupResult = Bun.spawnSync([LORE_BIN, "setup", "--claude-dir", targetDir, "--yes"], {
      cwd: scratch,
      env: { ...process.env, HOME: scratch, PATH: "" },
    });
    expect(setupResult.stdout.toString()).toContain("lore setup complete");

    const installedHookPath = join(targetDir, "hooks", "stop-handoff-coverage.mjs");
    expect(existsSync(installedHookPath)).toBe(true);
    const installedHookBytes = readFileSync(installedHookPath);
    expect(installedHookBytes.equals(hookSsotBytes)).toBe(true);

    // ── (c) The edited FEED fragment's own distribution oracle ──────────────
    // RE-BASELINE: the original (c) asserted `governance/corpus-workflow.md`
    // absent from the install dir and byte-equal to `lore governance` stdout;
    // that file and topic are retired (ENOENT on readFileSync, D9), which is why
    // the assertion went red. Correction, not weakening: the retired file stays
    // asserted ABSENT, the verb is asserted to REFUSE the retired topic, and the
    // byte-level delivery claim is re-pinned on the new surface — the FEED
    // fragment's text (minus frontmatter) must appear in the project .claude/rules/lore-corpus-workflow-feed.md (D15).
    expect(existsSync(join(targetDir, "governance", "corpus-workflow.md"))).toBe(false);

    const governanceVerb = Bun.spawnSync([LORE_BIN, "governance"], { cwd: REPO_ROOT });
    expect(governanceVerb.exitCode).not.toBe(0);
    expect(governanceVerb.stderr.toString()).toContain("retired");

    const fragmentBody = governanceSsotBytes.toString("utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
    const rules = refreshedFeedRulesFile("lore-t4-rules-");
    expect(rules).toContain(fragmentBody.split("\n").find((l) => l.includes("ACCOUNT, not to complete"))?.trim() ?? "<<no ACCOUNT line in fragment>>");

    // ── (d) NEGATIVE / liveness control for the byte comparison ─────────────
    // Perturb the INSTALLED copy and prove the comparison flips — a
    // `Buffer.equals` over two accidentally-identical reads (e.g. both empty)
    // would otherwise pass silently.
    appendFileSync(installedHookPath, "// t4 liveness probe\n");
    expect(readFileSync(installedHookPath).equals(hookSsotBytes)).toBe(false);
    // The SSOT is untouched by the probe — the perturbation stayed in the
    // throwaway install dir.
    expect(readFileSync(HOOK_SSOT_PATH).equals(hookSsotBytes)).toBe(true);
    expect(sha256OfFile(HOOK_SSOT_PATH)).toBe(hookEntry.sha256);
  });

  it("STATE: the installed hook carries the executable bit although its assets/ blob does not — install transforms MODE, never CONTENT", () => {
    const scratch = makeThrowawayDir("lore-t4-setup-mode-");
    const targetDir = join(scratch, ".claude");
    expect(targetDir.startsWith(REPO_ROOT)).toBe(false);

    const setupResult = Bun.spawnSync([LORE_BIN, "setup", "--claude-dir", targetDir, "--yes"], {
      cwd: scratch,
      env: { ...process.env, HOME: scratch, PATH: "" },
    });
    expect(setupResult.stdout.toString()).toContain("lore setup complete");

    const installedHookPath = join(targetDir, "hooks", "stop-handoff-coverage.mjs");
    expect(existsSync(installedHookPath)).toBe(true);

    // Load-bearing half: a hook that ships non-executable never runs.
    expect(statSync(installedHookPath).mode & 0o100).not.toBe(0);
    // Content is unchanged by that mode transform.
    expect(readFileSync(installedHookPath).equals(readFileSync(HOOK_SSOT_PATH))).toBe(true);
  });

  it("BOUNDARY: the FEED fragment carries the per-item disposition obligation, keyed on the exported grammar constants rather than remembered prose", () => {
    // D7: the FEED rule must name the id prefixes and the disposition tokens a
    // consumer has to write — asserted through the exported constants, so a
    // constant rename cannot leave the prose silently stale.
    // RE-BASELINE: originally sliced `## FEED`..`## PRODUCE` out of the retired
    // assets/governance/corpus-workflow.md and cross-checked `lore governance`
    // stdout (ENOENT after D9). Same constants, now asserted against the whole
    // FEED fragment file AND the project lore rules file it ships through (D15).
    const feedSection = readFileSync(GOVERNANCE_SSOT_PATH, "utf8");
    expect(feedSection.length).toBeGreaterThan(0);

    const rules = refreshedFeedRulesFile("lore-t4-boundary-rules-");
    expect(rules.length).toBeGreaterThan(0); // D15: refresh must have written the rules file
    for (const surface of [feedSection, rules]) {
      for (const prefix of [RESUME_ITEM_ID_PREFIX_KEY_DECISION, RESUME_ITEM_ID_PREFIX_NEXT_STEP]) {
        expect(surface).toContain(`\`${prefix}<n>\``);
      }

      // Both accepted dispositions, composed from the exported grammar the verb
      // parses — so a consumer following this prose emits what the verb accepts.
      expect(surface).toContain(`${RESUME_DISPOSITION_MARKER} <item-id>: ${RESUME_DISPOSITION_DONE}`);
      expect(surface).toContain(
        `${RESUME_DISPOSITION_MARKER} <item-id>: ${RESUME_DISPOSITION_DEFERRED_PREFIX}<reason>`,
      );
      // The obligation is ACCOUNTING, not completion (D5) — pinned as a token so
      // a future rewrite cannot quietly turn it into a completion demand.
      expect(surface).toContain("ACCOUNT, not to complete");
    }
  });
});

// ─── AC-RC-13 — "stop hook registered" ──────────────────────────────────────

/**
 * Basename of the new hook asset, sliced from the same `HOOK_ASSET_REL` that
 * AC-RC-8 installs and digests above — ONE naming site for the file, so an
 * asset rename propagates into this AC's expectation instead of leaving a
 * stale literal that still passes.
 */
const HOOK_ASSET_BASENAME = HOOK_ASSET_REL.slice(HOOK_ASSET_REL.lastIndexOf("/") + 1);

/**
 * The already-registered Stop hook this AC uses as its vacuous-pass CONTROL.
 * If the positive half were asserted against an unparsed, empty, or hook-less
 * `settings.json`, this assertion fails too — so "positive green" is only
 * believable while the control is green, and a broken parse cannot masquerade
 * as a missing registration (or vice versa).
 */
const CONTROL_STOP_HOOK_BASENAME = "stop-doc-sync.mjs";

/** One flattened `hooks[event][].hooks[]` command, in `SettingsHookEntry` shape. */
interface FlatSettingsHook {
  readonly event: string;
  readonly matcher?: string;
  readonly command: string;
}

/**
 * Flattens an on-disk `settings.json`'s nested `hooks[event][] → hooks[]`
 * structure into the flat `{event, matcher?, command}` shape
 * `buildHookSettingsEntries` returns, so the installed file and the registry
 * SSOT are directly comparable by deep equality (never by substring).
 *
 * Fail-LOUD on every structural surprise instead of skipping it: a silently
 * empty result is indistinguishable from "the registration is missing", which
 * is the precise failure this AC exists to catch.
 */
function flattenSettingsHooks(settingsJsonText: string): FlatSettingsHook[] {
  const parsed: unknown = JSON.parse(settingsJsonText);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`settings.json did not parse to an object: ${settingsJsonText.slice(0, 200)}`);
  }
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (typeof hooks !== "object" || hooks === null) {
    throw new Error('settings.json carries no "hooks" object — nothing was registered at all');
  }
  const flat: FlatSettingsHook[] = [];
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) {
      throw new Error(`settings.json hooks.${event} is not an array of matcher-groups`);
    }
    for (const group of groups) {
      const matcher = (group as { matcher?: unknown }).matcher;
      const groupHooks = (group as { hooks?: unknown }).hooks;
      if (!Array.isArray(groupHooks)) {
        throw new Error(`settings.json hooks.${event}[].hooks is not an array`);
      }
      for (const entry of groupHooks) {
        const command = (entry as { command?: unknown }).command;
        if (typeof command !== "string") {
          throw new Error(`settings.json hooks.${event}[].hooks[].command is not a string`);
        }
        // Omit the key entirely when absent — never `matcher: undefined` — so
        // deep equality against `buildHookSettingsEntries`' output is exact.
        flat.push(matcher === undefined ? { event, command } : { event, matcher: String(matcher), command });
      }
    }
  }
  return flat;
}

describe("AC-RC-13: the shipped Stop hook is WIRED, not merely copied — settings.json auto-registration on a fresh install (spec §Delivery constraint, D6)", () => {
  it("stop hook registered — the fresh install's settings.json carries the Stop entry DERIVED from HOOK_REGISTRATIONS, with the pre-existing stop-doc-sync entry as the vacuous-pass control", () => {
    // ── (a) The registry SSOT declares it, as a matcher-less Stop hook ───────
    // Registry membership is asserted FIRST and separately: T4 already proved
    // the file installs byte-identically, so an installed-but-unregistered
    // hook is silently inert — the exact state this AC was written against.
    const registration = HOOK_REGISTRATIONS.find((r) => r.file === HOOK_ASSET_BASENAME);
    if (registration === undefined) {
      throw new Error(
        `HOOK_REGISTRATIONS does not declare "${HOOK_ASSET_BASENAME}" — the hook installs under ` +
          "<claude-dir>/hooks/ but no settings.json Stop entry ever invokes it, so it never fires. " +
          `Declare it in packages/core/src/distribution-hooks.ts as ` +
          `{ file: "${HOOK_ASSET_BASENAME}", runner: "node", event: "Stop" }.`,
      );
    }
    expect(registration.event).toBe("Stop");
    // Stop does not scope by matcher (mirrors the `stop-doc-sync.mjs` row) — a
    // matcher here would narrow the hook to a tool name Stop never carries.
    expect(registration.matcher).toBeUndefined();

    // ── (b) Both expected entries DERIVED from the registry, never typed ─────
    const scratch = makeThrowawayDir("lore-t6-settings-");
    const targetDir = join(scratch, ".claude");
    // ⛔ `--claude-dir` is mandatory (see this file's header): a bare
    // `lore setup` resolves removals through `~/.claude/`'s dev symlinks and
    // deletes this repo's own assets/ SSOT. Asserted BEFORE invoking setup.
    expect(targetDir.startsWith(REPO_ROOT)).toBe(false);
    expect(targetDir).not.toBe(join(homedir(), ".claude"));
    expect(existsSync(targetDir)).toBe(false);

    const derivedEntries = buildHookSettingsEntries(targetDir);
    const expectedEntry = derivedEntries.find((e) => e.command.endsWith(`/hooks/${HOOK_ASSET_BASENAME}`));
    const expectedControlEntry = derivedEntries.find((e) =>
      e.command.endsWith(`/hooks/${CONTROL_STOP_HOOK_BASENAME}`),
    );
    if (expectedEntry === undefined || expectedControlEntry === undefined) {
      throw new Error(
        `buildHookSettingsEntries produced no entry for "${HOOK_ASSET_BASENAME}" and/or the ` +
          `"${CONTROL_STOP_HOOK_BASENAME}" control — the registry and the builder disagree.`,
      );
    }

    // ── (c) Fresh install into the throwaway claude-dir ─────────────────────
    // `PATH: ""` forces `claude` ENOENT deterministically (MCP registration
    // fails, so the run's exit code is non-zero and deliberately NOT asserted)
    // while every asset and the settings merge still write — setup.test.ts's
    // established convention, matching the install-parity test above.
    const setupResult = Bun.spawnSync([LORE_BIN, "setup", "--claude-dir", targetDir, "--yes"], {
      cwd: scratch,
      env: { ...process.env, HOME: scratch, PATH: "" },
    });
    expect(setupResult.stdout.toString()).toContain("lore setup complete");

    const settingsPath = join(targetDir, "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const flatHooks = flattenSettingsHooks(readFileSync(settingsPath, "utf8"));

    // ── (d) The control FIRST, then the positive, over the SAME parsed file ──
    // Order is deliberate: the incumbent `stop-doc-sync` entry proves the
    // parse+containment machinery finds a Stop registration that IS present,
    // so when the positive below fails the diagnosis is unambiguous ("this
    // hook is unregistered", never "the flattener is broken"). Measured under
    // a binary built without the new registration: control green, positive red.
    expect(flatHooks).toContainEqual(expectedControlEntry);
    expect(flatHooks).toContainEqual(expectedEntry);
    // The two must be DISTINCT entries — a control that collapsed onto the
    // positive would make the pairing decorative.
    expect(expectedEntry).not.toEqual(expectedControlEntry);

    // ── (e) Liveness controls for the containment comparison ────────────────
    // A flattener that answered "everything", or a comparison that degraded to
    // a substring/prefix match, must NOT accept a command this build never
    // registers, nor the right command under the wrong event.
    expect(flatHooks).not.toContainEqual({
      ...expectedEntry,
      command: `${expectedEntry.command}.never-registered`,
    });
    expect(flatHooks).not.toContainEqual({ ...expectedEntry, event: `${expectedEntry.event}Absent` });

    // ── (f) The registration is not DANGLING — its target really installed ──
    // `command` is always `"<runner> <claudeDir>/hooks/<file>"`; the throwaway
    // mkdtemp path never contains a space, so the first space splits it.
    const registeredHookPath = expectedEntry.command.slice(expectedEntry.command.indexOf(" ") + 1);
    expect(registeredHookPath).toBe(join(targetDir, "hooks", HOOK_ASSET_BASENAME));
    expect(existsSync(registeredHookPath)).toBe(true);
    // Installed AND registered AND executable are three different states; this
    // AC exists because the first held while the second did not.
    expect(statSync(registeredHookPath).mode & 0o100).not.toBe(0);
  });
});

// ─── AC-RCH-7 — "the consumer-visible compiled path" ────────────────────────

/**
 * Ceiling on output captured from the hook. Set to the SAME 16 MiB the hook
 * itself relays with, deliberately: `spawnSync`'s 1 MiB default truncates
 * SILENTLY, so a smaller ceiling here would make THIS harness the truncation
 * point and turn a long block reason into a phantom parse failure. Node's
 * `spawnSync` is used for these runs (rather than `Bun.spawnSync`, as
 * `runLore` above does) precisely because it takes this ceiling as an explicit
 * argument.
 */
const HOOK_CAPTURE_BYTE_CEILING = 16 * 1024 * 1024;

/** Matches one ordinal item id as a whole token — never as a substring of a longer id. */
function wordBounded(id: string): RegExp {
  return new RegExp(String.raw`\b${id}\b`);
}

/**
 * Which of the fixture's ordinal ids `text` names, in `EXPECTED_ITEM_IDS`
 * order. Returned as a SET-comparable list so every assertion below can demand
 * exact equality with an expected id set — "contains the missing ids" would
 * also pass for a verdict that named all seven every time.
 */
function idsNamedIn(text: string): string[] {
  return EXPECTED_ITEM_IDS.filter((id) => wordBounded(id).test(text));
}

/** One captured hook run. `exitCode` is the status the hook relayed or exited with. */
interface HookRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** The two fields a Stop-hook block decision is read from, after parsing. */
interface StopDecision {
  readonly decision: string;
  readonly reason: string;
}

/**
 * Parses `stdout` as the Stop contract's decision object, failing LOUD with the
 * raw bytes on any surprise.
 *
 * `JSON.parse` over the WHOLE stdout is the assertion that it is ONE object:
 * a trailing log line, a second object, or a human sentence prepended to it all
 * raise here rather than being silently tolerated by a lenient scan.
 */
function parseStopDecision(stdout: string, label: string): StopDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    throw new Error(
      `${label}: stdout did not parse as one JSON object (${String(cause)}); raw bytes: ${JSON.stringify(stdout)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label}: stdout parsed to a non-object: ${JSON.stringify(parsed)}`);
  }
  const { decision, reason } = parsed as { decision?: unknown; reason?: unknown };
  if (typeof decision !== "string") {
    throw new Error(`${label}: parsed stdout carries no string "decision": ${JSON.stringify(parsed)}`);
  }
  if (typeof reason !== "string") {
    throw new Error(`${label}: parsed stdout carries no string "reason": ${JSON.stringify(parsed)}`);
  }
  return { decision, reason };
}

/**
 * The consumer-visible compiled path, end to end: the REAL unmodified
 * `assets/hooks/stop-handoff-coverage.mjs`, spawned with the runner
 * `HOOK_REGISTRATIONS` declares for it, over a `PATH` on which the ONLY
 * reachable `lore` is this worktree's freshly built `dist/lore`, fed a Stop
 * payload on stdin.
 *
 * Why this cannot be replaced by the in-process verb tests: the spec's delivery
 * claim (§Delivery surface) is that a consumer who ran `lore init` + `lore
 * setup` at ANY earlier version gets this fix by upgrading the binary alone —
 * no hook reinstall, no assets-manifest regeneration. That claim is only
 * measurable across the process boundary the hook actually crosses, with the
 * hook file at the byte content it already shipped.
 *
 * ## The vacuity problem this block is built around
 *
 * The AC's second half — "complete accounting yields exit 0 with EMPTY stdout"
 * — is the dangerous one, because exit-0-and-silent is ALSO what this same hook
 * produces when
 *   (a) `lore` never resolved on the constructed `PATH` (spawn error),
 *   (b) the payload carried `stop_hook_active: true` (loop-prevention
 *       short-circuit, which spawns nothing at all), or
 *   (c) the transcript never armed the floor.
 * A green "complete accounting" half therefore proves nothing on its own. Each
 * alternative cause is closed by its own control below: (a) by the absent-`lore`
 * ERROR test, which asserts a fault is DISTINGUISHABLE from a clean verdict;
 * (b) by the STATE test, which drives the short-circuit deliberately and pins
 * that the verdict fixtures do not sit on it; (c) by the arming-provenance test
 * plus the fact that the SAME transcript blocks when the accounting is
 * incomplete.
 *
 * ## Where the disposition grammar comes from
 *
 * Nowhere in this file is a disposition line hand-typed. The "complete
 * accounting" message is built from the lines the BINARY ITSELF emitted in a
 * prior block reason (H3: each such line, fed back through the verb's own
 * parser, must be recognised as dispositioning exactly its own id). So this
 * block also measures H3's round-trip property across the compiled boundary,
 * and it cannot degrade the way a remembered contiguous phrase does — a wrong
 * literal here fails loudly at fixture-derivation time instead of quietly
 * becoming "no dispositions found".
 *
 * @spec_ref spec-resume-ticket-coverage-floor-blocking-channel-arming
 *   §Design Decisions H1, H2, H3, H4, H6; AC-RCH-7
 *   (task task-t3-compiled-consumer-path-oracle).
 */
describe("AC-RCH-7: the consumer-visible compiled path — the real unmodified Stop hook over a freshly built dist/lore (H1, H2, H4)", () => {
  /** Throwaway corpus; also the `cwd`/`HOME` every hook run gets, mirroring a consumer session inside its own project. */
  let corpusDir: string;
  /** Holds exactly one entry: `lore` -> this worktree's `dist/lore`. */
  let shimPath: string;
  /** `PATH` value for a hook run: the shim dir ALONE, so a globally installed `lore` cannot be what answers. */
  let shimOnlyPath: string;
  /** An empty dir used as a `PATH` on which no `lore` exists at all. */
  let loreLessPath: string;
  /** Absolute path to the interpreter `HOOK_REGISTRATIONS` declares for this hook. */
  let hookRunnerBin: string;
  /** Transcript in which the ticket text WAS produced by a `lore feed session-resume` call — the armed fixture. */
  let armedTranscript: string;
  /** The real ticket text the compiled binary rendered, carried verbatim in every transcript below. */
  let ticketText: string;
  /** Canonical disposition line per item id, harvested from the binary's OWN block reason. */
  let canonicalDispositionLine: ReadonlyMap<string, string>;

  let transcriptSeq = 0;
  let toolUseSeq = 0;

  const nextToolUseId = (): string => {
    toolUseSeq += 1;
    return `toolu_rch7${String(toolUseSeq).padStart(18, "0")}`;
  };

  /** A `Bash` tool_use entry, in the shape a real transcript stores (measured against a live `~/.claude/projects/*.jsonl`). */
  const bashToolUseEntry = (toolUseId: string, command: string): unknown => ({
    parentUuid: null,
    isSidechain: false,
    type: "assistant",
    uuid: `uuid-rch7-use-${toolUseId}`,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      type: "message",
      content: [{ type: "tool_use", id: toolUseId, name: "Bash", input: { command, description: "fixture" } }],
    },
  });

  /** An MCP-shaped tool_use entry (`lore_feed` with a checkpoint argument). */
  const mcpFeedToolUseEntry = (toolUseId: string, checkpoint: string): unknown => ({
    parentUuid: null,
    isSidechain: false,
    type: "assistant",
    uuid: `uuid-rch7-use-${toolUseId}`,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      type: "message",
      content: [{ type: "tool_use", id: toolUseId, name: "mcp__lore__lore_feed", input: { checkpoint } }],
    },
  });

  /** The paired tool_result entry — `content` as a plain string, which is what a real Bash result stores. */
  const toolResultEntry = (toolUseId: string, resultText: string): unknown => ({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    uuid: `uuid-rch7-res-${toolUseId}`,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ tool_use_id: toolUseId, type: "tool_result", content: resultText, is_error: false }],
    },
  });

  /** Writes one JSONL transcript into the throwaway tree and returns its path. */
  const writeTranscript = (entries: readonly unknown[]): string => {
    transcriptSeq += 1;
    const path = join(corpusDir, `transcript-rch7-${transcriptSeq}.jsonl`);
    writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    return path;
  };

  /**
   * A transcript whose ticket text is carried by a tool_result paired — by
   * `tool_use_id` — with `toolUse`. Passing `null` produces the UNPAIRED case:
   * the ticket text is present but no originating call exists at all.
   */
  const transcriptCarryingTicket = (toolUse: ((id: string) => unknown) | null): string => {
    const id = nextToolUseId();
    const entries: unknown[] = [];
    if (toolUse !== null) entries.push(toolUse(id));
    entries.push(toolResultEntry(id, ticketText));
    return writeTranscript(entries);
  };

  /** A realistic Stop payload. Extra keys are included because real consumers send them and the hook must drop all but two. */
  const stopPayload = (
    transcriptPath: string,
    lastAssistantMessage: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    session_id: "rch7-consumer-path",
    transcript_path: transcriptPath,
    cwd: corpusDir,
    hook_event_name: "Stop",
    stop_hook_active: false,
    last_assistant_message: lastAssistantMessage,
    ...overrides,
  });

  /** Spawns the real hook asset. Never discards stderr; fails loud if the interpreter itself could not start. */
  const runHook = (payload: unknown, pathValue: string = shimOnlyPath): HookRun => {
    const proc = spawnSync(hookRunnerBin, [HOOK_SSOT_PATH], {
      input: JSON.stringify(payload),
      cwd: corpusDir,
      encoding: "utf8",
      maxBuffer: HOOK_CAPTURE_BYTE_CEILING,
      env: { ...process.env, PATH: pathValue, HOME: corpusDir, CLAUDECODE: "1" },
    });
    if (proc.error) {
      throw new Error(`could not spawn \`${hookRunnerBin} ${HOOK_SSOT_PATH}\`: ${String(proc.error)}`);
    }
    if (typeof proc.status !== "number") {
      throw new Error(
        `the hook yielded no exit status (signal ${String(proc.signal)}); stderr: ${proc.stderr}`,
      );
    }
    return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.status };
  };

  /** Runs the verb DIRECTLY on the same freshly built binary, with the two fields the hook forwards. */
  const runVerbDirect = (transcriptPath: string, lastAssistantMessage: string): HookRun => {
    const proc = spawnSync(LORE_BIN, ["handoff", "coverage-check"], {
      input: JSON.stringify({
        transcript_path: transcriptPath,
        last_assistant_message: lastAssistantMessage,
      }),
      cwd: corpusDir,
      encoding: "utf8",
      maxBuffer: HOOK_CAPTURE_BYTE_CEILING,
      env: { ...process.env, HOME: corpusDir, CLAUDECODE: "1" },
    });
    if (proc.error) throw new Error(`could not spawn ${LORE_BIN}: ${String(proc.error)}`);
    if (typeof proc.status !== "number") {
      throw new Error(`the verb yielded no exit status (signal ${String(proc.signal)}); stderr: ${proc.stderr}`);
    }
    return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.status };
  };

  /** The accounting message for `ids`, assembled from lines the BINARY emitted — never hand-typed. */
  const accountingFor = (ids: readonly string[]): string =>
    ids
      .map((id) => {
        const line = canonicalDispositionLine.get(id);
        if (line === undefined) throw new Error(`no canonical disposition line harvested for ${id}`);
        return line;
      })
      .join("\n");

  beforeAll(() => {
    // ── The interpreter the shipped registration actually uses ───────────────
    // Derived, never hardcoded: if the registry ever moves this hook to another
    // runner, this run follows it instead of silently testing the old one.
    const registration = HOOK_REGISTRATIONS.find(
      (r) => r.file === HOOK_ASSET_BASENAME && r.event === "Stop",
    );
    if (registration === undefined) {
      throw new Error(`HOOK_REGISTRATIONS declares no Stop entry for "${HOOK_ASSET_BASENAME}"`);
    }
    const resolvedRunner = Bun.which(registration.runner);
    if (resolvedRunner === null) {
      throw new Error(
        `the runner "${registration.runner}" that HOOK_REGISTRATIONS declares for ${HOOK_ASSET_BASENAME} is not on PATH — a consumer's Stop hook could not run either`,
      );
    }
    hookRunnerBin = resolvedRunner;

    // ── A real ticket, rendered by the compiled binary ──────────────────────
    corpusDir = makeThrowawayDir("lore-rch7-consumer-path-");
    initCorpus(corpusDir);

    const prdResult = runLore(
      ["create", "prd", "--title", "RCH7 Consumer Path PRD", "--content", "root", "--no-ai"],
      corpusDir,
    );
    expect(prdResult.exitCode).toBe(0);
    const planResult = runLore(
      [
        "create",
        "plan",
        "--title",
        "RCH7 Consumer Path Plan",
        "--parent",
        parseSlug(prdResult.stdout),
        "--content",
        "x",
        "--no-ai",
      ],
      corpusDir,
    );
    expect(planResult.exitCode).toBe(0);
    const planSlug = parseSlug(planResult.stdout);
    expect(runLore(handoffArgs(planSlug), corpusDir, "rch7-consumer-path").exitCode).toBe(0);

    const feedResult = runLore(["feed", "session-resume", "--plan", planSlug], corpusDir);
    expect(feedResult.exitCode).toBe(0);
    ticketText = feedResult.stdout;

    // The fixture is a REAL ticket, not a hand-assembled lookalike: assert the
    // full coverage grammar before anything downstream depends on it, so a
    // render regression surfaces here rather than as "nothing ever arms".
    expect(coverageGrammarReport("rch7 ticket fixture", ticketText)).toEqual(
      fullCoverageGrammar("rch7 ticket fixture"),
    );

    // ── A PATH on which the ONLY `lore` is this worktree's fresh build ───────
    const shimDir = makeThrowawayDir("lore-rch7-pathshim-");
    shimPath = join(shimDir, "lore");
    symlinkSync(LORE_BIN, shimPath);
    shimOnlyPath = shimDir;
    loreLessPath = makeThrowawayDir("lore-rch7-nolore-");

    // ── Harvest the canonical disposition lines from the binary itself ──────
    // One run with an accounting-free final message: its block reason must
    // carry a ready-to-copy line per id (H3). Those lines — not remembered
    // wording — are what the "complete accounting" fixtures below submit.
    armedTranscript = transcriptCarryingTicket((id) =>
      bashToolUseEntry(id, `lore feed session-resume --plan ${planSlug}`),
    );
    const bare = runHook(stopPayload(armedTranscript, "Committed the refactor; nothing else pending."));
    const bareDecision = parseStopDecision(bare.stdout, "fixture-derivation run");
    const harvested = new Map<string, string>();
    for (const id of EXPECTED_ITEM_IDS) {
      const matching = bareDecision.reason
        .split("\n")
        .filter((line) => line.includes(RESUME_DISPOSITION_MARKER) && wordBounded(id).test(line));
      if (matching.length !== 1) {
        throw new Error(
          `H3 requires the block reason to carry EXACTLY ONE ${RESUME_DISPOSITION_MARKER} line naming ${id}; found ${matching.length}. Full reason:\n${bareDecision.reason}`,
        );
      }
      harvested.set(id, matching[0]!.trim());
    }
    canonicalDispositionLine = harvested;
  });

  it("PATH provenance — the only `lore` a hook run can reach is this worktree's freshly built dist/lore", () => {
    // Guards the whole block against the stale-binary vector: were a globally
    // installed `lore` reachable, every assertion below would be measuring the
    // PREVIOUS release rather than this worktree's build.
    expect(shimOnlyPath.split(":").length).toBe(1);
    expect(realpathSync(shimPath)).toBe(realpathSync(LORE_BIN));
    expect(Bun.which("lore", { PATH: shimOnlyPath })).toBe(shimPath);
    expect(Bun.which("lore", { PATH: loreLessPath })).toBe(null);
    // The hook asset is read from `assets/` at its shipped bytes — this task
    // edited no asset, which is the delivery claim under test.
    expect(existsSync(HOOK_SSOT_PATH)).toBe(true);
  });

  it("incomplete accounting — the compiled path exits 0 and emits a stdout block decision naming EXACTLY the missing ids", () => {
    const dispositioned = EXPECTED_ITEM_IDS.slice(0, FIXTURE_DECISIONS.length);
    const missing = EXPECTED_ITEM_IDS.slice(FIXTURE_DECISIONS.length);
    expect(dispositioned.length).toBeGreaterThan(0);
    expect(missing.length).toBeGreaterThan(0);

    const run = runHook(stopPayload(armedTranscript, accountingFor(dispositioned)));

    // H1/H2: the verdict rides stdout at exit 0 — a non-zero status is the
    // channel measured to change nothing, and is no longer used for a verdict.
    expect(run.exitCode).toBe(0);
    const decision = parseStopDecision(run.stdout, "incomplete accounting");
    expect(decision.decision).toBe("block");

    // SET-equality, not containment: naming an extra id (or all seven) fails.
    expect(idsNamedIn(decision.reason)).toEqual([...missing]);

    // H2: stderr keeps the human diagnostic, and the hook relays it. Keyed on
    // the id set rather than the sentence wording, so a reworded diagnostic
    // does not silently degrade this to a no-match pass.
    expect(idsNamedIn(run.stderr)).toEqual([...missing]);

    // H3: the reason states the required output through the EXPORTED grammar
    // constants — asserted by identity against the barrel, never as literals.
    expect(decision.reason).toContain(RESUME_DISPOSITION_MARKER);
    expect(decision.reason).toContain(RESUME_DISPOSITION_DONE);
    expect(decision.reason).toContain(RESUME_DISPOSITION_DEFERRED_PREFIX);
  });

  it("complete accounting — the SAME transcript on the SAME PATH exits 0 with EMPTY stdout", () => {
    const complete = stopPayload(armedTranscript, accountingFor(EXPECTED_ITEM_IDS));

    // Fixture hygiene, asserted rather than assumed: this payload differs from
    // the blocking one ONLY in `last_assistant_message`, and does NOT sit on
    // the `stop_hook_active` short-circuit. Without this, "empty stdout" could
    // come from a payload that never reached the verb at all.
    const blocking = stopPayload(armedTranscript, accountingFor(EXPECTED_ITEM_IDS.slice(0, 1)));
    expect(Object.keys(complete)).toEqual(Object.keys(blocking));
    for (const key of Object.keys(complete)) {
      if (key === "last_assistant_message") continue;
      expect(complete[key]).toEqual(blocking[key]);
    }
    expect(complete.stop_hook_active).toBe(false);

    const run = runHook(complete);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");

    // The control half, on the byte-identical fixture: the detector WAS live.
    const control = runHook(blocking);
    expect(control.exitCode).toBe(0);
    expect(parseStopDecision(control.stdout, "complete-accounting control").decision).toBe("block");
  });

  it("the named id set is COMPUTED, not fixed — a different dispositioned subset yields a different missing set", () => {
    // Defeats a hardcoded verdict: two runs over one transcript, differing only
    // in which ids were accounted for, must name different remainders.
    const allButLast = EXPECTED_ITEM_IDS.slice(0, -1);
    const lastOnly = EXPECTED_ITEM_IDS.slice(-1);

    const runA = runHook(stopPayload(armedTranscript, accountingFor(allButLast)));
    const reasonA = parseStopDecision(runA.stdout, "all-but-last accounting").reason;
    expect(idsNamedIn(reasonA)).toEqual([...lastOnly]);

    const runB = runHook(stopPayload(armedTranscript, accountingFor(lastOnly)));
    const reasonB = parseStopDecision(runB.stdout, "last-only accounting").reason;
    expect(idsNamedIn(reasonB)).toEqual([...allButLast]);

    expect(reasonA).not.toBe(reasonB);
  });

  it("arming provenance survives the compiled path — only ticket text PRODUCED by a session-resume feed call blocks (H4)", () => {
    const planlessCommand = "cat docs/archive/old-handoff.md";
    const cases = [
      {
        label: "unpaired tool_result (no originating tool_use at all)",
        transcript: transcriptCarryingTicket(null),
        shouldBlock: false,
      },
      {
        label: "paired with a `cat` of an archived handoff",
        transcript: transcriptCarryingTicket((id) => bashToolUseEntry(id, planlessCommand)),
        shouldBlock: false,
      },
      {
        label: "paired with a Bash `lore feed session-resume` call",
        transcript: transcriptCarryingTicket((id) => bashToolUseEntry(id, "lore feed session-resume")),
        shouldBlock: true,
      },
      {
        label: "paired with an MCP lore_feed session-resume call",
        transcript: transcriptCarryingTicket((id) => mcpFeedToolUseEntry(id, "session-resume")),
        shouldBlock: true,
      },
      {
        // SPEC-112 D10, re-asserted by this spec's §Scope: a multi-actor render
        // carries the ordinals but NOT the floor declaration, and must stay
        // non-arming EVEN from a genuine feed call. Included here because it is
        // a second, content-keyed reason the verdict must stay conditional.
        label: "a genuine feed call whose ticket omits the coverage-floor declaration (D10 multi-actor)",
        transcript: (() => {
          const id = nextToolUseId();
          const floorless = ticketText.split(RESUME_COVERAGE_FLOOR).join("");
          // Non-degeneracy: still a ticket by every other measure — the ordinals
          // survive, so a non-block here cannot come from an empty fixture.
          expect(idsNamedIn(floorless)).toEqual([...EXPECTED_ITEM_IDS]);
          expect(floorless).not.toContain(RESUME_COVERAGE_FLOOR);
          return writeTranscript([
            bashToolUseEntry(id, "lore feed session-resume"),
            toolResultEntry(id, floorless),
          ]);
        })(),
        shouldBlock: false,
      },
    ] as const;

    // Every case carries the BYTE-IDENTICAL ticket text, so a non-blocking
    // outcome can only come from provenance — never from a ticket that was
    // absent, malformed, or differently rendered.
    const outcomes = cases.map((c) => {
      const run = runHook(stopPayload(c.transcript, "Done for now."));
      return {
        label: c.label,
        exitCode: run.exitCode,
        blocked:
          run.stdout.length > 0 && parseStopDecision(run.stdout, c.label).decision === "block",
      };
    });

    expect(outcomes).toEqual(
      cases.map((c) => ({ label: c.label, exitCode: 0, blocked: c.shouldBlock })),
    );
    // Non-degeneracy: the array really exercises both answers.
    expect(outcomes.filter((o) => o.blocked).length).toBeGreaterThan(0);
    expect(outcomes.filter((o) => !o.blocked).length).toBeGreaterThan(0);
  });

  it("ERROR: an unresolvable `lore` is DISTINGUISHABLE from a complete accounting — a hook fault is never reported as exit 0", () => {
    // This is the control that makes every "empty stdout" assertion above
    // non-vacuous. If a missing binary also produced exit 0 with empty stdout,
    // the complete-accounting half would be unfalsifiable.
    const faulted = runHook(stopPayload(armedTranscript, accountingFor(EXPECTED_ITEM_IDS)), loreLessPath);
    expect(faulted.exitCode).not.toBe(0);
    expect(faulted.stdout).toBe("");
    expect(faulted.stderr.length).toBeGreaterThan(0);

    const clean = runHook(stopPayload(armedTranscript, accountingFor(EXPECTED_ITEM_IDS)));
    expect(clean.exitCode).toBe(0);
    // The two states differ on the channel a consumer reads them by.
    expect(faulted.exitCode).not.toBe(clean.exitCode);
  });

  it("STATE: the stop_hook_active short-circuit is the OTHER cause of exit-0-and-silent, and no verdict fixture sits on it", () => {
    // Driven deliberately so the alternative explanation for silence is
    // measured rather than assumed absent. Same payload that blocks above.
    const blockingBody = stopPayload(armedTranscript, accountingFor(EXPECTED_ITEM_IDS.slice(0, 1)));
    expect(parseStopDecision(runHook(blockingBody).stdout, "pre-short-circuit").decision).toBe("block");

    const looped = runHook({ ...blockingBody, stop_hook_active: true });
    expect(looped.exitCode).toBe(0);
    expect(looped.stdout).toBe("");
  });

  it("relay fidelity — the hook reproduces the verb's own stdout byte-for-byte, proving PATH resolved to this same binary", () => {
    const message = accountingFor(EXPECTED_ITEM_IDS.slice(0, 2));
    const viaHook = runHook(stopPayload(armedTranscript, message));
    const viaVerb = runVerbDirect(armedTranscript, message);

    // The hook is documented as a blind pipe: no re-encoding, no added newline.
    expect(viaHook.stdout).toBe(viaVerb.stdout);
    expect(viaHook.stderr).toBe(viaVerb.stderr);
    expect(viaHook.exitCode).toBe(viaVerb.exitCode);
    // Non-degenerate: this compared a real verdict, not two empty strings.
    expect(parseStopDecision(viaHook.stdout, "relay fidelity").decision).toBe("block");
  });
});
