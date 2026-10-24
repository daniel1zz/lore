// @spawns dist/lore
/**
 * @spec_ref spec-the-defect-channel-reaches-no-machine-but-its-own-github AC-GI-1
 *
 * RED e2e (task-skill-test-cross-machine-reachability-e2e-against-a). The
 * capability under test — `lore report-issue` filing into GitHub via
 * `GitHubIntakePort` + the `IssueReportService` rewiring, with NO local
 * `feedback.upstream.corpus_path` in the picture at all — DOES NOT EXIST YET
 * (paired implement task: task-skill-implement-githubintakeport-and-the-live-
 * filing-path). This file is written from the SPEC's Scope/Per-Field-Authority
 * sections and from the paired-impl task's own AC text, not from reading an
 * implementation that is absent by design at RED time.
 *
 * ── This is a REAL, UNCONDITIONAL network e2e (Invariant 2) ──
 * Every case below spawns the compiled `dist/lore` binary AND the real `gh`
 * binary against a REAL dedicated repo (`daniel1zz/lore-e2e-target`, plan
 * Decisions Log D-3). There is no env-var skip anywhere in this file: if `gh`
 * is unavailable or unauthenticated, `beforeAll` THROWS rather than letting
 * any test report a vacuous green — an env-gated skip that reports green is
 * the single most-recorded false-green in this repo (plan Invariant 2).
 *
 * ── NEVER `daniel1zz/lore` (plan Invariant 5) ──
 * `FORBIDDEN_REPO` below is asserted, statically AND at runtime inside the
 * one spawn helper every case routes through, to never equal `TARGET_REPO`.
 * `daniel1zz/lore` is the product's own tracker; polluting it is exactly the
 * failure D-3 exists to avoid.
 *
 * ── Never touches the repo's own `.lore/` corpus ──
 * Every fixture is a THROWAWAY `mkdtempSync` directory tracked under
 * `TMP_ROOT`, asserted (`assertUnderTmp`) to live there. `LORE_CONFIG_HOME`
 * is ALSO pointed at a throwaway dir for every spawned `dist/lore` call, so
 * the machine's real `~/.config/lore/config.yaml` (which on a dev box may
 * carry a `dashboard.projects` registry) can never be consulted — defense in
 * depth alongside the mkdtemp cwd itself never being a linked git worktree
 * (so the CLI's git-common-dir main-checkout fallback, corpus-resolution.ts's
 * "§M4 route", never fires either). Root cause of that fallback existing at
 * all, and why it is NOT a risk here, is documented at corpus-resolution.ts.
 *
 * ── Design decision: `feedback.upstream` carries `repo`, never `corpus_path`
 *    (scenario 5 / AC-GI-14's precondition) ──
 * The paired-impl task's own AC text is explicit: "Given a config with no
 * `feedback.upstream.corpus_path` AT ALL, When filing runs, Then it
 * succeeds" — i.e. `feedback.upstream` still exists as a config section (this
 * suite writes one), it simply never carries the legacy filesystem-path key.
 * `repo: <owner>/<name>` is the natural GitHub-shaped replacement for
 * `corpus_path`'s "where do I file this" role (`FeedbackConfigSchema`'s
 * `upstream` object is `.strict()` today with only `corpus_path`/`root_prd`/
 * `write_wait_ms`, so writing `repo` instead is guaranteed-red today for
 * exactly the missing-capability reason — confirmed empirically before this
 * file was written: today it exits 4 with "this needs both
 * feedback.upstream.corpus_path and feedback.upstream.root_prd set"). The
 * paired implement task is expected to converge the schema to accept this
 * shape; if it chooses a different key name, that is a deliberate interface
 * decision to make against this file (lore-tdd re-baseline discipline), not a
 * gap in this file's intent.
 *
 * ── Design decision: which fields are CLI flags vs. auto-derived ──
 * Per the spec's Scope section, the six closed front-matter fields split into
 * two classes: reporter-supplied (`severity`, `category`, `tags`) and
 * provenance/transport (`reporter_corpus`, `reporter_root_prd`,
 * `idempotency_key`). This suite therefore:
 *   - passes `--severity` / `--category` (pre-existing flags) and a NEW
 *     `--tags` flag (not yet recognised — confirmed empirically: today it is
 *     "Error: Unknown option: --tags", exit 2, the fastest and cleanest RED
 *     signal in this file, entirely unrelated to `gh` or the network);
 *   - does NOT invent `--reporter-corpus` / `--reporter-root-prd` /
 *     `--idempotency-key` flags. R1's mitigation (spec Risk Registry) states
 *     `reporter_corpus`/`reporter_root_prd` are DERIVED identity ("corpus
 *     name + root-PRD id"), and `idempotency_key` is described as
 *     "client-generated" — i.e. produced by the tool itself, not typed by a
 *     human. This suite seeds the reporter's own throwaway corpus with a
 *     real root PRD precisely so `reporter_root_prd` has a real, known value
 *     to assert against (its slug), and asserts `reporter_corpus`/
 *     `reporter_root_prd`/`idempotency_key` only by FIELD-NAME presence in
 *     the body plus (for `idempotency_key`) a structural intent/outcome
 *     pairing check — never by a value this file invented and forced through
 *     a flag.
 *
 * ── Design decision: the retry scenario proves idempotency BEHAVIOURALLY ──
 * Scenario 4 spawns `lore report-issue` a SECOND time with IDENTICAL flags
 * from the SAME reporter cwd, and asserts the SAME issue number comes back.
 * This makes no assumption about HOW the tool recognises the retry
 * (content-hash-derived key, local receipt lookup, or something else) — only
 * that the observable contract holds: same inputs, same cwd, no second issue.
 *
 * Test names embed the AC token verbatim (`AC-GI-1`) per SPEC-061's
 * matched-count discipline (`-t 'AC-GI-1'` must match >=1).
 *
 * Six-dimension coverage note: this file's SCOPE is exactly the five
 * scenarios the task doc enumerates (all reachability-shaped: HAPPY,
 * BOUNDARY-of-config-schema, and STATE/REGRESSION for the receipt-pairing and
 * retry-idempotency checks). It deliberately carries no NEGATIVE case — the
 * negative/error paths for `report-issue` (auth-absent, unconfigured,
 * cap-exceeded, etc.) are each a SEPARATE sibling AC with its own RED file
 * (AC-GI-2's `gh-runner-auth.test.ts`, AC-OOB-1's
 * `report-issue-provision.bun.test.ts`); duplicating them here would blur
 * which file is the oracle for which AC.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { basename, join, resolve } from "node:path";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { tmpdir, userInfo } from "node:os";
import { VENDOR_INTAKE_REPO } from "@lore/core";

// ─── Worktree-anchored dist/lore binary (never the main checkout's) ─────────

const WORKTREE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** Plan Decisions Log D-3: the one permanent, dedicated e2e target repo. */
const TARGET_REPO: string = "daniel1zz/lore-e2e-target";
/** Plan Invariant 5: the product's own tracker. NEVER file into this. */
/**
 * `@lore/core`'s `VENDOR_INTAKE_REPO` — the product's own tracker. ⛔ DERIVED,
 * never a second copy of the literal: the thing this suite must never touch is
 * *by definition* the address `feedback.upstream.vendor: true` resolves to, so
 * a hand-copied duplicate here could go stale against the real intake and
 * leave this guard watching an address nothing files to. The static
 * `TARGET_REPO === FORBIDDEN_REPO` self-check below now also fails loud if the
 * constant were ever pointed at this suite's dedicated e2e target.
 */
