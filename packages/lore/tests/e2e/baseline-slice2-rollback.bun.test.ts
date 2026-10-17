// @spawns packages/lore/src/index.ts
/**
 * E2E for baseline-slice-2 QA-5 / AC-BLS2-11 — ROLLBACK / UPGRADE LEAVES NO TRACE: a corpus upgraded to
 * slice 2a that (a) has NO baseline documents and no gate config, or (b) has baseline documents but
 * `workflow.gates."ac-cite".mode: off`, must behave exactly like slice 1 on every pre-existing command:
 * `status --json`, `ac add` (uncited), `ac set`, `get <spec>`, `feed task-start <task>`.
 *
 * APPROACH CHOSEN: control-corpus equivalence + precise invariants. NOT a second checkout of the pre-plan
 * commit (`git worktree add --detach <tmp> ad8c8e3f`). Why: that checkout needs its own node_modules layout
 * with `@lore/*` re-pointed at it (the monorepo links by symlink), and it would pin this guard to a historical
 * commit's migrations and CLI flags — a fragile oracle that fails for reasons unrelated to AC-BLS2-11. Instead:
 *   - Control corpus A is built and driven with NO slice-2a surface engaged (no baseline docs, no gate config,
 *     so every slice-2a code path takes its "feature absent" branch); A2 repeats it to measure run-to-run noise.
 *   - Treatment (a) IS corpus A (its outputs are asserted against the invariants below), treatment (b) is
 *     corpus B = A's shape + baseline root/branch/leaf/rule + gate `mode: off` with the branch listed in
 *     `armed_branches` (so only `mode: off` can be what keeps the gate silent).
 *   - Byte-identical (after the documented normalisation) A == A2, and B == A on `ac set`, `get <spec>`,
 *     `feed task-start` and `ac add` stdout/exit. B's `ac add` stderr is EXACTLY the slice-1 one-line
 *     "cites no baseline rule" hint (present at ad8c8e3f, `reportCiteFeedbackOnAdd`; "when the corpus holds
 *     >= 1 baseline doc") — not a slice-2a trace. `status --json` legitimately gains a `baseline` block in B
 *     (slice 1): there B's block must hold the slice-1 key set (values asserted) plus ONLY the C5-documented
 *     additions (index_mismatch, exemptions_*), and every non-baseline key of A's status must be unchanged.
 *   - Invariants (every treatment output): exit 0; no `## Governing rules` section; no `AC_CITE_REQUIRED`; no
 *     `cite_gate_would_refuse` audit row (`lore audit --json`); no baseline key in A's status.
 *   - NON-VACUITY (positive controls, same script): corpus C = baseline docs + NO gate config -> mode resolves
 *     to `report` -> the same uncited `ac add` writes a would-refuse audit row; corpus D = baseline docs +
 *     `enforce` on the armed branch -> the same `ac add` is refused with AC_CITE_REQUIRED. If those detectors
 *     (audit scan, AC_CITE_REQUIRED scan) could not see a gate, the "no trace" assertions would be meaningless.
 *
 * Normalised (anything not listed is compared byte-for-byte; A-vs-A2 proves each item is genuine noise):
 *   N1 ULIDs (full / elided `01XXXXXX…YYYYY`) -> `<ULID>`.
 *   N2 ISO timestamps -> `<TS>`; relative `Ns ago` -> `<AGO>`.
 *   N3 the per-corpus temp directory path -> `<DIR>`.
 *   N5 `get`'s `Siblings:` navigation line, in B only: the fixture's own baseline root is the spec parent's
 *      sibling (pinned verbatim in the test, then masked) — slice-1 tree behaviour, not a gate trace.
 *   N4 `status --json` `last_updated` / `db_size_bytes` -> placeholders (B's file legitimately holds more rows).
 *
 * Runs the SOURCE entry (`bun run packages/lore/src/index.ts`) of THIS checkout — no compiled binary, so no
 * stale-dist oracle. Throwaway `mkdtemp` corpora only; this repo's `.lore/` is never touched.
 *
 * @spec_ref AC-BLS2-11; spec-baseline-slice-2-completeness-census-per-branch-citation (QA-5);
 *   task-skill-test-rollback-e2e-mode-off-no-baseline-docs-leaves
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { appendFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const LORE_ENTRY = new URL("../../src/index.ts", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Everything captured by the fixed script, in order. */
interface Capture {
  readonly status: RunResult;
  readonly acAdd: RunResult;
  readonly acSet: RunResult;
  readonly get: RunResult;
  readonly feed: RunResult;
  readonly audit: RunResult;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", LORE_ENTRY, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "baseline-slice2-rollback-e2e-session" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

/** Setup step; any non-zero exit fails loud with the command and its output. */
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

type GateSetup =
  | { readonly kind: "none" }
  | { readonly kind: "baseline"; readonly gate: "absent" | "off" | "enforce" };

interface Corpus {
  readonly dir: string;
  readonly specSlug: string;
  readonly taskSlug: string;
  readonly planSlug: string;
  readonly branchSlug: string | undefined;
  /** BR-id of the baseline rule, when the corpus holds baseline docs. */
  readonly ruleId: string | undefined;
}

/** prd, spec (1 script + 1 human AC), plan, task — plus optional baseline docs and gate config. */
function buildCorpus(label: string, setup: GateSetup): Corpus {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `lore-bls2-rollback-${label}-`)));
  expect(dir.startsWith(REPO_ROOT)).toBe(false);
  mustRun(["init"], dir);
  const prdSlug = parseSlug(
    mustRun(["create", "prd", "--title", "Slice2 Rollback Root", "--content", "# PRD\n\nroot.", "--no-ai"], dir).stdout,
  );
  const specSlug = parseSlug(
    mustRun(["create", "spec", "--title", "Slice2 Rollback Spec","--content", "## Spec\n\nbody", "--no-ai"], dir)
      .stdout,
  );
  mustRun(
    ["ac", "add", specSlug, "AC-S2-1", "--statement", "script criterion", "--mode", "script", "--oracle", "test", "--command", "echo ok"],
    dir,
  );
  mustRun(["ac", "add", specSlug, "AC-S2-2", "--statement", "human criterion", "--mode", "human"], dir);
  const planSlug = parseSlug(
    mustRun(["create", "plan", "--title", "Slice2 Rollback Plan", "--parent", specSlug, "--content", "## Plan", "--no-ai"], dir).stdout,
  );
  const taskSlug = parseSlug(
    mustRun(
      ["create", "task", "--title", "Slice2 Rollback Task", "--plan-id", planSlug, "--parent", planSlug, "--content", "## Task", "--ac-scope", "AC-S2-1", "--no-ai"],
      dir,
    ).stdout,
  );

  let branchSlug: string | undefined;
  let ruleId: string | undefined;
  if (setup.kind === "baseline") {
    const root = parseBaselineSlug(
      mustRun(["baseline", "add", prdSlug, "--node", "root", "--label", "Root", "--title", "S2 BL Root"], dir).stdout,
    );
    branchSlug = parseBaselineSlug(
      mustRun(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "S2 BL Branch"], dir).stdout,
    );
    const leaf = parseBaselineSlug(
      mustRun(["baseline", "add", branchSlug, "--node", "leaf", "--label", "Leaf", "--title", "S2 BL Leaf"], dir).stdout,
    );
    const ruleOut = mustRun(
      ["rule", "add", leaf, "--statement", "Users see the first thing", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one"],
      dir,
    );
    ruleId = ruleOut.stdout.match(/\bBR-\d+\b/)?.[0];
    if (ruleId === undefined) throw new Error(`could not parse rule id from: ${ruleOut.stdout}`);
    if (setup.gate !== "absent") {
      appendFileSync(
        join(dir, ".lore", "config.yaml"),
        `workflow:\n  gates:\n    ac-cite:\n      mode: ${setup.gate}\n      armed_branches:\n        - ${branchSlug}\n`,
      );
    }
  }
  return { dir, specSlug, taskSlug, planSlug, branchSlug, ruleId };
}

