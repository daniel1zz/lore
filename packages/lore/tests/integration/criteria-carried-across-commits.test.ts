// @spawns-external git builds a throwaway git repository the real carry port and selector read
/**
 * @spec_ref spec-a-criterion-s-stamped-pass-carries-to-the-assessed-head (AC-CC-1, BR-1498)
 *
 * A criterion's stamped pass carries to the assessed commit when nothing its command selects changed. Throwaway git repo
 * (two commits C and H, first-parent line), hand-built corpus documents (spec, plan, tasks with runner-shaped evidence rows)
 * read by the REAL `attestationRowsOf` / `planCriterionScopes`, the REAL carry port over the REAL selector
 * (`createGitCarryPort` -> `selectForCommit`); only the criteria runner is a counted fake (it writes the row the real
 * `lore verify` refresh writes). Criteria: K1 runs a.test.ts, K2 runs b.test.ts (imports src/b.ts, `@reads` fixtures),
 * K3 `bun run typecheck`, K4 `bun run test:file a.test.ts && bun run scripts/k4.ts`.
 *
 * Dimensions: HAPPY (a: K1 carried, K2/K3/K4 run once; a second review runs only K3/K4), (b: an `@reads` fixture re-runs K2
 * only), NEGATIVE (c: newer failure, unstamped, non-ancestor, older revision, task-worktree row, deleted/renamed test, unreadable
 * diff each re-run K1), BOUNDARY (qualifying-command parse), STATE (a second review at the same head), REGRESSION (carrying by
 * task anchors would carry K2 in b; carrying K3/K4 or an older pass under a newer failure would pass the wrong cases).
 */

import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { err, ok, type DocRecord, type LoreError, type PlanBundle, type Result } from "@lore/core";
import { createGitCarryPort } from "../../src/adapters/cli/assess-carry-selection.js";
import { measurePlanCriteriaAtHead, type ListDocsPort } from "../../src/adapters/cli/assess-attestation-wiring.js";
import { milestoneFactsFingerprint } from "../../src/service/milestone-review.js";
import {
  testPathsOfQualifyingCommand,
  type CarryPort,
  type HeadCriteriaRunnerPort,
  type HeadCriterionOutcome,
} from "../../src/service/milestone-attestation-facts.js";

// ─── throwaway git repository ────────────────────────────────────────────────

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" },
  }).trim();
}

type Tree = Readonly<Record<string, string>>;

const A_TEST = "packages/x/tests/a.test.ts";
const B_TEST = "packages/x/tests/b.test.ts";
const BASE: Tree = {
  [A_TEST]: `import { a } from "../src/a.js";\nexport const t = a;\n`,
  [B_TEST]: `// @reads packages/x/fixtures/**\nimport { b } from "../src/b.js";\nexport const t = b;\n`,
  "packages/x/src/a.ts": "export const a = 1;\n",
  "packages/x/src/b.ts": "export const b = 1;\n",
  "packages/x/fixtures/data.txt": "one\n",
};

interface Repo {
  readonly root: string;
  readonly c: string;
  readonly h: string;
  /** A commit that is NOT on h's first-parent line (a sibling of c's child). */
  readonly side: string;
}

/** C holds BASE; H holds BASE with `change` applied (a `null` value deletes the path). */
function buildRepo(change: Readonly<Record<string, string | null>>): Repo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "criteria-carried-")));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "commit.gpgsign", "false");
  const write = (tree: Tree): void => {
    for (const [path, content] of Object.entries(tree)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  };
  write(BASE);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "C");
  const c = git(root, "rev-parse", "HEAD");
  // a commit hanging off C that main never merges: its sha is stamped on a "task worktree" style row
  const side = git(root, "commit-tree", `${c}^{tree}`, "-p", c, "-m", "side");
  for (const [path, content] of Object.entries(change)) {
    if (content === null) git(root, "rm", "-q", path);
    else write({ [path]: content });
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "H");
  return { root, c, h: git(root, "rev-parse", "HEAD"), side };
}

// ─── hand-built corpus ───────────────────────────────────────────────────────

const SPEC_ID = "spec-id-carry";
const SPEC_SLUG = "spec-carry";
const COMMANDS: Readonly<Record<string, string>> = {
  "AC-K1": `bun run test:file ${A_TEST} && echo 'K1 PASS'`,
  "AC-K2": `bun run test:file ${B_TEST}`,
  "AC-K3": "bun run typecheck",
  "AC-K4": `bun run test:file ${A_TEST} && bun run scripts/k4.ts`,
};
const ACS = Object.keys(COMMANDS);