const FORBIDDEN_REPO: string = VENDOR_INTAKE_REPO;

if (TARGET_REPO === FORBIDDEN_REPO) {
  // Static self-check — cannot happen given the literals above, but a future
  // edit that accidentally aliases the two constants must fail LOUD at
  // module load, not three network calls deep.
  throw new Error("TARGET_REPO must never equal FORBIDDEN_REPO (plan Invariant 5)");
}

/**
 * Exact-repo-name check, NOT `.includes()` — `daniel1zz/lore` is a literal
 * SUBSTRING of the legitimate `TARGET_REPO` ("daniel1zz/lore-e2e-target"), so
 * a naive substring guard would refuse every real call this suite makes.
 * Matches only when `FORBIDDEN_REPO` appears as a whole path segment (its
 * neighbours, if any, are not identifier/hyphen characters).
 */
function namesForbiddenRepo(s: string): boolean {
  const escaped = FORBIDDEN_REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(s);
}

/** Every fixture path used by this suite MUST resolve under the OS tmpdir — never the repo's own `.lore/`. */
function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

if (TMP_ROOT.startsWith(WORKTREE_ROOT) || WORKTREE_ROOT.startsWith(TMP_ROOT)) {
  throw new Error(
    `Refusing to run: OS tmpdir (${TMP_ROOT}) and this worktree root (${WORKTREE_ROOT}) overlap — ` +
      `every fixture in this suite assumes they are disjoint.`,
  );
}

