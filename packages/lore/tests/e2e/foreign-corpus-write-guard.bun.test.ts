// @spawns-external git builds a throwaway git repository the test runs against
// @reads assets/project/lore-config-template.yaml
/**
 * @spec_ref AC-CP-3 (spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5)
 *
 * THE CENTRAL GUARD, exercised end-to-end against the COMPILED `dist/lore`
 * binary. One fixture SHAPE — a throwaway `mkdtemp` git repo whose worktree
 * is NESTED at `repo/.claude/worktrees/agent-x`, carrying no `.lore/` of its
 * own, so every write from it resolves the PARENT corpus by the identical
 * §M4 git-common-dir route — instantiated once PER CELL so cells never share
 * mutable state (mirrors `foreign-corpus-write-default.bun.test.ts`'s own
 * per-test fixture convention; "against ONE fixture" in the AC's own text
 * names the SHAPE, not a single shared instance — that AC's own next
 * sentence says "Every FIXTURE [plural] is an mkdtemp git repo").
 *
 * Cells (the four-cell shape AC-CP-3 pins):
 *   (1) ALLOWED — `lore claim --worktree <path>`, then `lore evidence` on
 *       the SAME task, which carries NO `--worktree` flag at all (that flag
 *       does not exist on `evidence`) — permitted by INHERITING intent from
 *       the persisted lease, never by re-declaring it.
 *   (2) REFUSED, two independently-constructed halves:
 *       (2a) `lore claim` WITHOUT `--worktree`, run from the foreign
 *            worktree — refused before any lease is even written.
 *       (2b) `lore evidence` on a task whose lease genuinely HAS a claim but
 *            NO `worktree` field — constructed by claiming that task from
 *            the PRIMARY checkout first (provenance `"own"` there, so the
 *            guard is inert and the claim legitimately lands with no
 *            `worktree` recorded), then running `evidence` on it from the
 *            foreign worktree.
 *   (3) REFUSED — a non-lifecycle write, `lore create knowledge`.
 *   (4) ALLOWED — §D5's SECOND named exemption, which is SEAM-shaped rather
 *       than adapter-shaped: `lore handoff` and `lore uat record` issued from
 *       that same foreign worktree with NO lease anywhere must LAND, because
 *       they route through `CorpusService.createHandoffDoc`/`createUatDoc`.
 *
 * ⛔ Cell 4 is the deliberate PAIR of cell 3, and the pairing is the whole
 * oracle: both are non-lifecycle creates against the same foreign corpus,
 * differing ONLY in whether the write goes through those two seams. So an
 * exemption WIDENED to cover ordinary creates reddens cell 3, and one NARROWED
 * away or deleted reddens cell 4 — which is what makes the carve-out
 * falsifiable in both directions instead of merely reasoned in a comment.
 * Both measured 2026-08-12 by probe (each probe reverted immediately).
 *
 * ⛔ Cell 4 is NOT the cell AC-CP-3 calls UNCONSTRUCTIBLE BY DESIGN. That one
 * is a DIFFERENT cell — non-lifecycle WITH declared intent — and stays
 * deliberately absent: no non-lifecycle verb defines `--worktree` and no
 * general intent flag exists. The seams cell 4 drives are exempt for WHAT THEY
 * ARE, never because anything declared intent, which is why cell 4's fixture
 * asserts it holds no task (and therefore no claim lease) at all.
 *
 * PINNED ORACLE VALUES: every refused case asserts exit code EXACTLY 4 and
 * stderr CONTAINING the literal token `gate:corpus-write:foreign-provenance`
 * (`FOREIGN_CORPUS_WRITE_TOKEN`, `foreign-corpus-write-guard.ts` — the SAME
 * token AC-CP-5(a) asserts equal across CLI and MCP). Cells 1 and 4 assert
 * their writes actually LANDED by READING THEM BACK from the parent corpus
 * (from the PRIMARY checkout) — cell 1 the evidence row on the task, matched
 * on the row's own `command`/`result`/`oracle` rather than on its bare
 * presence; cell 4 each created doc by slug. Never just "the doc count did not
 * change", and never a bare exit 0: both are the empty-artifact false oracle
 * this spec explicitly calls out (a refused write and a crashed process look
 * identical under that assertion alone; a positive landing check is the only
 * thing that proves ALLOW rather than "nothing ran").
 *
 * A separate, NON-e2e `describe` block below exercises
 * `checkForeignCorpusWrite` (the pure predicate, imported directly from
 * source — this file already runs under `bun test`, so an in-process import
 * needs no compiled-binary freshness guard) for the `undetermined`/`null`/
 * `enabled:false` cases this guard's own module header documents. NONE of
 * these are reachable through the compiled CLI in practice: an
 * `"undetermined"` resolution makes `findLoreDbPath()` exit 1 BEFORE the App
 * is even constructed, so `loader.ts`'s guard-wiring code never runs with
 * that value — the pure-predicate test is the only way to pin the decision
 * this module's header commits to.
 *
 * ⛔ Every fixture is an `mkdtemp` git repo asserted to live outside
 * REPO_ROOT — the real corpus is never touched (project CLAUDE.md).
 *
 * Freshness guard: `beforeAll` calls `assertFreshBinary` against THIS
 * worktree's own `dist/lore` and `packages/{lore,core}/src` (dogfood lesson,
 * repo CLAUDE.md false-oracle vector #4 — a stale binary is a documented
 * false oracle in this repo). REPO_ROOT is derived from `import.meta.url`
 * and cross-checked against `git rev-parse --show-toplevel` so this file can
 * never accidentally build/spawn a sibling worktree's or the main
 * checkout's binary (mirrors `foreign-corpus-write-default.bun.test.ts`'s
 * identical guard).
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkForeignCorpusWrite,
  FOREIGN_CORPUS_WRITE_TOKEN,
  type ForeignCorpusWriteContext,
} from "../../src/service/foreign-corpus-write-guard.js";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// ─── Path / spawn setup (mirrors foreign-corpus-write-default.bun.test.ts) ──

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

beforeAll(() => {
  // Pins "YOUR worktree's dist/lore, never a sibling worktree or the main
  // checkout" as a runtime assertion — see foreign-corpus-write-default.bun.test.ts's
  // identical check for the full rationale.
  const gitToplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
  if (gitToplevel !== REPO_ROOT) {
    throw new Error(
      `REPO_ROOT derivation mismatch: import.meta.url-derived REPO_ROOT is "${REPO_ROOT}" ` +
        `but 'git rev-parse --show-toplevel' from this file's own directory says ` +
        `"${gitToplevel}". This test must run against ITS OWN worktree's checkout, never ` +
        `a sibling worktree or the main checkout.`,
    );
  }
});

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
  return realpathSync(dir);
}

/** Runs `git <args>` in `cwd`. Fixture setup only — never the code path under test. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

function initGitRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "foreign-corpus-write-guard-test@example.invalid"]);
  git(dir, ["config", "user.name", "foreign-corpus-write-guard e2e"]);
  writeFileSync(join(dir, "README.md"), "foreign-corpus-write-guard fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
}

/**
 * Spawns the COMPILED `dist/lore` binary with `cwd`/`HOME` both pointed at
 * `cwd` (never the real user's `~/.config/lore`). `CLAUDECODE=1` resolves
 * the "agent" caller surface (SPEC-024) so no write here risks a nested AI
 * invocation.
 */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