const asDoc = (partial: Record<string, unknown>): DocRecord =>
  ({ role: "plan", status: "approved", priority: "medium", content: "", parent_id: null, created_at: "t", updated_at: "t", created_by: "t", version: 1, deleted_at: null, tags: [], ...partial }) as unknown as DocRecord;

let clock = 0;
const nextAt = (): string => new Date(Date.UTC(2026, 9, 31, 10, 0, 0) + ++clock * 1000).toISOString();

interface RowSpec {
  readonly result?: "pass" | "fail";
  readonly head: string;
  readonly stamped?: boolean;
  readonly review?: boolean;
  readonly generation?: number;
}

function evidenceRow(ac: string, spec: RowSpec): Record<string, unknown> {
  return {
    oracle: "other",
    command: COMMANDS[ac],
    result: spec.result ?? "pass",
    recorded_at: nextAt(),
    recorded_by: "agent:test",
    ac_ref: ac,
    ...(spec.generation !== undefined ? { ac_oracle_generation: spec.generation } : {}),
    ...(spec.review === false ? {} : { milestone_refresh: true }),
    attestation: {
      runner: "lore-cli",
      exit_code: spec.result === "fail" ? 1 : 0,
      duration_ms: 1,
      timed_out: false,
      ...(spec.stamped === false ? {} : { state_stamp: { head_sha: spec.head, worktree_dirty: false } }),
    },
  };
}

class Corpus {
  readonly spec: DocRecord;
  readonly plan: DocRecord;
  readonly declaring: DocRecord;
  /** One ad-hoc review task per criterion (where the review's refresh rows land). */
  readonly adhoc = new Map<string, DocRecord>();

  constructor(criterionExtra: Readonly<Record<string, Record<string, unknown>>> = {}) {
    this.spec = asDoc({
      id: SPEC_ID,
      slug: SPEC_SLUG,
      type: "spec",
      title: "carry",
      extra: {
        acceptance_criteria: ACS.map((id) => ({
          id,
          statement: `${id} holds`,
          verify: { mode: "script", oracle: "other", command: COMMANDS[id] },
          ...(criterionExtra[id] ?? {}),
        })),
      },
    });
    this.plan = asDoc({ id: "plan-id-carry", slug: "plan-carry", type: "plan", title: "p", parent_id: SPEC_ID, extra: {} });
    this.declaring = asDoc({ id: "task-id-decl", slug: "task-decl", type: "task", title: "t", extra: { plan_id: "plan-id-carry", ac_scope: ACS, verification_evidence: [] } });
    for (const ac of ACS) {
      this.adhoc.set(ac, asDoc({ id: `adhoc-id-${ac}`, slug: `adhoc-${ac}`, type: "task", title: ac, extra: { adhoc: true, ac_scope: [ac], governing_spec: SPEC_ID, verification_evidence: [] } }));
    }
  }

  /** Records a row as the review's refresh (default) or, with `review: false`, as the declaring task's worktree run. */
  record(ac: string, spec: RowSpec): void {
    const holder = spec.review === false ? this.declaring : (this.adhoc.get(ac) as DocRecord);
    (holder.extra["verification_evidence"] as unknown[]).push(evidenceRow(ac, spec));
  }

  /** The id the row recorded last for `ac` on its ad-hoc task carries (`<task-slug>@<recorded_at>`). */
  lastId(ac: string): string {
    const rows = (this.adhoc.get(ac) as DocRecord).extra["verification_evidence"] as { recorded_at: string }[];
    return `adhoc-${ac}@${(rows[rows.length - 1] as { recorded_at: string }).recorded_at}`;
  }

  readonly listDocs: ListDocsPort = async (type): Promise<Result<DocRecord[], LoreError>> =>
    ok(type === "spec" ? [this.spec] : type === "plan" ? [this.plan] : [this.declaring, ...this.adhoc.values()]);

  bundle(): PlanBundle {
    return { plan: this.plan, spec: this.spec, tasks: [this.declaring] } as unknown as PlanBundle;
  }
}