// ─── Isolated LORE_CONFIG_HOME for the whole suite ───────────────────────────

let isolatedConfigHome: string;

interface RunOpts {
  cwd: string;
  env?: Record<string, string>;
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Synchronous `dist/lore <args>` spawn. `CLAUDECODE=1` (agent surface, no AI
 * nesting). `LORE_CONFIG_HOME` is ALWAYS pinned to the suite's isolated dir —
 * a caller cannot accidentally omit it and fall through to the real
 * machine's global lore config.
 */
function run(args: string[], opts: RunOpts): RunResult {
  assertUnderTmp(opts.cwd);
  if (args.some((a) => namesForbiddenRepo(a))) {
    throw new Error(`Refusing to spawn dist/lore with an argument naming ${FORBIDDEN_REPO} (plan Invariant 5)`);
  }
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd: opts.cwd,
    env: {
      ...process.env,
      CLAUDECODE: "1",
      LORE_CONFIG_HOME: isolatedConfigHome,
      ...opts.env,
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

interface GhResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Synchronous REAL `gh <args>` spawn — never mocked, per Invariant 2. */
function gh(args: string[]): GhResult {
  if (args.some((a) => namesForbiddenRepo(a))) {
    throw new Error(`Refusing to spawn gh with an argument naming ${FORBIDDEN_REPO} (plan Invariant 5)`);
  }
  const proc = Bun.spawnSync(["gh", ...args]);
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

// ─── Fixture builder ──────────────────────────────────────────────────────

interface ReporterFixture {
  root: string;
  /** = basename(root) — what `lore init` names the project, i.e. the expected `reporter_corpus` identity. */
  projectName: string;
  rootPrdSlug: string;
}

/**
 * A fresh, throwaway, `lore init`'d reporter corpus — seeded with its OWN
 * root PRD (so `reporter_root_prd` has a real, known value to assert
 * against) and a `feedback.upstream` config section carrying `repo`, never
 * `corpus_path` (scenario 5). This is NOT a clone of the upstream repo, and
 * is not, itself, `daniel1zz/lore-e2e-target` — it is the REPORTER's own
 * unrelated project, exactly what "cross-machine reach" means.
 */
function makeReporter(prefix: string): ReporterFixture {
  const root = mkdtempSync(join(TMP_ROOT, `lore-reach-${prefix}-`));
  assertUnderTmp(root);
  const projectName = basename(root);

  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) {
    throw new Error(`reporter 'lore init' failed (exit ${initResult.exitCode}): ${initResult.stderr}`);
  }

  const prdResult = run(
    [
      "create",
      "prd",
      "--title",
      `Reporter project ${prefix}`,
      "--content",
      "Throwaway reporter root PRD for AC-GI-1's cross-machine reachability e2e. Not read by anything else.",
      "--json",
    ],
    { cwd: root },
  );
  if (prdResult.exitCode !== 0) {
    throw new Error(`reporter root PRD creation failed (exit ${prdResult.exitCode}): ${prdResult.stderr}`);
  }
  let rootPrdSlug: string;
  try {
    const parsed = JSON.parse(prdResult.stdout) as { ok: true; data: { slug: string } };
    rootPrdSlug = parsed.data.slug;
  } catch (e) {
    throw new Error(`failed to parse root PRD creation JSON: ${prdResult.stdout}\ncause: ${String(e)}`);
  }

  // Scenario 5 precondition: `feedback.upstream` exists, `corpus_path` never does.
  const configPath = join(root, ".lore", "config.yaml");
  const existingConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  if (existingConfig.includes("corpus_path")) {
    throw new Error(`unexpected pre-existing corpus_path in a fresh 'lore init' config: ${existingConfig}`);
  }
  patchLoreConfig(root, ["feedback:", "  upstream:", `    repo: ${TARGET_REPO}`, ""].join("\n"));

  return { root, projectName, rootPrdSlug };
}

/** Recursively reads every text-parseable file under `<root>/.lore` — the candidate surface for ReceiptLogV2's "new file path". */
function readAllLoreFiles(root: string): string[] {
  const loreDir = join(root, ".lore");
  if (!existsSync(loreDir)) return [];
  const texts: string[] = [];
  const stack: string[] = [loreDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (entry.name.endsWith(".db") || entry.name.endsWith(".db-shm") || entry.name.endsWith(".db-wal")) continue;
      try {
        texts.push(readFileSync(p, "utf8"));
      } catch {
        // reason: binary/unreadable file, not a candidate receipt log — skip.
      }
    }
  }
  return texts;
}

/**
 * Scans every JSONL-shaped line under `<root>/.lore` for objects carrying an
 * `idempotency_key` string field, bucketed by whether "intent" or "outcome"
 * appears anywhere in that line's own serialised text (format-agnostic: this
 * makes no assumption about the exact discriminant field name ReceiptLogV2
 * ends up using, only that the domain vocabulary the spec itself uses —
 * "intent" / "outcome" — appears literally, which the persisted line for a
 * TWO-PHASE record has no reason to hide).
 */
function scanReceiptLines(root: string): { intentKeys: Set<string>; outcomeKeys: Set<string> } {
  const intentKeys = new Set<string>();
  const outcomeKeys = new Set<string>();
  for (const text of readAllLoreFiles(root)) {
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      const rec = parsed as Record<string, unknown>;
      const key = rec["idempotency_key"];
      if (typeof key !== "string" || key.length === 0) continue;
      const serialized = line.toLowerCase();
      if (serialized.includes("intent")) intentKeys.add(key);
      if (serialized.includes("outcome")) outcomeKeys.add(key);
    }
  }
  return { intentKeys, outcomeKeys };
}

/** Best-effort extraction of a filed issue number from `report-issue --json`'s stdout, tolerant of an unknown future field name. */
function extractIssueNumber(stdout: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const data = (parsed as Record<string, unknown>)["data"];
  if (typeof data !== "object" || data === null) return undefined;
  const rec = data as Record<string, unknown>;
  for (const field of ["issue_number", "number", "github_issue_number"]) {
    const v = rec[field];
    if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  }
  return undefined;
}

// ─── Front-matter values this suite supplies ─────────────────────────────────

const SEVERITY_VALUE = "high";
const CATEGORY_VALUE = "e2e-reachability-probe";
const TAG_VALUES = ["e2e", "ac-gi-1", "reachability"];

function fileArgs(reporter: ReporterFixture): string[] {
  return [
    "report-issue",
    "--title",
    "AC-GI-1 cross-machine reachability probe",
    "--description",
    "Automated RED e2e (task-skill-test-cross-machine-reachability-e2e-against-a): filing must succeed " +
      "from a reporter that holds no clone of the upstream repo and no feedback.upstream.corpus_path.",
    "--expected",
    `exits 0 and prints a real issue number filed into ${TARGET_REPO}`,
    "--actual",
    "captured by this test run",
    "--severity",
    SEVERITY_VALUE,
    "--category",
    CATEGORY_VALUE,
    "--tags",
    TAG_VALUES.join(","),
    "--json",
  ];
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

let reporter: ReporterFixture;
let firstFiling: RunResult;
let firstIssueNumber: number | undefined;
const fixturesToClean: string[] = [];
const issuesToClose: number[] = [];

/**
 * The test runner replaces HOME with a throwaway directory (vitest.shared.ts::armThrowawayHome), so `gh` cannot find the
 * developer's `~/.config/gh` login and every real-network case died in `beforeAll` with "gh auth login" (#351). This suite
 * is a real-network reachability proof (Invariant 2), so it must keep using a real login: point `gh` (and the `dist/lore`
 * it spawns, which inherits `process.env`) at the real account's config directory. An explicit GH_TOKEN / GH_CONFIG_DIR
 * wins; with none of them and no config directory the `gh api user` check below still fails loud.
 */
function pointGhAtRealLogin(): void {
  if (process.env["GH_TOKEN"] || process.env["GITHUB_TOKEN"] || process.env["GH_CONFIG_DIR"]) return;
  const realConfig = join(userInfo().homedir, ".config", "gh");
  if (existsSync(realConfig)) process.env["GH_CONFIG_DIR"] = realConfig;
}

beforeAll(() => {
  pointGhAtRealLogin();
  // dist/lore is built ONCE per run by the runner (scripts/test-global-setup.ts); a test never rebuilds it (TG-24).
  if (!existsSync(DIST_LORE)) {
    throw new Error(`Expected ${DIST_LORE} to exist after the runner's one build`);
  }

  // Unconditional real-`gh` preconditions (Invariant 2: fail loud, never skip).
  const ghVersion = gh(["--version"]);
  if (ghVersion.exitCode !== 0) {
    throw new Error(
      `Real 'gh' binary is required and unconditional for this e2e (Invariant 2 forbids an env-gated skip) — ` +
        `'gh --version' failed (exit ${ghVersion.exitCode}): ${ghVersion.stderr}`,
    );
  }
  const ghUser = gh(["api", "user", "--jq", ".login"]);
  if (ghUser.exitCode !== 0) {
    throw new Error(
      `'gh' is installed but not authenticated against the real network — required, not skippable ` +
        `(exit ${ghUser.exitCode}): ${ghUser.stderr}`,
    );
  }
  const targetView = gh(["repo", "view", TARGET_REPO, "--json", "name"]);
  if (targetView.exitCode !== 0) {
    throw new Error(
      `Dedicated e2e target repo '${TARGET_REPO}' (plan D-3) is not reachable over the real network ` +
        `(exit ${targetView.exitCode}): ${targetView.stderr}`,
    );
  }

  isolatedConfigHome = mkdtempSync(join(TMP_ROOT, "lore-reach-config-home-"));
  assertUnderTmp(isolatedConfigHome);
  fixturesToClean.push(isolatedConfigHome);

  reporter = makeReporter("ac-gi-1");
  fixturesToClean.push(reporter.root);

  firstFiling = run(fileArgs(reporter), { cwd: reporter.root });
  firstIssueNumber = extractIssueNumber(firstFiling.stdout);
  if (firstIssueNumber !== undefined) issuesToClose.push(firstIssueNumber);
}, 180_000);

afterAll(() => {
  for (const n of issuesToClose) {
    try {
      gh(["issue", "close", String(n), "--repo", TARGET_REPO, "--reason", "completed"]);
    } catch {
      // reason: best-effort cleanup only — issues accumulating in the dedicated
      // target repo "matter to nothing" (plan D-3).
    }
  }
  for (const path of fixturesToClean) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup only.
    }
  }
});

