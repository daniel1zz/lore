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
 * Two ACs, each addressed by its own `-t` filter. MEASURED matched counts (a
 * zero/partial-match filtered run is this repo's most-measured false-pass
 * vector, so the count is part of the contract, not a detail):
 *   `-t "both surfaces"`  -> 3 tests (the AC-RC-4 test plus the BOUNDARY and
 *                            REGRESSION tests, whose names also carry the
 *                            phrase because they too assert across BOTH
 *                            surfaces — all three are AC-RC-4 evidence, so
 *                            the wider match is intended, not accidental).
 *   `-t "install parity"` -> 1 test.
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
 *     The "install parity" test asserts its target dir is neither inside this
 *     repo nor the real `~/.claude` BEFORE invoking setup.
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
 *               byte-identical and both manifest digests are current.
 *   NEGATIVE:   the report builder answers FALSE for text with the floor
 *               removed / the ordinals stripped / the cardinality line
 *               altered; the installed-byte comparison answers FALSE once the
 *               installed copy is perturbed.
 *   BOUNDARY:   each ordinal id tags EXACTLY ONE line (not "at least one");
 *               the cardinality line is identity-matched against the exported
 *               pure renderer applied to the fixture array lengths.
 *   ERROR:      the MCP call is asserted non-error and the CLI exit code 0 —
 *               a failed dispatch cannot masquerade as absent grammar.
 *   STATE:      the installed hook carries the executable bit though its repo
 *               blob does not (install transforms mode, never content); the
 *               corpus's stored SSOT array lengths equal the fixture's.
 *   REGRESSION: `RESUME_SCOPE_CLOSURE` is still the TRAILING block on both
 *               surfaces and is a DISTINCT string from the floor — the
 *               pre-existing upper bound was not disturbed or merged.
 *
 * @spec_ref spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 *   §Design Decisions D2, D3, D7, D8, D10; §Acceptance Criteria AC-RC-4,
 *   AC-RC-8. Task task-t4-governance-rule-manifest-regeneration-fresh-install-e2e.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  formatResumeItemId,
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

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels
// up), the same derivation every sibling compiled-binary e2e suite uses.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const ASSETS_ROOT = join(REPO_ROOT, "assets");

/** The two assets this task changed — the manifest must carry a CURRENT digest for BOTH. */
const HOOK_ASSET_REL = "hooks/stop-handoff-coverage.mjs";
const GOVERNANCE_ASSET_REL = "governance/corpus-workflow.md";
const HOOK_SSOT_PATH = join(ASSETS_ROOT, "hooks", "stop-handoff-coverage.mjs");
const GOVERNANCE_SSOT_PATH = join(ASSETS_ROOT, "governance", "corpus-workflow.md");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the COMPILED `dist/lore` with `cwd`/`HOME` both inside the throwaway corpus. `CLAUDECODE=1` resolves the "agent" caller surface (SPEC-024) so no write path risks a nested AI invocation. */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
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
function handoffArgs(planSlug: string, actor: string): string[] {
  return [
    "handoff",
    "--plan",
    planSlug,
    "--by",
    actor,
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

    const handoffResult = runLore(handoffArgs(planSlug, "t4-both-surfaces"), dir);
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

    // ── (c) The edited governance asset's own distribution oracle ───────────
    // `governance/corpus-workflow.md` is RETIRED from the machine install set
    // (SPEC-083 D3) — assert it ABSENT rather than stale, and pin its real
    // delivery surface: the compiled binary's own runtime `governance` verb.
    expect(existsSync(join(targetDir, "governance", "corpus-workflow.md"))).toBe(false);

    const governanceVerb = Bun.spawnSync([LORE_BIN, "governance"], { cwd: REPO_ROOT });
    expect(governanceVerb.exitCode).toBe(0);
    expect(governanceVerb.stdout.toString()).toBe(governanceSsotBytes.toString("utf8"));

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

  it("BOUNDARY: the governance asset carries the per-item disposition obligation, keyed on the exported grammar constants rather than remembered prose", () => {
    // D7: the FEED rule must name the id prefixes and the disposition tokens a
    // consumer has to write — asserted through the exported constants, so a
    // constant rename cannot leave the prose silently stale. Read from the
    // SSOT and cross-checked against the binary's shipping `governance` verb.
    const assetText = readFileSync(GOVERNANCE_SSOT_PATH, "utf8");
    const feedSectionStart = assetText.indexOf("## FEED");
    const nextSectionStart = assetText.indexOf("## PRODUCE");
    expect(feedSectionStart).toBeGreaterThanOrEqual(0);
    expect(nextSectionStart).toBeGreaterThan(feedSectionStart);
    const feedSection = assetText.slice(feedSectionStart, nextSectionStart);

    for (const prefix of [RESUME_ITEM_ID_PREFIX_KEY_DECISION, RESUME_ITEM_ID_PREFIX_NEXT_STEP]) {
      expect(feedSection).toContain(`\`${prefix}<n>\``);
    }

    // Both accepted dispositions, composed from the exported grammar the verb
    // parses — so a consumer following this prose emits what the verb accepts.
    expect(feedSection).toContain(`${RESUME_DISPOSITION_MARKER} <item-id>: ${RESUME_DISPOSITION_DONE}`);
    expect(feedSection).toContain(
      `${RESUME_DISPOSITION_MARKER} <item-id>: ${RESUME_DISPOSITION_DEFERRED_PREFIX}<reason>`,
    );
    // The obligation is ACCOUNTING, not completion (D5) — pinned as a token so
    // a future rewrite cannot quietly turn it into a completion demand.
    expect(feedSection).toContain("ACCOUNT, not to complete");

    const governanceVerb = Bun.spawnSync([LORE_BIN, "governance"], { cwd: REPO_ROOT });
    expect(governanceVerb.exitCode).toBe(0);
    expect(governanceVerb.stdout.toString()).toContain(feedSection.trimEnd());
  });
});