/** The fixed command script, identical for every corpus. */
function capture(c: Corpus): Capture {
  const { dir, specSlug, taskSlug } = c;
  return {
    status: runLore(["status", "--json"], dir),
    acAdd: runLore(["ac", "add", specSlug, "AC-S2-3", "--statement", "added uncited", "--mode", "human"], dir),
    acSet: runLore(["ac", "set", specSlug, "AC-S2-2", "--statement", "human criterion, revised"], dir),
    get: runLore(["get", specSlug], dir),
    feed: runLore(["feed", "task-start", taskSlug], dir),
    audit: runLore(["audit", "--json", "--limit", "500"], dir),
  };
}

// ── normalisers (header: N1..N4) ────────────────────────────────────────────

const FULL_ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
const ELIDED_ULID = /\b[0-9A-HJKMNP-TV-Z]{8}…[0-9A-HJKMNP-TV-Z]{5}\b/g;
const ISO_TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g;

function norm(text: string, dir: string): string {
  return text
    .split(dir)
    .join("<DIR>")
    .replace(FULL_ULID, "<ULID>")
    .replace(ELIDED_ULID, "<ULID>")
    .replace(ISO_TS, "<TS>")
    .replace(/\d+[smhdw] ago/g, "<AGO>");
}

function parseStatus(stdout: string): { data: Record<string, unknown> } {
  return JSON.parse(stdout) as { data: Record<string, unknown> };
}