async function initCorpus(dir: string): Promise<void> {
  const result = await runLore(["init", "--author", "foreign-write-guard-e2e"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`fixture setup: 'lore init' failed in ${dir}: ${result.stderr}`);
  }
}

/**
 * Disables the four PRE-EXISTING `lore gate` checkpoints (mirrors
 * `worktree-corpus-resolution.bun.test.ts`'s own `disableAllGates`) —
 * this suite's AC is the foreign-corpus-write guard specifically, and
 * disabling the unrelated task-claim/spec-* checkpoints removes an
 * unrelated source of flakiness from the claim/evidence/create chain.
 * Deliberately does NOT touch `workflow.gates."corpus-write"` — that is
 * the ONE checkpoint under test, and it defaults enabled (AC-CP-4(a)).
 */
function disableUnrelatedGates(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse slug from create output: ${stdout}`);
  }
  return slug;
}

/**
 * Seeds a PRD -> plan chain FROM `dir` (the PRIMARY checkout — never foreign,
 * so seeding itself is never subject to the guard under test) and returns the
 * plan's slug.
 *
 * Split out of {@link seedTask} for cell 4, which needs a plan as `lore uat
 * record`'s target but must NOT have a task in its fixture at all: a task is
 * the only doc that carries a claim lease, so a task-free fixture is what makes
 * "no declared intent anywhere" a structural fact rather than an assumption.
 */
async function seedPlan(dir: string, titleSuffix: string): Promise<string> {
  const prdResult = await runLore(
    ["create", "prd", "--title", `FCWG E2E PRD ${titleSuffix}`, "--content", "root", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const planResult = await runLore(
    ["create", "plan", "--title", `FCWG E2E Plan ${titleSuffix}`, "--parent", prdSlug, "--content", "x", "--no-ai"],
    dir,
  );
  expect(planResult.exitCode).toBe(0);
  return parseSlug(planResult.stdout);
}

/**
 * Seeds a PRD -> plan -> task chain FROM `dir` (the PRIMARY checkout — never
 * foreign, so seeding itself is never subject to the guard under test) and
 * returns the task's slug. Mirrors `worktree-corpus-resolution.bun.test.ts`'s
 * own `seedTask` shape exactly (task requires a plan parent + `extra.plan_id`
 * per `CreateDocInput` validation).
 */
async function seedTask(dir: string, titleSuffix: string): Promise<string> {
  const planSlug = await seedPlan(dir, titleSuffix);

  const taskResult = await runLore(
    [
      "create",
      "task",
      "--title",
      `FCWG E2E Task ${titleSuffix}`,
      "--parent",
      planSlug,
      "--plan-id",
      planSlug,
      "--content",
      "x",
      "--no-ai",
    ],
    dir,
  );
  expect(taskResult.exitCode).toBe(0);
  return parseSlug(taskResult.stdout);
}

/**
 * Builds the AC-CP-3 fixture shape: a throwaway git repo, `lore init`-ed,
 * with a NESTED worktree at `repo/.claude/worktrees/agent-x` carrying no
 * `.lore/` of its own — every write from `worktreePath` is genuinely foreign.
 */
async function createNestedWorktreeFixture(prefix: string): Promise<{ repoRoot: string; worktreePath: string }> {
  const repoRoot = mkScratchDir(`fcwg-${prefix}-repo-`);

  if (repoRoot === REPO_ROOT || repoRoot.startsWith(`${REPO_ROOT}/`)) {
    throw new Error(
      `fixture safety: mkdtemp repoRoot "${repoRoot}" is INSIDE this checkout's own ` +
        `REPO_ROOT ("${REPO_ROOT}") — refusing to proceed. Every fixture in this file ` +
        `must live outside the repo root so a write can never reach the real corpus.`,
    );
  }

  initGitRepo(repoRoot);
  await initCorpus(repoRoot);
  disableUnrelatedGates(repoRoot);

  mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
  const worktreeRelPath = join(".claude", "worktrees", "agent-x");
  git(repoRoot, ["worktree", "add", "-b", `${prefix}-agent-x`, worktreeRelPath]);
  const worktreePath = join(repoRoot, worktreeRelPath);

  // Precondition the whole fixture depends on: the nested worktree genuinely
  // has no local .lore/ — every write below is a write into a corpus this
  // worktree does not own (the §M4 git-common-dir fallback resolves the
  // PARENT's corpus).
  expect(existsSync(join(worktreePath, ".lore"))).toBe(false);

  return { repoRoot, worktreePath };
}

