// @spawns dist/lore
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries
 * @task task-skill-refactor-gs-t5-lore-issues-live-only-push-only-sync
 *
 * The live read surface: `lore issues` against a GitHub-configured `feedback.upstream` reads the complete live
 * listing, joins it with the CARRIERS (work naming an issue in `extra.issues`) into one derived status per issue,
 * renders every flag, and never writes. Moved here from the mirror model (`not_ingested` rows, the local-only
 * boundary note, `--verify`, `extra.issue_report` seeds): those subjects are retired with the mirror task; an
 * issue without a carrier is now simply `open`.
 *
 * Every assertion spawns the COMPILED `dist/lore` (never `bun run src/index.ts`) and reads real exit codes and
 * stdout against a payload-serving `gh` stub (`payloadGhStubDir`), never the network. Corpora are throwaway
 * (`mkdtemp`), opened through `createApp` so carrier plans can be written through the service without a
 * `lore init` spawn; carriers that must be ARCHIVED go through a bare ungated CorpusService.
 *
 * Six-dimension note:
 *   HAPPY       three listed issues, no carriers: exit 0, three rows, all `open`, source github.
 *   NEGATIVE    `--open` and `--resolved` return disjoint, non-empty row sets (a flag that is ignored fails).
 *   BOUNDARY    `--severity` selects a strict non-empty subset of `--all` and `total` is the filtered count.
 *   STATE       open+live carrier -> adopted; open+archived carrier -> fixed (close pending); closed+archived
 *               carrier -> fixed; closed with no carrier -> closed (unverified).
 *   ERROR       `--local`/`--verify` are unknown switches: exit 2.
 *   REGRESSION  a real run leaves the document count and the PRD's version-log count byte-equal.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assembleIssueBody, type CreateDocInput } from "@lore/core";
import { createApp, type App } from "../../../src/app.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { assertFreshBinary } from "../helpers/assert-fresh-binary";
import { cleanupPayloadGhStubDir, payloadGhStubDir, type PayloadGhStubIssue } from "../helpers/payload-gh-stub";
import { actedStore, liveAmbient, liveWriteContext } from "../../live-invocation.js";

// ─── Worktree-anchored dist/lore binary (never the main checkout's) ─────────

const WORKTREE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** Fake, never-dialed repo string — `gh` is fully stubbed, so this never touches the network. */
const FAKE_REPO = "acme-test/read-surface-defect-channel";
/** The join key's first half: the stub's `gh api repos/<repo>` response. */
const STUB_REPO_ID = 727_384_951;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface ListedRow {
  readonly number: number;
  readonly state: string;
  readonly status: string;
  readonly carriers: readonly string[];
  readonly severity?: string;
  readonly category?: string;
}

interface ListPayload {
  readonly source: string;
  readonly total: number;
  readonly reports: readonly ListedRow[];
}

let isolatedConfigHome: string;