/** The counted fake of `lore verify`'s refresh: every criterion it is asked to run writes a stamped, review-recorded pass at the commit. */
function countingRunner(corpus: Corpus): { port: HeadCriteriaRunnerPort; requests: string[][] } {
  const requests: string[][] = [];
  return {
    requests,
    port: {
      attestAtHead: async (request): Promise<Result<readonly HeadCriterionOutcome[], LoreError>> => {
        requests.push(request.criteria.map((c) => c.ac_id));
        for (const c of request.criteria) corpus.record(c.ac_id, { head: request.commit });
        return ok(request.criteria.map((c): HeadCriterionOutcome => ({ ...c, ran: true })));
      },
    },
  };
}

const factOf = (facts: { attestation?: readonly { subject: string; verdict: string; detail: string }[] }, ac: string): { verdict: string; detail: string } => {
  const row = facts.attestation?.find((r) => r.subject === `${SPEC_SLUG}:${ac}`);
  if (row === undefined) throw new Error(`no fact for ${ac}`);
  return row;
};

async function review(corpus: Corpus, repo: Repo, carry: CarryPort | undefined = createGitCarryPort(repo.root, process.env)) {
  const runner = countingRunner(corpus);
  const facts = await measurePlanCriteriaAtHead(corpus.listDocs, corpus.bundle(), { commit: repo.h }, runner.port, carry);
  return { facts, requests: runner.requests };
}

/** Records a pass for every criterion at C, as an earlier review would have. */
function seedPassesAtC(corpus: Corpus, repo: Repo): void {
  for (const ac of ACS) corpus.record(ac, { head: repo.c });
}

const short = (sha: string): string => sha.slice(0, 8);

// ─── (a) a landing b.test.ts reaches ────────────────────────────────────────

describe("AC-CC-1 (a) carried when untouched", () => {
  it("AC-CC-1 HAPPY: a source b.test.ts imports changes: K2, K3, K4 run once at H, K1 is carried and named; a second review runs only K3 and K4", async () => {
    const repo = buildRepo({ "packages/x/src/b.ts": "export const b = 2;\n" });
    const corpus = new Corpus();
    seedPassesAtC(corpus, repo);
    const k1Id = corpus.lastId("AC-K1");

    const first = await review(corpus, repo);
    expect(first.requests).toEqual([["AC-K2", "AC-K3", "AC-K4"]]);
    const k1 = factOf(first.facts, "AC-K1");
    expect(k1.verdict).toBe("pass");
    expect(k1.detail).toContain(`carried from ${short(repo.c)}`);
    expect(k1.detail).toContain(k1Id);
    expect(k1.detail).toContain(A_TEST);
    expect(first.facts.criteria_attestation_ids?.find((d) => d.subject === `${SPEC_SLUG}:AC-K1`)?.id).toBe(k1Id);
    expect(factOf(first.facts, "AC-K2").detail).toContain(`change reaches ${B_TEST}`);
    expect(factOf(first.facts, "AC-K2").detail).toContain("attested pass at");

    const second = await review(corpus, repo);
    expect(second.requests).toEqual([["AC-K3", "AC-K4"]]);
    expect(factOf(second.facts, "AC-K1").detail).toContain(`carried from ${short(repo.c)}`);
    // K2 now carries from the attestation the first review made at H (C = H, the trivial case)
    expect(factOf(second.facts, "AC-K2").detail).toContain(`carried from ${short(repo.h)}`);
  });
});

// ─── (b) an @reads-only reach ───────────────────────────────────────────────

describe("AC-CC-1 (b) a fixture declared with @reads", () => {
  it("AC-CC-1 HAPPY: only the fixture b.test.ts declares with @reads changes: K2 is re-run (by the selector, never by anchors) and K1 is carried", async () => {
    const repo = buildRepo({ "packages/x/fixtures/data.txt": "two\n" });
    const corpus = new Corpus();
    seedPassesAtC(corpus, repo);
    // the declaring task anchors a.test.ts only: anchors cannot explain K2 re-running
    corpus.declaring.extra["file_anchors"] = [A_TEST];
    const { facts, requests } = await review(corpus, repo);
    expect(requests).toEqual([["AC-K2", "AC-K3", "AC-K4"]]);
    expect(factOf(facts, "AC-K1").detail).toContain("carried from");
    expect(factOf(facts, "AC-K2").detail).toContain(`change reaches ${B_TEST}`);
  });
});

// ─── (c)+(d) K1 is re-run, each with its reason ─────────────────────────────