/** N4 + key-set view of status (baseline block excluded so A and B stay comparable on everything else). */
function statusWithoutBaseline(stdout: string, dir: string): unknown {
  const doc = parseStatus(stdout);
  const { baseline: _baseline, ...rest } = doc.data;
  const view = { ...doc, data: { ...rest, last_updated: "<TS>", db_size_bytes: "<BYTES>" } };
  return JSON.parse(norm(JSON.stringify(view), dir));
}

/** The `ac add|set` / `get` / `feed` outputs that must be byte-identical across A, A2 and B. */
function comparable(cap: Capture, dir: string) {
  const view = (r: RunResult) => ({ exit: r.exitCode, stderr: norm(r.stderr, dir), stdout: norm(r.stdout, dir) });
  return { acAdd: view(cap.acAdd), acSet: view(cap.acSet), get: view(cap.get), feed: view(cap.feed) };
}

const SETUP_TIMEOUT_MS = 300_000;

let A: Corpus;
let A2: Corpus;
let B: Corpus;
let C: Corpus;
let D: Corpus;
let capA: Capture;
let capA2: Capture;
let capB: Capture;
let capC: Capture;
let capD: Capture;

beforeAll(() => {
  A = buildCorpus("a", { kind: "none" });
  A2 = buildCorpus("a2", { kind: "none" });
  B = buildCorpus("b-off", { kind: "baseline", gate: "off" });
  C = buildCorpus("c-report", { kind: "baseline", gate: "absent" });
  D = buildCorpus("d-enforce", { kind: "baseline", gate: "enforce" });
  capA = capture(A);
  capA2 = capture(A2);
  capB = capture(B);
  capC = capture(C);
  capD = capture(D);
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  for (const corpus of [A, A2, B, C, D]) {
    if (corpus === undefined) continue;
    try {
      rmSync(corpus.dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of a throwaway dir */
    }
  }
});

const WOULD_REFUSE = "cite_gate_would_refuse";

/** The slice-1 `ac add` hint, verbatim from ad8c8e3f's `reportCiteFeedbackOnAdd`. */
function slice1Hint(c: Corpus): string {
  return `Hint: AC-S2-3 cites no baseline rule — attach one with \`lore ac cite ${c.specSlug} AC-S2-3 BR-<n>\`\n`;
}

const SLICE1_BASELINE_STATUS_KEYS = [
  "rules_total", "rules_by_lifecycle", "rules_by_verification", "rules_uncovered", "rules_with_impl_detail",
  "acs_total", "acs_citing", "acs_uncited", "cites_dangling", "cites_to_inactive", "ambiguous_ac_ref", "registry_mismatch",
];
/** spec-baseline-slice-2 C5: the only status additions slice 2a may make. */
// RE-BASELINE (fip AC-FIP-4, BR-670): old set = the four C5 keys only; the baseline block also names the rule family
// of every counted rule (`rules_by_family`) and the AD entries the totals leave out (`debt_entries`).
const C5_STATUS_ADDITIONS = ["index_mismatch", "exemptions_active", "exemptions_expired", "exemption_ratio", "rules_by_family", "debt_entries"];

/** Literal `data` key set of `status --json` in a no-baseline corpus before slice 3a added `ac_cite` (observed, then frozen).
 *  RE-BASELINE (spec-run-identity-slice-1, status.ts): `harness_run_attribution` is the one additive key that slice made;
 *  RE-BASELINE (spec-run-only-write-identity-and-run-end-claim-release Scope 8): `identity_sources` + `orphaned_dirty`;
 *  RE-BASELINE (spec-evidence-labels-and-reds-are-honest D2, #48): `capture_source_runner_unattested_count`; the set is still compared exactly. */
const PRE_SLICE_3A_STATUS_DATA_KEYS: string[] = ["total_docs", "invalid_docs", "by_type", "by_status", "last_updated", "db_size_bytes", "invalidated_feeding_source_warnings", "exempt_plans", "ai_defaults", "open_stale_candidates", "code_anchor_specs", "verification_profiles", "pass_unfalsified_count", "unclaimed_oracle", "unredeemed_allow_missing_path_count", "capture_source_runner_count", "capture_source_self_report_count", "capture_source_runner_unattested_count", "adopted_abandoned_count", "binary_provenance", "harness_run_attribution", "identity_sources", "orphaned_dirty"];

function allOutput(cap: Capture): string {
  return Object.values(cap)
    .map((r) => `${r.stdout}\n${r.stderr}`)
    .join("\n");
}

describe("AC-BLS2-11 — mode off / no baseline docs: slice-1 behaviour, byte for byte", () => {
  for (const [name, get] of [
    ["(a) no baseline docs, no gate config", () => ({ cap: capA, corpus: A })],
    ["(b) baseline docs + gate mode off (branch armed)", () => ({ cap: capB, corpus: B })],
  ] as const) {
    describe(name, () => {
      it("every script command exits 0; stderr is empty except the slice-1 uncited-add hint (only with baseline docs)", () => {
        const { cap, corpus } = get();
        for (const [cmd, r] of Object.entries(cap)) {
          const expected = cmd === "acAdd" && corpus.branchSlug !== undefined ? slice1Hint(corpus) : "";
          expect({ cmd, exit: r.exitCode, stderr: r.stderr }).toEqual({ cmd, exit: 0, stderr: expected });
        }
      });

      it("the uncited `ac add` is accepted and never mentions AC_CITE_REQUIRED anywhere", () => {
        expect(get().cap.acAdd.stdout).toContain("AC-S2-3");
        expect(allOutput(get().cap)).not.toContain("AC_CITE_REQUIRED");
      });

      it("`feed task-start` has no `## Governing rules` section", () => {
        expect(get().cap.feed.stdout).toContain("## Objective");
        expect(get().cap.feed.stdout).not.toContain("Governing rules");
      });

      it("the audit trail holds no would-refuse row for the uncited add", () => {
        expect(get().cap.audit.stdout).toContain("create"); // audit trail is non-empty, so the scan is not vacuous
        expect(get().cap.audit.stdout).not.toContain(WOULD_REFUSE);
      });
    });
  }

  it("(a) status --json carries no baseline key", () => {
    expect(Object.keys(parseStatus(capA.status.stdout).data)).not.toContain("baseline");
  });

  it("(a) status --json has no ac_cite key and its data key set equals the pre-slice-3a literal list", () => {
    const keys = Object.keys(parseStatus(capA.status.stdout).data);
    expect(keys).not.toContain("ac_cite");
    expect([...keys].sort()).toEqual([...PRE_SLICE_3A_STATUS_DATA_KEYS].sort());
  });

  it("control vs control: normalisation is sufficient (A == A2) and non-vacuous (raw `get` differs)", () => {
    expect(comparable(capA2, A2.dir)).toEqual(comparable(capA, A.dir));
    expect(statusWithoutBaseline(capA2.status.stdout, A2.dir)).toEqual(statusWithoutBaseline(capA.status.stdout, A.dir));
    expect(capA2.get.stdout).not.toBe(capA.get.stdout);
  });

  it("(a)/(b) vs control: ac add, ac set, get <spec>, feed task-start are byte-identical", () => {
    const control = comparable(capA, A.dir);
    const treatment = comparable(capB, B.dir);
    expect(treatment.acAdd.stdout).toEqual(control.acAdd.stdout);
    expect(treatment.acAdd.exit).toEqual(control.acAdd.exit);
    expect(treatment.acAdd.stderr).toEqual(slice1Hint(B));
    expect(treatment.acSet).toEqual(control.acSet);
    // N5 (slice 3b, BR-1): a spec takes no parent, so `get <spec>` lists no siblings in either corpus and the
    // fixture's own baseline root no longer shows up beside it - the outputs are now plainly byte-identical.
    expect(treatment.get.stdout).toContain("Siblings: (none)\n");
    expect(control.get.stdout).toContain("Siblings: (none)\n");
    expect(treatment.get.stdout).toEqual(control.get.stdout);
    expect({ exit: treatment.get.exit, stderr: treatment.get.stderr }).toEqual({ exit: control.get.exit, stderr: control.get.stderr });
    expect(treatment.feed).toEqual(control.feed);
  });

  it("(b) status --json: only the baseline block and ac_cite are added; its keys are the slice-1 set plus the C5 additions", () => {
    const dataB = parseStatus(capB.status.stdout).data;
    const keysA = Object.keys(parseStatus(capA.status.stdout).data);
    // slice 3a group E adds `ac_cite` whenever baseline docs exist (BL-8), so B legitimately carries it too.
    // RE-BASELINE (slice 3b, BR-1011 / AC-BLS3B-3): old assertion `["baseline", "ac_cite"]`; with baseline docs `status --json`
    // also carries the spec citation census (`specs_without_citation`, `specs_with_parent`); A (no baseline docs) still lacks all four.
    expect(Object.keys(dataB).filter((k) => !keysA.includes(k))).toEqual([
      "baseline",
      "ac_cite",
      "specs_without_citation",
      "specs_with_parent",
    ]);
    expect(keysA.filter((k) => !(k in dataB))).toEqual([]);
    const block = dataB.baseline as Record<string, unknown>;
    expect(Object.keys(block).sort()).toEqual([...SLICE1_BASELINE_STATUS_KEYS, ...C5_STATUS_ADDITIONS].sort());
    expect(block).toMatchObject({ rules_total: 1, acs_total: 2, acs_citing: 0, acs_uncited: 2, cites_dangling: 0, index_mismatch: 0, exemptions_active: 0 });
  });
});

describe("AC-BLS2-11 — non-vacuity: the same script DOES show the gate when it is on", () => {
  it("baseline docs + no gate config resolves to report: the uncited add passes AND leaves a would-refuse audit row", () => {
    expect(capC.acAdd.exitCode).toBe(0);
    expect(capC.audit.stdout).toContain(WOULD_REFUSE);
  });

  it("baseline docs + enforce on the armed branch refuses the same uncited add with AC_CITE_REQUIRED", () => {
    expect(capD.acAdd.exitCode).not.toBe(0);
    expect(`${capD.acAdd.stdout}${capD.acAdd.stderr}`).toContain("AC_CITE_REQUIRED");
  });

  it("the no-trace scan is not blind: report mode's output differs from mode off's audit", () => {
    expect(capC.audit.stdout).not.toBe(capB.audit.stdout);
  });
});

// ── AC-BLS2-11 x BL-15: `feed session-resume` must not grow a rule-diff block without governing baseline rules ──

const RULE_DIFF_HEADER = "Governing rules since claim";
const RULES_UNCHANGED = "governing rules unchanged since claim";

/** Claims the corpus' task and prints the session-resume feed for its plan. */
function claimAndResume(c: Corpus, specCitesRule = false): RunResult {
  // reason: BR-1007 - corpora A / A2 / B hold a spec that cites NO rule (that is the premise: no governing
  // rules, hence no rule-diff), and an uncited spec can no longer be approved through any verb. The approved
  // state is written directly, the shape a corpus holding a pre-BR-1007 approved spec has. E's spec cites a
  // live rule, so it goes through the real verb.
  if (specCitesRule) {
    mustRun(["approve", c.specSlug, "--override-no-judgment"], c.dir);
  } else {
    const db = new Database(join(c.dir, ".lore", "lore.db"));
    try {
      db.query("UPDATE docs SET status = 'approved' WHERE slug = ?").run(c.specSlug);
    } finally {
      db.close();
    }
  }
  mustRun(["approve", c.planSlug, "--override-no-judgment"], c.dir);
  mustRun(["claim", c.taskSlug], c.dir);
  return mustRun(["feed", "session-resume", "--plan", c.planSlug], c.dir);
}

describe("AC-BLS2-11 — BL-15: `feed session-resume` carries no rule-diff trace without governing baseline rules", () => {
  let resumeA: RunResult;
  let resumeA2: RunResult;
  let resumeB: RunResult;
  let E: Corpus;
  let resumeE: RunResult;

  beforeAll(() => {
    resumeA = claimAndResume(A);
    resumeA2 = claimAndResume(A2);
    resumeB = claimAndResume(B);
    E = buildCorpus("e-cited", { kind: "baseline", gate: "absent" });
    mustRun(["ac", "cite", E.specSlug, "AC-S2-1", E.ruleId as string], E.dir);
    resumeE = claimAndResume(E, true);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    if (E !== undefined) rmSync(E.dir, { recursive: true, force: true });
  });

  it("(a) no baseline docs: a claimed task's resume prints no rule-diff block and no unchanged line", () => {
    expect(resumeA.exitCode).toBe(0);
    expect(resumeA.stdout.length).toBeGreaterThan(0);
    expect(`${resumeA.stdout}${resumeA.stderr}`).not.toContain(RULE_DIFF_HEADER);
    expect(`${resumeA.stdout}${resumeA.stderr}`).not.toContain(RULES_UNCHANGED);
  });

  it("(a) is byte-identical to the control run after normalisation", () => {
    expect(norm(resumeA2.stdout, A2.dir)).toEqual(norm(resumeA.stdout, A.dir));
  });

  it("(b) baseline docs but the task's spec cites no rule: still no rule-diff block", () => {
    expect(resumeB.exitCode).toBe(0);
    expect(`${resumeB.stdout}${resumeB.stderr}`).not.toContain(RULE_DIFF_HEADER);
    expect(`${resumeB.stdout}${resumeB.stderr}`).not.toContain(RULES_UNCHANGED);
  });

  it("non-vacuity: baseline docs + a cited rule + a claimed task DOES print the block", () => {
    expect(resumeE.exitCode).toBe(0);
    expect(resumeE.stdout).toContain(RULE_DIFF_HEADER);
    expect(resumeE.stdout).toContain(RULES_UNCHANGED);
  });
});