/** Synchronous `dist/lore <args>` spawn against a specific throwaway corpus + gh stub. */
function run(args: string[], corpusRoot: string, ghStubDir: string): RunResult {
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd: corpusRoot,
    env: {
      ...process.env,
      CLAUDECODE: "1",
      LORE_CONFIG_HOME: isolatedConfigHome,
      PATH: ghStubDir,
      LORE_ACTOR: "agent:gs-t5-read-surface-e2e",
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function listed(args: string[], corpusRoot: string, ghStubDir: string): ListPayload {
  const result = run(args, corpusRoot, ghStubDir);
  expect(result.exitCode, `'${args.join(" ")}' — stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  return (JSON.parse(result.stdout) as { data: ListPayload }).data;
}

/**
 * Builds a throwaway `.lore/lore.db` directly via `createApp` (SQLiteStore auto-migrates a fresh file) and writes
 * the `project:` + `feedback.upstream.repo` config `lore init` would. The caller MUST close the returned `App`
 * before spawning `dist/lore` against the same file.
 */
function makeThrowawayCorpus(prefix: string): { app: App; corpusRoot: string } {
  const corpusRoot = mkdtempSync(join(TMP_ROOT, `lore-gs-read-${prefix}-`));
  const loreDir = join(corpusRoot, ".lore");
  mkdirSync(loreDir, { recursive: true });
  // reason: LoreConfigSchema requires a top-level `project:` (no defaults); omitting it makes the config parse fail and
  // `feedback.upstream` read back as UNCONFIGURED with no error surfaced — a false red this block avoids.
  writeFileSync(
    join(loreDir, "config.yaml"),
    ["project:", "  name: lore-gs-read-surface-fixture", "  author: lore-gs-read-surface-fixture", "feedback:", "  upstream:", `    repo: ${FAKE_REPO}`, ""].join("\n"),
  );
  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
  return { app, corpusRoot };
}

/** A bare, ungated CorpusService over the corpus file, for seeding carriers (the caller closes the store). */
function bareService(corpusRoot: string): { cs: CorpusService; close: () => void } {
  const store = actedStore(new SQLiteStore(join(corpusRoot, ".lore", "lore.db")));
  return { cs: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))), close: () => store.close() };
}

/** Seeds a PLAN carrier naming `number`, optionally walked to `archived`. Returns its slug. */
async function seedPlanCarrier(corpusRoot: string, title: string, number: number, archived: boolean): Promise<string> {
  const { cs, close } = bareService(corpusRoot);
  try {
    const created = await cs.create({
      type: "plan",
      title,
      content: "## Overview\n\nCarrier body.",
      extra: { issues: [{ repo_id: STUB_REPO_ID, number }] },
    } as CreateDocInput);
    if (!created.ok) throw new Error(`carrier create failed: ${JSON.stringify(created.error)}`);
    if (archived) {
      for (const status of ["approved", "active", "archived"] as const) {
        const moved = await cs.set(created.value.id, { status });
        if (!moved.ok) throw new Error(`carrier -> ${status} failed: ${JSON.stringify(moved.error)}`);
      }
    }
    return created.value.slug;
  } finally {
    close();
  }
}

/** `lore list --json`'s document count and `lore log <slug> --json`'s version-row count. */
function countDocuments(corpusRoot: string, ghStubDir: string): number {
  const result = run(["list", "--json"], corpusRoot, ghStubDir);
  if (result.exitCode !== 0) throw new Error(`'lore list --json' failed (exit ${result.exitCode}): ${result.stderr}`);
  const data = (JSON.parse(result.stdout) as { data: unknown }).data as { docs?: unknown[]; documents?: unknown[] } | unknown[];
  return Array.isArray(data) ? data.length : (data.docs ?? data.documents ?? []).length;
}

function countVersions(corpusRoot: string, ghStubDir: string, slug: string): number {
  const result = run(["log", slug, "--json"], corpusRoot, ghStubDir);
  if (result.exitCode !== 0) throw new Error(`'lore log ${slug} --json' failed (exit ${result.exitCode}): ${result.stderr}`);
  return (JSON.parse(result.stdout) as { data: { total: number } }).data.total;
}

const stubIssues = (numbers: readonly number[]): PayloadGhStubIssue[] =>
  numbers.map((n) => ({ number: n, title: `Fixture issue #${n}`, state: "open" as const, body: "" }));

const stubDirFor = (issues: readonly PayloadGhStubIssue[]): string =>
  payloadGhStubDir({ repoId: STUB_REPO_ID, existingIssues: [...issues], createdNumber: 1, createdUrl: "https://example.invalid/never-created" });

beforeAll(() => {
  // dist/lore is built ONCE per run by the runner (scripts/test-global-setup.ts); a test never rebuilds it (TG-24).
  assertFreshBinary(DIST_LORE, [join(WORKTREE_ROOT, "packages", "lore", "src"), join(WORKTREE_ROOT, "packages", "core", "src")]);
  isolatedConfigHome = mkdtempSync(join(TMP_ROOT, "lore-gs-read-config-home-"));
}, 180_000);

afterAll(() => {
  rmSync(isolatedConfigHome, { recursive: true, force: true });
});

describe("lore issues reaches the GitHub shape", () => {
  let corpusRoot: string;
  let ghStubDir: string;

  beforeAll(() => {
    const built = makeThrowawayCorpus("shape");
    corpusRoot = built.corpusRoot;
    built.app.close();
    ghStubDir = stubDirFor(stubIssues([61_001, 61_002, 61_003]));
  });

  afterAll(() => {
    cleanupPayloadGhStubDir(ghStubDir);
    rmSync(corpusRoot, { recursive: true, force: true });
  });

  it("HAPPY: real dist/lore issues exits 0 and prints exactly 3 rows, each open (no work names them), against a 3-issue stub", () => {
    const data = listed(["issues", "--json"], corpusRoot, ghStubDir);
    expect(data.source).toBe("github");
    expect(data.total).toBe(3);
    expect(data.reports.map((r) => r.status)).toEqual(["open", "open", "open"]);
    expect(data.reports.every((r) => r.carriers.length === 0)).toBe(true);
  }, 60_000);

  it("ERROR: --local and --verify are unknown switches (exit 2)", () => {
    for (const flag of ["--local", "--verify"]) {
      const result = run(["issues", flag], corpusRoot, ghStubDir);
      expect(result.exitCode, `${flag}: ${result.stderr}`).toBe(2);
    }
  }, 60_000);
});

describe("an issue's status joins the live listing with its carriers", () => {
  const ADOPTED = 62_001;
  const PENDING = 62_002;
  const FIXED = 62_003;
  const UNVERIFIED = 62_004;
  const BARE = 62_005;
  let corpusRoot: string;
  let ghStubDir: string;
  const carrierSlugs: Record<number, string> = {};

  beforeAll(async () => {
    const built = makeThrowawayCorpus("status");
    corpusRoot = built.corpusRoot;
    built.app.close();
    carrierSlugs[ADOPTED] = await seedPlanCarrier(corpusRoot, "Live carrier", ADOPTED, false);
    carrierSlugs[PENDING] = await seedPlanCarrier(corpusRoot, "Archived carrier of an open issue", PENDING, true);
    carrierSlugs[FIXED] = await seedPlanCarrier(corpusRoot, "Archived carrier of a closed issue", FIXED, true);
    ghStubDir = stubDirFor([
      { number: ADOPTED, title: "adopted probe", state: "open", body: "" },
      { number: PENDING, title: "pending probe", state: "open", body: "" },
      { number: FIXED, title: "fixed probe", state: "closed", body: "" },
      { number: UNVERIFIED, title: "unverified probe", state: "closed", body: "" },
      { number: BARE, title: "bare probe", state: "open", body: "" },
    ]);
  });

  afterAll(() => {
    cleanupPayloadGhStubDir(ghStubDir);
    rmSync(corpusRoot, { recursive: true, force: true });
  });

  it("STATE: each row's status follows GitHub state x carriers, and names the carriers that produced it", () => {
    const data = listed(["issues", "--all", "--json"], corpusRoot, ghStubDir);
    const byNumber = new Map(data.reports.map((r) => [r.number, r]));
    expect(byNumber.get(ADOPTED)).toMatchObject({ status: "adopted", carriers: [carrierSlugs[ADOPTED]] });
    expect(byNumber.get(PENDING)).toMatchObject({ status: "fixed (close pending)", carriers: [carrierSlugs[PENDING]] });
    expect(byNumber.get(FIXED)).toMatchObject({ status: "fixed", carriers: [carrierSlugs[FIXED]] });
    expect(byNumber.get(UNVERIFIED)).toMatchObject({ status: "closed (unverified)", carriers: [] });
    expect(byNumber.get(BARE)).toMatchObject({ status: "open", carriers: [] });
  }, 60_000);
});

describe("lore issues mutates nothing", () => {
  let corpusRoot: string;
  let ghStubDir: string;
  let prdSlug: string;

  beforeAll(async () => {
    const built = makeThrowawayCorpus("readonly");
    corpusRoot = built.corpusRoot;
    const prd = await built.app.corpusService.create({
      type: "prd",
      title: "read-only fixture root PRD",
      content: "Throwaway root PRD whose version log this test checks for a byte-equal count before/after a real read.",
    });
    if (!prd.ok) throw new Error(`fixture PRD creation failed: ${JSON.stringify(prd.error)}`);
    prdSlug = prd.value.slug;
    built.app.close();
    ghStubDir = stubDirFor(stubIssues([64_001, 64_002, 64_003]));
  });

  afterAll(() => {
    cleanupPayloadGhStubDir(ghStubDir);
    rmSync(corpusRoot, { recursive: true, force: true });
  });

  it("REGRESSION: the document count and the PRD's version-log count are byte-equal before and after a real run", () => {
    const docsBefore = countDocuments(corpusRoot, ghStubDir);
    const versionsBefore = countVersions(corpusRoot, ghStubDir, prdSlug);

    const data = listed(["issues", "--json"], corpusRoot, ghStubDir);
    expect(data.total).toBe(3); // sanity: the read really listed three issues

    // The discriminating assertion: a read path that minted a document for even one listed issue raises the count.
    expect(countDocuments(corpusRoot, ghStubDir)).toBe(docsBefore);
    expect(countVersions(corpusRoot, ghStubDir, prdSlug)).toBe(versionsBefore);
  }, 60_000);
});

describe("the read flags filter, they are not merely accepted", () => {
  const OPEN_HIGH = 65_001;
  const CLOSED_CRITICAL = 65_002;
  let corpusRoot: string;
  let ghStubDir: string;

  const bodyWith = (severity: string, category: string, key: string): string =>
    assembleIssueBody(
      { severity: severity as "critical" | "high" | "medium" | "low", category, tags: [], reporter_corpus: "fixture", reporter_root_prd: "prd-fixture", idempotency_key: key },
      "fixture description",
    );

  beforeAll(async () => {
    const built = makeThrowawayCorpus("flags");
    corpusRoot = built.corpusRoot;
    built.app.close();
    await seedPlanCarrier(corpusRoot, "Carrier of the open one", OPEN_HIGH, false);
    // Two issues on OPPOSITE sides of every filter below: unfinished/high/regression vs finished/critical/security.
    ghStubDir = stubDirFor([
      { number: OPEN_HIGH, title: "open high regression", state: "open", body: bodyWith("high", "regression", "k-65001") },
      { number: CLOSED_CRITICAL, title: "closed critical security", state: "closed", body: bodyWith("critical", "security", "k-65002") },
    ]);
  });

  afterAll(() => {
    cleanupPayloadGhStubDir(ghStubDir);
    rmSync(corpusRoot, { recursive: true, force: true });
  });

  it("HAPPY: --open/--resolved/--all/--severity/--category each exit 0", () => {
    for (const args of [
      ["issues", "--open", "--json"],
      ["issues", "--resolved", "--json"],
      ["issues", "--all", "--json"],
      ["issues", "--severity", "critical", "--json"],
      ["issues", "--category", "security", "--json"],
    ]) {
      const result = run(args, corpusRoot, ghStubDir);
      expect(result.exitCode, `'${args.join(" ")}' — stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    }
  }, 120_000);

  it("NEGATIVE: --open and --resolved return different, non-empty, disjoint row sets", () => {
    const open = listed(["issues", "--open", "--json"], corpusRoot, ghStubDir);
    const resolved = listed(["issues", "--resolved", "--json"], corpusRoot, ghStubDir);
    // Non-vacuous: both sets non-empty, so a filter that always returns [] cannot satisfy the disjointness check.
    expect(open.total).toBeGreaterThan(0);
    expect(resolved.total).toBeGreaterThan(0);
    expect(open.reports.map((r) => r.number)).toEqual([OPEN_HIGH]);
    expect(resolved.reports.map((r) => r.number)).toEqual([CLOSED_CRITICAL]);
  }, 60_000);

  it("BOUNDARY: --severity selects a strict, non-empty subset of --all and total is the filtered count", () => {
    const all = listed(["issues", "--all", "--json"], corpusRoot, ghStubDir);
    expect(all.total).toBe(2);
    const critical = listed(["issues", "--all", "--severity", "critical", "--json"], corpusRoot, ghStubDir);
    expect(critical.total).toBe(1);
    expect(critical.total).toBeLessThan(all.total);
    expect(critical.reports[0]).toMatchObject({ number: CLOSED_CRITICAL, severity: "critical", category: "security" });
    const category = listed(["issues", "--all", "--category", "regression", "--json"], corpusRoot, ghStubDir);
    expect(category.reports.map((r) => r.number)).toEqual([OPEN_HIGH]);
  }, 60_000);

  it("ERROR: --open together with --resolved is a usage error (exit 2)", () => {
    const result = run(["issues", "--open", "--resolved"], corpusRoot, ghStubDir);
    expect(result.exitCode).toBe(2);
  }, 60_000);
});