describe("AC-CC-1 (c)(d) K1 re-runs, naming why", () => {
  const onlyBChanges = { "packages/x/src/b.ts": "export const b = 2;\n" };

  it("AC-CC-1 NEGATIVE: no attestation at all: no candidate", async () => {
    const repo = buildRepo(onlyBChanges);
    const corpus = new Corpus();
    const { facts, requests } = await review(corpus, repo);
    expect(requests).toEqual([ACS]);
    expect(factOf(facts, "AC-K1").detail).toContain("re-run: no candidate");
  });

  it("AC-CC-1 NEGATIVE: a newer stamped failure on top of an older pass is the candidate, never skipped: candidate failed", async () => {
    const repo = buildRepo(onlyBChanges);
    const corpus = new Corpus();
    seedPassesAtC(corpus, repo);
    corpus.record("AC-K1", { head: repo.c, result: "fail" });
    const { facts, requests } = await review(corpus, repo);
    expect(requests[0]).toContain("AC-K1");
    expect(factOf(facts, "AC-K1").detail).toContain("re-run: candidate failed");
  });

  it("AC-CC-1 NEGATIVE: only unstamped attestations: no candidate", async () => {
    const repo = buildRepo(onlyBChanges);
    const corpus = new Corpus();
    corpus.record("AC-K1", { head: repo.c, stamped: false });
    const { facts, requests } = await review(corpus, repo);
    expect(requests[0]).toContain("AC-K1");
    expect(factOf(facts, "AC-K1").detail).toContain("re-run: no candidate");
  });

  it("AC-CC-1 NEGATIVE: a pass stamped at a commit off H's first-parent line: no candidate", async () => {
    const repo = buildRepo(onlyBChanges);
    const corpus = new Corpus();
    corpus.record("AC-K1", { head: repo.side });
    const { facts, requests } = await review(corpus, repo);
    expect(requests[0]).toContain("AC-K1");
    expect(factOf(facts, "AC-K1").detail).toContain("re-run: no candidate");
  });

  it("AC-CC-1 NEGATIVE: a pass at an older criterion revision: no candidate", async () => {
    const repo = buildRepo(onlyBChanges);
    const corpus = new Corpus({ "AC-K1": { oracle_generation: 2 } });
    corpus.record("AC-K1", { head: repo.c, generation: 1 });
    const { facts, requests } = await review(corpus, repo);
    expect(requests[0]).toContain("AC-K1");
    expect(factOf(facts, "AC-K1").detail).toContain("re-run: no candidate");
  });

  it("AC-CC-1 NEGATIVE: a pass recorded in a task worktree (not review-recorded): no candidate", async () => {
    const repo = buildRepo(onlyBChanges);
    const corpus = new Corpus();
    corpus.record("AC-K1", { head: repo.c, review: false });
    const { facts, requests } = await review(corpus, repo);
    expect(requests[0]).toContain("AC-K1");
    expect(factOf(facts, "AC-K1").detail).toContain("re-run: no candidate");
  });

  it("AC-CC-1 NEGATIVE: a.test.ts deleted between C and H: test path missing at H", async () => {
    const repo = buildRepo({ [A_TEST]: null });
    const corpus = new Corpus();
    seedPassesAtC(corpus, repo);
    const { facts, requests } = await review(corpus, repo);
    expect(requests[0]).toContain("AC-K1");
    expect(factOf(facts, "AC-K1").detail).toContain(`re-run: test path missing at ${short(repo.h)}: ${A_TEST}`);
  });

  it("AC-CC-1 NEGATIVE: a.test.ts renamed between C and H: test path missing at H", async () => {
    const repo = buildRepo({ [A_TEST]: null, "packages/x/tests/a2.test.ts": BASE[A_TEST] as string });
    const corpus = new Corpus();
    seedPassesAtC(corpus, repo);
    const { facts } = await review(corpus, repo);
    expect(factOf(facts, "AC-K1").detail).toContain("re-run: test path missing at");
  });

  it("AC-CC-1 ERROR: the C..H diff is unreadable: every criterion re-runs and the reason says so", async () => {
    const repo = buildRepo(onlyBChanges);
    const corpus = new Corpus();
    seedPassesAtC(corpus, repo);
    const real = createGitCarryPort(repo.root, process.env);
    const unreadable: CarryPort = {
      firstParentLine: real.firstParentLine,
      reachBetween: async (): Promise<Result<never, LoreError>> => err({ code: "STORE_ERROR", message: "git diff failed" }),
    };
    const { facts, requests } = await review(corpus, repo, unreadable);
    expect(requests).toEqual([ACS]);
    expect(factOf(facts, "AC-K1").detail).toContain("re-run: diff unreadable");
    expect(factOf(facts, "AC-K2").detail).toContain("re-run: diff unreadable");
  });

  it("AC-CC-1 NEGATIVE: K3 and K4 never carry even with a pass and nothing changed (command does not qualify)", async () => {
    const repo = buildRepo({ "packages/x/src/b.ts": "export const b = 2;\n" });
    const corpus = new Corpus();
    seedPassesAtC(corpus, repo);
    const { facts, requests } = await review(corpus, repo);
    expect(requests[0]).toEqual(expect.arrayContaining(["AC-K3", "AC-K4"]));
    expect(factOf(facts, "AC-K3").detail).toContain("re-run: command does not qualify");
    expect(factOf(facts, "AC-K4").detail).toContain("re-run: command does not qualify");
  });

  it("AC-CC-1 REGRESSION: with carrying off (the pre-#553 review) K1 runs and no reason is named", async () => {
    const repo = buildRepo(onlyBChanges);
    const corpus = new Corpus();
    seedPassesAtC(corpus, repo);
    const runner = countingRunner(corpus);
    const facts = await measurePlanCriteriaAtHead(corpus.listDocs, corpus.bundle(), { commit: repo.h }, runner.port);
    expect(runner.requests).toEqual([ACS]);
    expect(factOf(facts, "AC-K1").detail).not.toContain("re-run:");
  });
});

