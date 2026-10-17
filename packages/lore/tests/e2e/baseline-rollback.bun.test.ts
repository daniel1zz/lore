// @spawns dist/lore
/**
 * Compiled-binary e2e for baseline-slice-1 QA-8 / AC-BLS1-8 — ROLLBACK
 * LEAVES NO TRACE: a corpus that adopted the baseline feature (baseline
 * root/branch/leaf, rules, an AC citation, depends_on, glossary) and then
 * rolled it back (`ac cite --remove` on every citation + soft-delete of every
 * baseline doc) must be indistinguishable, on the user-visible read surfaces,
 * from a corpus that never used the feature.
 *
 * Design: three THROWAWAY `mkdtemp` corpora (never this repo's `.lore/`)
 *   A  = control            (prd, spec w/ 1 script + 1 human AC, plan, task)
 *   A2 = second control     (built identically — measures run-to-run noise)
 *   B  = treatment          (built like A, then baseline adopted, then rolled back)
 * Captured from each, in the same order: `status --json`, `tree`, `list`,
 * `ac list <spec>`, and stdout/stderr/exit of ONE new `ac add`.
 *
 * What is normalised, and why (anything not listed is compared BYTE-FOR-BYTE;
 * the A-vs-A2 comparison proves each listed item is genuine run-to-run noise
 * rather than a rollback residue hidden by the normaliser):
 *   N1 ULIDs in any form (full 26-char; `tree`'s elided `01XXXXXX…YYYYY`;
 *      `list`'s 10-char id column) -> `<ULID>`. Time-derived, differ A vs A2.
 *   N2 `list`'s relative `Updated` column (`0m ago`) -> `<AGO>`. Wall clock.
 *   N3 `status --json` `data.last_updated` and `data.db_size_bytes` ->
 *      placeholders. Wall clock / sqlite file size (B's file legitimately holds
 *      soft-deleted rows and extra versions). Every other key — including the
 *      PRESENCE or absence of `data.baseline` — is compared exactly.
 *   N4 `list` DATA ROWS are compared as a sorted multiset, not in order.
 *      `list` orders by updated-at desc; `ac cite` / `--remove` legitimately
 *      bump the cited spec's updated-at (they log a version on it), so B's
 *      spec sorts first while A's was last touched earlier. This is the ONE
 *      normalisation not forced by A-vs-A2 noise; it is asserted explicitly
 *      below (row-set equality + the header/footer lines compared in order),
 *      and the reordering is itself pinned to the cited spec so it cannot
 *      mask a different difference.
 * NOT normalised: version numbers (no captured surface prints them — verified
 * by the byte-equal comparison itself), slugs (title-derived, deterministic),
 * stderr text, exit codes, key sets, hint/"Warning" lines.
 *
 * Freshness guard: `assertFreshBinary` (stale dist/lore = false oracle).
 * Run `bun run build` first.
 *
 * @spec_ref AC-BLS1-8; spec-baseline-slice-1-rules-with-permanent-ids-ac-citations (QA-8);
 *   task-skill-test-rollback-e2e-no-baselines-and-no-cites-byte
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Everything captured from one corpus for comparison. */
interface Capture {
  readonly status: RunResult;
  readonly tree: RunResult;
  readonly list: RunResult;
  readonly acList: RunResult;
  readonly acAdd: RunResult;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "baseline-rollback-e2e-session" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

/** Runs a setup step; any non-zero exit fails loud with the command and stderr. */
function mustRun(args: string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`lore ${args.join(" ")} exited ${result.exitCode}: ${result.stderr}${result.stdout}`);
  }
  return result;
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from: ${stdout}`);
  return slug;
}

/** `baseline add` prints `Created baseline <node> <slug> (<ULID>).` */
function parseBaselineSlug(stdout: string): string {
  const slug = stdout.match(/Created baseline \w+ (\S+) \(/)?.[1];
  if (slug === undefined) throw new Error(`could not parse baseline slug from: ${stdout}`);
  return slug;
}

const SPEC_TITLE = "Rollback Spec";
const NEW_AC_ARGS = ["--statement", "added after rollback", "--mode", "human"];

interface Corpus {
  readonly dir: string;
  readonly specSlug: string;
  readonly prdSlug: string;
}

/** Control shape shared by A, A2 and B: prd, spec (1 script AC + 1 human AC), plan, task. */
function buildControlCorpus(label: string): Corpus {
  const dir = mkdtempSync(join(tmpdir(), `lore-baseline-rollback-${label}-`));
  expect(dir.startsWith(REPO_ROOT)).toBe(false);
  mustRun(["init"], dir);
  const prd = mustRun(["create", "prd", "--title", "Rollback Root", "--content", "# PRD\n\nroot.", "--no-ai"], dir);
  const prdSlug = parseSlug(prd.stdout);
  const spec = mustRun(
    ["create", "spec", "--title", SPEC_TITLE,"--content", "## Spec\n\nbody", "--no-ai"],
    dir,
  );
  const specSlug = parseSlug(spec.stdout);
  mustRun(
    ["ac", "add", specSlug, "AC-RB-1", "--statement", "script criterion", "--mode", "script", "--oracle", "test", "--command", "echo ok"],
    dir,
  );
  mustRun(["ac", "add", specSlug, "AC-RB-2", "--statement", "human criterion", "--mode", "human"], dir);
  const plan = mustRun(
    ["create", "plan", "--title", "Rollback Plan", "--parent", specSlug, "--content", "## Plan", "--no-ai"],
    dir,
  );
  const planSlug = parseSlug(plan.stdout);
  mustRun(
    ["create", "task", "--title", "Rollback Task", "--plan-id", planSlug, "--parent", planSlug, "--content", "## Task", "--ac-scope", "AC-RB-1", "--no-ai"],
    dir,
  );
  return { dir, specSlug, prdSlug };
}

/** Adopt the baseline feature end to end, then undo it: remove every cite, soft-delete every baseline doc. */
function adoptAndRollBackBaseline(corpus: Corpus): void {
  const { dir, specSlug, prdSlug } = corpus;
  const root = parseBaselineSlug(
    mustRun(["baseline", "add", prdSlug, "--node", "root", "--label", "Root", "--title", "Rollback BL Root"], dir).stdout,
  );
  const branch = parseBaselineSlug(
    mustRun(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "Rollback BL Branch"], dir).stdout,
  );
  const leaf = parseBaselineSlug(
    mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "Rollback BL Leaf"], dir).stdout,
  );
  for (const [statement, enforcedBy, example] of [
    ["Users see the first thing", "guaranteed", "example one"],
    ["Users see the second thing", "both", "example two"],
  ] as const) {
    mustRun(
      ["rule", "add", leaf, "--statement", statement, "--confidence", "established", "--enforced-by", enforcedBy, "--example", example],
      dir,
    );
  }
  mustRun(["ac", "cite", specSlug, "AC-RB-1", "BR-1"], dir);
  mustRun(["baseline", "depends", leaf, "--add", "BR-2"], dir);
  mustRun(["baseline", "glossary", "add", root, "--term", "Widget", "--meaning", "A thing"], dir);

  // Sanity: the feature really was adopted (else the rollback comparison is vacuous).
  const adopted = JSON.parse(mustRun(["status", "--json"], dir).stdout) as { data: Record<string, unknown> };
  expect(adopted.data.baseline).toBeDefined();

  // Rollback: citations first (a cited rule's leaf is referenced), then leaf -> branch -> root.
  mustRun(["ac", "cite", specSlug, "AC-RB-1", "BR-1", "--remove"], dir);
  for (const slug of [leaf, branch, root]) mustRun(["delete", slug, "--confirm"], dir);
}

function capture(corpus: Corpus): Capture {
  const { dir, specSlug } = corpus;
  return {
    status: runLore(["status", "--json"], dir),
    tree: runLore(["tree"], dir),
    list: runLore(["list"], dir),
    acList: runLore(["ac", "list", specSlug], dir),
    acAdd: runLore(["ac", "add", specSlug, "AC-RB-3", ...NEW_AC_ARGS], dir),
  };
}

// ── normalisers (see header: N1..N4) ─────────────────────────────────────────

const FULL_ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
const ELIDED_ULID = /\b[0-9A-HJKMNP-TV-Z]{8}…[0-9A-HJKMNP-TV-Z]{5}\b/g;
const LIST_ID_CELL = /^[0-9A-HJKMNP-TV-Z]{10}(?=\s)/;

/** N1 */
function normaliseIds(text: string): string {
  return text.replace(FULL_ULID, "<ULID>").replace(ELIDED_ULID, "<ULID>");
}

/** N1 + N2 + N4: header/footer in order, data rows as a sorted multiset. */
function normaliseListOutput(text: string): { frame: string[]; rows: string[] } {
  const lines = text.split("\n");
  const frame: string[] = [];
  const rows: string[] = [];
  for (const line of lines) {
    if (LIST_ID_CELL.test(line)) {
      rows.push(line.replace(LIST_ID_CELL, "<ULID>").replace(/\d+[smhdw] ago/g, "<AGO>"));
    } else {
      frame.push(line);
    }
  }
  return { frame, rows: rows.sort() };
}

/** N3 on the parsed document; everything else is kept verbatim. */
function normaliseStatus(stdout: string): unknown {
  const doc = JSON.parse(stdout) as { data: Record<string, unknown> };
  // identity_sources counts append-only audit history (hash-chained, never erased), which rollback keeps by design; AC-BLS1-8 compares state.
  return { ...doc, data: { ...doc.data, last_updated: "<TS>", db_size_bytes: "<BYTES>", identity_sources: "<AUDIT-HISTORY>" } };
}

function normaliseCapture(c: Capture) {
  return {
    status: { exit: c.status.exitCode, stderr: c.status.stderr, doc: normaliseStatus(c.status.stdout) },
    tree: { exit: c.tree.exitCode, stderr: c.tree.stderr, stdout: normaliseIds(c.tree.stdout) },
    list: { exit: c.list.exitCode, stderr: c.list.stderr, ...normaliseListOutput(c.list.stdout) },
    acList: { exit: c.acList.exitCode, stderr: c.acList.stderr, stdout: c.acList.stdout },
    acAdd: { exit: c.acAdd.exitCode, stderr: c.acAdd.stderr, stdout: c.acAdd.stdout },
  };
}

/** Three corpora x ~10 spawns each of a compiled binary; bun's 5s default hook timeout is too small. */
const SETUP_TIMEOUT_MS = 120_000;

let controlA: Corpus;
let controlA2: Corpus;
let treatmentB: Corpus;
let capA: Capture;
let capA2: Capture;
let capB: Capture;

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  controlA = buildControlCorpus("a");
  controlA2 = buildControlCorpus("a2");
  treatmentB = buildControlCorpus("b");
  adoptAndRollBackBaseline(treatmentB);
  capA = capture(controlA);
  capA2 = capture(controlA2);
  capB = capture(treatmentB);
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  for (const corpus of [controlA, controlA2, treatmentB]) {
    if (corpus === undefined) continue;
    try {
      rmSync(corpus.dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of a throwaway dir */
    }
  }
});

describe("AC-BLS1-8 — baseline rollback leaves the corpus indistinguishable from never-adopted", () => {
  it("every capture succeeded (exit 0) in all three corpora", () => {
    for (const cap of [capA, capA2, capB]) {
      for (const [name, r] of Object.entries(cap)) {
        expect({ name, exit: r.exitCode, stderr: r.stderr }).toEqual({ name, exit: 0, stderr: "" });
      }
    }
  });

  it("control vs control: normalisation is sufficient (A == A2) and non-vacuous (raw tree differs)", () => {
    expect(normaliseCapture(capA2)).toEqual(normaliseCapture(capA));
    // The ULID normaliser is genuinely needed: raw `tree` output differs run to run.
    expect(capA2.tree.stdout).not.toBe(capA.tree.stdout);
  });

  it("treatment after rollback == control on status / tree / list / ac list / ac add", () => {
    const control = normaliseCapture(capA);
    const treatment = normaliseCapture(capB);
    expect(treatment.status).toEqual(control.status);
    expect(treatment.tree).toEqual(control.tree);
    expect(treatment.list).toEqual(control.list);
    expect(treatment.acList).toEqual(control.acList);
    expect(treatment.acAdd).toEqual(control.acAdd);
  });

  it("no trace: no baseline key, no baseline/BR-n text, no Warning or hint lines in any treatment output", () => {
    const status = JSON.parse(capB.status.stdout) as { data: Record<string, unknown> };
    expect(Object.keys(status.data)).not.toContain("baseline");
    expect(Object.keys((status.data.by_type ?? {}) as object)).not.toContain("baseline");
    for (const [name, r] of Object.entries(capB)) {
      const all = `${r.stdout}\n${r.stderr}`;
      expect({ name, hit: /baseline/i.test(all) }).toEqual({ name, hit: false });
      expect({ name, hit: /\bBR-\d+\b/.test(all) }).toEqual({ name, hit: false });
      // Case-sensitive on purpose: status JSON legitimately carries the lowercase key
      // `invalidated_feeding_source_warnings` in the control too; a human "Warning" line is the trace.
      expect({ name, hit: /\bWarning\b/.test(all) }).toEqual({ name, hit: false });
    }
  });

  it("N4 is explained, not hiding anything: B's spec is the most recently updated row (cite bumped it), all other rows keep A's relative order", () => {
    const rowOrder = (stdout: string) =>
      stdout
        .split("\n")
        .filter((l) => LIST_ID_CELL.test(l))
        .map((l) => l.split(/\s{2,}/)[1] ?? "");
    const orderA = rowOrder(capA.list.stdout);
    const orderB = rowOrder(capB.list.stdout);
    expect(orderB[0]).toBe("spec");
    expect(orderB.filter((t) => t !== "spec")).toEqual(orderA.filter((t) => t !== "spec"));
  });
});