/** The pinned refusal token asserted below — imported straight from the guard module's own constant, never a paraphrase. */
const TOKEN = FOREIGN_CORPUS_WRITE_TOKEN;

/**
 * Asserts `result` is the guard's REFUSAL shape: exit code EXACTLY 4 and
 * stderr CONTAINING the pinned token. Throws a self-describing error
 * (mirrors `foreign-corpus-write-default.bun.test.ts`'s own
 * `assertForeignWriteRefused`) rather than asserting ONLY "the doc count did
 * not change" — the empty-artifact false oracle this spec's own text calls
 * out (a refused write and a crashed process look identical under that
 * assertion alone).
 */
function expectRefused(result: RunResult, label: string): void {
  const refused = result.exitCode === 4 && result.stderr.includes(TOKEN);
  if (!refused) {
    throw new Error(
      `${label}: EXPECTED the write to be REFUSED (exit code 4, stderr containing "${TOKEN}"), ` +
        `but got exit=${result.exitCode} stderr=${JSON.stringify(result.stderr)} ` +
        `stdout=${JSON.stringify(result.stdout)}.`,
    );
  }
}

describe("foreign-corpus-write guard — the central 2x2-minus-one (AC-CP-3)", () => {
  it(
    "(1) ALLOWED: claim --worktree then evidence (no flag) on the SAME task both land in the parent corpus",
    async () => {
      const { repoRoot, worktreePath } = await createNestedWorktreeFixture("cell1");
      const taskSlug = await seedTask(repoRoot, "cell1");

      const claimResult = await runLore(
        ["claim", taskSlug, "--worktree", worktreePath],
        worktreePath,
      );
      expect(claimResult.exitCode).toBe(0);

      const evidenceResult = await runLore(
        [
          "evidence",
          taskSlug,
          "--oracle",
          "manual",
          "--command",
          "echo fcwg-cell1",
          "--result",
          "pass",
          "--output-tail",
          "ok",
        ],
        worktreePath,
      );
      expect(evidenceResult.exitCode).toBe(0);

      // Positive landing check (never just "doc count unchanged", never a bare
      // exit 0) — both writes are read back from the PRIMARY checkout's corpus,
      // and the evidence row is matched on its OWN recorded fields rather than
      // on the array merely being length 1: a row-shaped placeholder written by
      // some other path would satisfy a count but not this.
      const verify = await runLore(["get", taskSlug, "--json"], repoRoot);
      expect(verify.exitCode).toBe(0);
      const parsed = JSON.parse(verify.stdout) as {
        data: {
          doc: {
            extra: {
              claim?: { worktree?: string };
              verification_evidence?: Array<{ oracle?: string; command?: string; result?: string }>;
            };
          };
        };
      };
      expect(parsed.data.doc.extra.claim?.worktree).toBe(worktreePath);
      const evidenceRows = parsed.data.doc.extra.verification_evidence;
      expect(Array.isArray(evidenceRows)).toBe(true);
      expect(evidenceRows?.length).toBe(1);
      expect(evidenceRows?.[0]?.oracle).toBe("manual");
      expect(evidenceRows?.[0]?.command).toBe("echo fcwg-cell1");
      expect(evidenceRows?.[0]?.result).toBe("pass");
    },
    30000,
  );

  it(
    "(2a) REFUSED: claim WITHOUT --worktree from the foreign worktree",
    async () => {
      const { repoRoot, worktreePath } = await createNestedWorktreeFixture("cell2a");
      const taskSlug = await seedTask(repoRoot, "cell2a");

      const claimResult = await runLore(["claim", taskSlug], worktreePath);
      expectRefused(claimResult, "cell2a-claim");

      // The refused claim must not have landed a lease at all.
      const verify = await runLore(["get", taskSlug, "--json"], repoRoot);
      expect(verify.exitCode).toBe(0);
      const parsed = JSON.parse(verify.stdout) as { data: { doc: { extra: { claim?: unknown } } } };
      expect(parsed.data.doc.extra.claim).toBeUndefined();
    },
    30000,
  );

  it(
    "(2b) REFUSED: evidence on a task whose lease has a claim but no worktree field",
    async () => {
      const { repoRoot, worktreePath } = await createNestedWorktreeFixture("cell2b");
      const taskSlug = await seedTask(repoRoot, "cell2b");

      // Constructed from the PRIMARY checkout, where provenance is "own" and
      // the guard is inert regardless of --worktree — this legitimately
      // lands a claim lease with NO worktree field, the exact precondition
      // cell (2b) needs.
      const primaryClaimResult = await runLore(["claim", taskSlug], repoRoot);
      expect(primaryClaimResult.exitCode).toBe(0);

      const precondition = await runLore(["get", taskSlug, "--json"], repoRoot);
      const preParsed = JSON.parse(precondition.stdout) as {
        data: { doc: { extra: { claim?: { worktree?: string } } } };
      };
      expect(preParsed.data.doc.extra.claim).toBeDefined();
      expect(preParsed.data.doc.extra.claim?.worktree).toBeUndefined();

      const evidenceResult = await runLore(
        [
          "evidence",
          taskSlug,
          "--oracle",
          "manual",
          "--command",
          "echo fcwg-cell2b",
          "--result",
          "pass",
          "--output-tail",
          "ok",
        ],
        worktreePath,
      );
      expectRefused(evidenceResult, "cell2b-evidence");

      // The refused evidence write must not have landed.
      const verify = await runLore(["get", taskSlug, "--json"], repoRoot);
      const parsed = JSON.parse(verify.stdout) as {
        data: { doc: { extra: { verification_evidence?: unknown[] } } };
      };
      expect(parsed.data.doc.extra.verification_evidence ?? []).toEqual([]);
    },
    30000,
  );

  it(
    "(3) REFUSED: a non-lifecycle write, lore create knowledge",
    async () => {
      const { repoRoot, worktreePath } = await createNestedWorktreeFixture("cell3");

      const createResult = await runLore(
        [
          "create",
          "knowledge",
          "--sub-type",
          "reference",
          "--title",
          "FCWG E2E fixture cell3",
          "--content",
          "x",
          "--no-ai",
        ],
        worktreePath,
      );
      expectRefused(createResult, "cell3-create");

      // The refused create must not have landed in the parent corpus.
      const verify = await runLore(["list", "--type", "knowledge", "--json"], repoRoot);
      expect(verify.exitCode).toBe(0);
      const parsed = JSON.parse(verify.stdout) as { data: { docs: Array<{ title: string }> } };
      expect(parsed.data.docs.some((d) => d.title === "FCWG E2E fixture cell3")).toBe(false);
    },
    30000,
  );

  it(
    "(4) ALLOWED: the D5 seam exemption — `lore handoff` and `lore uat record` land from the SAME foreign worktree with NO lease",
    async () => {
      const { repoRoot, worktreePath } = await createNestedWorktreeFixture("cell4");
      const planSlug = await seedPlan(repoRoot, "cell4");

      // The precondition that makes this cell mean what AC-CP-3 says it means,
      // ASSERTED rather than assumed: the fixture holds no task at all, and a
      // task is the only doc that can carry a claim lease. So neither write
      // below has any declared intent to inherit — they are permitted for WHAT
      // THEY ARE (the two §D5 seams), never because something declared intent.
      // Without this assertion cell 4 would be indistinguishable from the
      // UNCONSTRUCTIBLE non-lifecycle-WITH-intent cell it must not become.
      const tasks = await runLore(["list", "--type", "task", "--json"], repoRoot);
      expect(tasks.exitCode).toBe(0);
      expect((JSON.parse(tasks.stdout) as { data: { docs: unknown[] } }).data.docs).toEqual([]);

      // ── Seam 1: `lore handoff` → SessionService.writeHandoff → createHandoffDoc ──
      const handoffResult = await runLore(
        [
          "handoff",
          "--plan",
          planSlug,
          "--next",
          "merge the cell4 fixture branch",
          "--json",
        ],
        worktreePath,
      );
      expect(handoffResult.exitCode).toBe(0);
      const handoffSlug = (JSON.parse(handoffResult.stdout) as { data: { slug: string } }).data.slug;

      // ── Seam 2: `lore uat record` → UatService.record → createUatDoc ──
      const uatPayloadPath = join(worktreePath, "fcwg-cell4-uat.json");
      writeFileSync(
        uatPayloadPath,
        JSON.stringify({
          verdict: "accept",
          tier_results: [{ tier: "P0", accepted: 1, rejected: 0, unverified: 0 }],
          requirement_coverage: { total: 1, covered: 1, uncovered_p0: [] },
          uiux: { blocker_count: 0, min_dimension_score: 5 },
          run_meta: { at: "2026-08-12T00:00:00.000Z", by: "agent:fcwg-cell4" },
        }),
      );
      const uatResult = await runLore(
        ["uat", "record", planSlug, "--json-file", uatPayloadPath, "--json"],
        worktreePath,
      );
      expect(uatResult.exitCode).toBe(0);
      const uatSlug = (JSON.parse(uatResult.stdout) as { data: { slug: string } }).data.slug;

      // LANDING proven by READ-BACK from the PARENT corpus by slug, never by
      // the exit codes above — a bare exit 0 cannot tell a landed write from a
      // process that reported success and wrote nothing.
      for (const [slug, subType] of [
        [handoffSlug, "handoff"],
        [uatSlug, "uat"],
      ] as const) {
        const readBack = await runLore(["get", slug, "--json"], repoRoot);
        expect(readBack.exitCode).toBe(0);
        const doc = (
          JSON.parse(readBack.stdout) as {
            data: { doc: { slug: string; type: string; extra: { sub_type?: string } } };
          }
        ).data.doc;
        expect(doc.slug).toBe(slug);
        expect(doc.type).toBe("knowledge");
        expect(doc.extra.sub_type).toBe(subType);
      }
    },
    60000,
  );
});