// ─── AC-GI-1 ──────────────────────────────────────────────────────────────────

describe("AC-GI-1: cross-machine reachability e2e against the dedicated target repo", () => {
  it(
    "AC-GI-1 scenario 1: filing exits 0 and prints an issue number from a cwd holding no clone of the upstream repo",
    () => {
      expect(
        firstFiling.exitCode,
        `expected exit 0; got ${firstFiling.exitCode}. stdout: ${firstFiling.stdout}\nstderr: ${firstFiling.stderr}`,
      ).toBe(0);
      expect(
        firstIssueNumber,
        `expected a positive integer issue number in --json stdout; got: ${firstFiling.stdout}`,
      ).not.toBeUndefined();
      expect(firstIssueNumber as number).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "AC-GI-1 scenario 2: gh api reads back the filed issue's body carrying all six front-matter fields as supplied",
    () => {
      expect(
        firstIssueNumber,
        "AC-GI-1 precondition: scenario 1's filing must have produced an issue number before this can run",
      ).not.toBeUndefined();
      const n = firstIssueNumber as number;

      const bodyResult = gh(["api", `repos/${TARGET_REPO}/issues/${n}`, "--jq", ".body"]);
      expect(
        bodyResult.exitCode,
        `gh api readback of issue #${n} failed (exit ${bodyResult.exitCode}): ${bodyResult.stderr}`,
      ).toBe(0);
      const body = bodyResult.stdout;

      // Structural presence of all six closed field names.
      for (const fieldName of [
        "severity",
        "category",
        "tags",
        "reporter_corpus",
        "reporter_root_prd",
        "idempotency_key",
      ]) {
        expect(body, `issue body missing front-matter field '${fieldName}':\n${body}`).toContain(fieldName);
      }

      // Values this suite explicitly supplied.
      expect(body, `issue body missing supplied severity '${SEVERITY_VALUE}':\n${body}`).toContain(SEVERITY_VALUE);
      expect(body, `issue body missing supplied category '${CATEGORY_VALUE}':\n${body}`).toContain(CATEGORY_VALUE);
      for (const tag of TAG_VALUES) {
        expect(body, `issue body missing supplied tag '${tag}':\n${body}`).toContain(tag);
      }

      // Derived identity (R1 mitigation): reporter project name + reporter's own root-PRD slug.
      expect(
        body,
        `issue body missing derived reporter_corpus identity '${reporter.projectName}':\n${body}`,
      ).toContain(reporter.projectName);
      expect(
        body,
        `issue body missing derived reporter_root_prd identity '${reporter.rootPrdSlug}':\n${body}`,
      ).toContain(reporter.rootPrdSlug);
    },
    30_000,
  );

  it(
    "AC-GI-1 scenario 3: a receipt intent line AND a matching outcome line exist for one shared idempotency_key",
    () => {
      expect(
        firstIssueNumber,
        "AC-GI-1 precondition: scenario 1's filing must have produced an issue number before this can run",
      ).not.toBeUndefined();

      const { intentKeys, outcomeKeys } = scanReceiptLines(reporter.root);
      expect(
        intentKeys.size,
        `expected >=1 intent receipt line carrying idempotency_key under ${join(reporter.root, ".lore")}`,
      ).toBeGreaterThan(0);
      expect(
        outcomeKeys.size,
        `expected >=1 outcome receipt line carrying idempotency_key under ${join(reporter.root, ".lore")}`,
      ).toBeGreaterThan(0);
      const shared = [...intentKeys].filter((k) => outcomeKeys.has(k));
      expect(
        shared.length,
        `expected an intent line and an outcome line to share one idempotency_key; ` +
          `intent keys=${[...intentKeys].join(",")} outcome keys=${[...outcomeKeys].join(",")}`,
      ).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "AC-GI-1 scenario 4: a retry with identical inputs from the same cwd creates no second issue and reports the existing number",
    () => {
      expect(
        firstIssueNumber,
        "AC-GI-1 precondition: scenario 1's filing must have produced an issue number before this can run",
      ).not.toBeUndefined();

      const retryResult = run(fileArgs(reporter), { cwd: reporter.root });
      expect(
        retryResult.exitCode,
        `retry filing failed (exit ${retryResult.exitCode}): ${retryResult.stderr}`,
      ).toBe(0);
      const retryIssueNumber = extractIssueNumber(retryResult.stdout);
      expect(
        retryIssueNumber,
        `retry did not print a parseable issue number; stdout: ${retryResult.stdout}`,
      ).not.toBeUndefined();
      expect(
        retryIssueNumber,
        `retry with the SAME idempotency-deriving inputs must report the SAME issue number as the first ` +
          `filing (#${firstIssueNumber}), not create a second one — got #${retryIssueNumber}`,
      ).toBe(firstIssueNumber as number);
    },
    30_000,
  );

  it(
    "AC-GI-1 scenario 5: filing succeeds with feedback.upstream.corpus_path absent from config entirely",
    () => {
      const configText = readFileSync(join(reporter.root, ".lore", "config.yaml"), "utf8");
      expect(
        configText,
        `reporter config must never carry the legacy corpus_path key:\n${configText}`,
      ).not.toContain("corpus_path");
      expect(
        firstFiling.exitCode,
        `filing must succeed with corpus_path entirely absent from config; ` +
          `exit ${firstFiling.exitCode}, stderr: ${firstFiling.stderr}`,
      ).toBe(0);
    },
    30_000,
  );
});