// ─── (e) fingerprint ────────────────────────────────────────────────────────

describe("AC-CC-1 (e) fingerprint", () => {
  it("AC-CC-1 STATE: a carried attestation and a fresh one give different review fingerprints", async () => {
    const repo = buildRepo({ "packages/x/src/b.ts": "export const b = 2;\n" });
    const fingerprintOf = (ids: readonly { subject: string; id: string }[]): string =>
      milestoneFactsFingerprint({ singleFileRunIds: [], criteriaAttestationIds: ids, citedRules: [], promptVersion: "p" });

    const carriedCorpus = new Corpus();
    seedPassesAtC(carriedCorpus, repo);
    const carried = await review(carriedCorpus, repo);

    const freshCorpus = new Corpus();
    seedPassesAtC(freshCorpus, repo);
    const runner = countingRunner(freshCorpus);
    const fresh = await measurePlanCriteriaAtHead(freshCorpus.listDocs, freshCorpus.bundle(), { commit: repo.h }, runner.port);

    expect(carried.requests[0]).not.toContain("AC-K1");
    expect(runner.requests[0]).toContain("AC-K1");
    expect(fingerprintOf(carried.facts.criteria_attestation_ids ?? [])).not.toBe(fingerprintOf(fresh.criteria_attestation_ids ?? []));
  });
});

// ─── the qualifying-command parse ───────────────────────────────────────────

describe("AC-CC-1 qualifying commands", () => {
  it("AC-CC-1 HAPPY: runner invocations over test files, with -t and a final echo, qualify with their paths", () => {
    expect(testPathsOfQualifyingCommand(`bun run test:file ${A_TEST} -t "AC-1 holds" && echo 'ok: done'`)).toEqual([A_TEST]);
    expect(testPathsOfQualifyingCommand(`vitest run ${A_TEST} ${B_TEST}`)).toEqual([A_TEST, B_TEST]);
    expect(testPathsOfQualifyingCommand(`bunx vitest run ${A_TEST} && bun run test:file ${B_TEST} && echo 'x'`)).toEqual([A_TEST, B_TEST]);
  });

  it("AC-CC-1 NEGATIVE: anything else never qualifies", () => {
    const rejected = [
      "bun run typecheck",
      `bun run test:file ${A_TEST} && bun run lint`,
      `bun run test:file ${A_TEST} | tee out`,
      `bun run test:file ${A_TEST}; echo done`,
      `bun run test:file ${A_TEST} || true`,
      "bun run test:file packages/x/tests",
      `bun run test:file ${A_TEST} --reporter=json`,
      `echo 'x' && bun run test:file ${A_TEST}`,
      `bun run test:file ${A_TEST} > out.txt`,
      `bun run test:file ../escape.test.ts`,
      "echo 'only an echo'",
      `bun run test:file ${A_TEST} && bunx tsc`,
    ];
    for (const command of rejected) expect(testPathsOfQualifyingCommand(command), command).toBeUndefined();
  });
});