// ─── Pure-predicate coverage: undetermined / null / disabled (in-process) ──

describe("checkForeignCorpusWrite — undetermined/null/disabled are always inert (pure, in-process)", () => {
  it("provenance 'undetermined' is ALLOWED, never treated as evidence of foreign crossing", () => {
    const context: ForeignCorpusWriteContext = { provenance: "undetermined", enabled: true };
    expect(checkForeignCorpusWrite(context, false)).toEqual({ allowed: true });
  });

  it("provenance null (adapter has no per-call caller directory) is ALLOWED regardless of enabled", () => {
    expect(checkForeignCorpusWrite({ provenance: null, enabled: true }, false)).toEqual({ allowed: true });
    expect(checkForeignCorpusWrite({ provenance: null, enabled: false }, false)).toEqual({ allowed: true });
  });

  it("provenance 'own' is ALLOWED regardless of intent", () => {
    expect(checkForeignCorpusWrite({ provenance: "own", enabled: true }, false)).toEqual({ allowed: true });
  });

  it("the config knob (enabled: false) disables the predicate even for a confirmed git_common_dir crossing with no declared intent", () => {
    const context: ForeignCorpusWriteContext = { provenance: "git_common_dir", enabled: false };
    expect(checkForeignCorpusWrite(context, false)).toEqual({ allowed: true });
  });

  it("CONTROL: git_common_dir + enabled + no declared intent IS refused, carrying the pinned token", () => {
    const context: ForeignCorpusWriteContext = { provenance: "git_common_dir", enabled: true };
    const verdict = checkForeignCorpusWrite(context, false);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain(TOKEN);
    }
  });

  it("CONTROL: git_common_dir + enabled + declared intent IS allowed", () => {
    const context: ForeignCorpusWriteContext = { provenance: "git_common_dir", enabled: true };
    expect(checkForeignCorpusWrite(context, true)).toEqual({ allowed: true });
  });
});
