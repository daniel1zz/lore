/**
 * AC-ICL-7 e2e suite (spec-issue-closure-loop-computed-resolution-agent-reachable
 * D6) — consumer-side `lore report-issue --list` must report the DEFECT's
 * COMPUTED resolution, not the upstream issue task's raw doc status.
 *
 * The decisive case this whole task exists for: an upstream fix that ships
 * as a SEPARATE archived doc (here: a spec) carrying a `resolves` edge to
 * the filed issue task. Before D6, `--list` read the issue task's own
 * (still-`draft`) status and printed `draft` — the exact shape that
 * misreported to a real consuming project for 9 days. After D6, the row
 * must print `fixed`.
 *
 * Every fixture is a THROWAWAY `mkdtempSync` corpus pair (upstream +
 * consumer) — NEVER the repo's own `.lore/` (root `CLAUDE.md`'s "never
 * write to the repo's own `.lore/` from tests" rule; every corpus path used
 * below is asserted to live under `os.tmpdir()`). Both sides touch
 * `SQLiteStore`, so this runs under `bun test` (`.bun.test.ts`), spawning
 * the compiled `dist/lore` binary — `beforeAll` runs `bun run build` ONCE
 * from THIS WORKTREE'S root before any test spawns it (stale-binary
 * false-oracle vector, root `CLAUDE.md`).
 *
 * Test names embed the literal `AC-ICL-7` token so `-t 'AC-ICL-7'` matches
 * every case (SPEC-061 matched-count discipline).
 *
 * Six-dimension coverage:
 *   HAPPY:      fixed (resolves edge to an archived doc), rejected (reason
 *               echoed), wontfix (reason echoed)
 *   BOUNDARY:   resolves edge exists but its source doc is not yet terminal
 *               (draft) — resolution stays "resolving", not "fixed"
 *   NEGATIVE:   unconfigured `feedback.upstream` — byte-for-byte regression
 *               pin (SPEC-072 AC-072-2 wording)
 *   ERROR:      whole upstream corpus removed — every row degrades to
 *               "unreachable", no crash (SPEC-072 AC-072-10, preserved)
 *   STATE:      a receipt referencing a doc id that never existed upstream
 *               (fabricated receipt line) — degrades to "unreachable" with
 *               the "doc no longer found" warning (SPEC-072 AC-072-10,
 *               preserved)
 *   REGRESSION: a freshly-filed report with NO resolves edge and NO
 *               explicit resolution reports "open" — never misreads as
 *               "fixed" or leaks the raw "draft" doc status as the primary
 *               signal
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D6,
 *   §Acceptance Criteria AC-ICL-7;
 *   task-p2-consumer-report-issue-list-reports-computed-resolution.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ─── Worktree-anchored dist/lore binary (never the main checkout's) ─────────

const WORKTREE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** Every fixture path used by this suite MUST resolve under the OS tmpdir — never the repo's own `.lore/`. */
function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Synchronous `dist/lore <args>` spawn — CLAUDECODE=1 (agent surface, no AI nesting). */
function run(args: string[], opts: { cwd: string; env?: Record<string, string> }): RunResult {
  assertUnderTmp(opts.cwd);
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, CLAUDECODE: "1", ...opts.env },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** `run` + `--json`, parsed. Throws with full stdio context on a non-JSON response. */
function runJson<T>(args: string[], opts: { cwd: string; env?: Record<string, string> }): { result: RunResult; data: T } {
  const result = run([...args, "--json"], opts);
  try {
    return { result, data: JSON.parse(result.stdout) as T };
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from 'lore ${args.join(" ")}' (exit ${result.exitCode}):\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}\ncause: ${String(e)}`,
    );
  }
}

// ─── Twin-corpus fixture builders (mirrors tests/unit/service/issue-report-cross-corpus.bun.test.ts) ──

interface UpstreamFixture {
  root: string;
  rootPrdId: string;
  rootPrdSlug: string;
}

/** Fresh mkdtemp corpus, `lore init`'d, with a seeded root PRD. */
function makeUpstream(prefix: string): UpstreamFixture {
  const root = mkdtempSync(join(TMP_ROOT, `lore-icl7-upstream-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) {
    throw new Error(`upstream 'lore init' failed: ${initResult.stderr}`);
  }
  const { result, data } = runJson<{ ok: true; data: { id: string; slug: string } }>(
    ["create", "prd", "--title", `Upstream Root PRD (${prefix})`, "--content", "root prd content"],
    { cwd: root },
  );
  if (result.exitCode !== 0) {
    throw new Error(`upstream root PRD creation failed: ${result.stderr}`);
  }
  return { root, rootPrdId: data.data.id, rootPrdSlug: data.data.slug };
}

/** Fresh mkdtemp corpus, `lore init`'d, with no `feedback.upstream` configured yet. */
function makeConsumer(prefix: string): string {
  const root = mkdtempSync(join(TMP_ROOT, `lore-icl7-consumer-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) {
    throw new Error(`consumer 'lore init' failed: ${initResult.stderr}`);
  }
  return root;
}

/** Appends a `feedback.upstream` stanza onto a consumer's config.yaml. */
function configureFeedbackUpstream(consumerRoot: string, upstreamRoot: string, rootPrdIdentity: string): void {
  assertUnderTmp(consumerRoot);
  appendFileSync(
    join(consumerRoot, ".lore", "config.yaml"),
    ["feedback:", "  upstream:", `    corpus_path: ${upstreamRoot}`, `    root_prd: ${rootPrdIdentity}`, ""].join(
      "\n",
    ),
  );
}

/** A fully-wired twin: upstream (seeded root PRD) + consumer (feedback.upstream configured). */
function makeTwin(prefix: string): { upstream: UpstreamFixture; consumerRoot: string } {
  const upstream = makeUpstream(prefix);
  const consumerRoot = makeConsumer(prefix);
  configureFeedbackUpstream(consumerRoot, upstream.root, upstream.rootPrdSlug);
  return { upstream, consumerRoot };
}

/**
 * Disables the upstream corpus's `spec-promote`/`review-judgment` gates so a
 * throwaway fixture can walk a "fixing spec" doc through
 * draft→approved→archived with zero unrelated ceremony (no AC authoring, no
 * AI-judge review) — this suite's concern is D6's consumer-side resolution
 * read, not `spec-promote`'s own gate behavior (covered elsewhere).
 *
 * APPENDS (never overwrites) the config file — `lore init`'s own
 * `project:{name,author}` stanza is REQUIRED by `LoreConfigSchema`; a bare
 * `writeFileSync` replacement drops it, `loadConfig` then fails validation,
 * and `loadLoreApp()` silently falls back to an undefined config (default:
 * every gate enabled) — the disable would silently never take effect.
 * Verified empirically against this exact schema before writing this suite.
 */
function disableUpstreamGates(upstreamRoot: string): void {
  assertUnderTmp(upstreamRoot);
  appendFileSync(
    join(upstreamRoot, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      '    "spec-promote":',
      "      enabled: false",
      '    "review-judgment":',
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

const fixturesToClean: string[] = [];
function track(...paths: string[]): void {
  for (const p of paths) fixturesToClean.push(p);
}

interface ListRow {
  upstream_doc_id: string;
  title: string;
  at: string;
  status: string;
  doc_status?: string;
  rejection_reason?: string;
  warnings?: string[];
}

/** Files one report from the consumer and returns its upstream doc id. */
function fileReport(consumerRoot: string, title: string, actor: string): string {
  const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
    ["report-issue", "--title", title, "--description", "desc", "--expected", "exit 0", "--actual", "exit 4"],
    { cwd: consumerRoot, env: { LORE_ACTOR: actor } },
  );
  expect(result.exitCode).toBe(0);
  return data.data.upstream_doc_id;
}

/** Consumer-side `report-issue --list --json`, returning the parsed rows. */
function listRows(consumerRoot: string): { result: RunResult; rows: ListRow[] } {
  const { result, data } = runJson<{ ok: true; data: { rows: ListRow[] } }>(["report-issue", "--list"], {
    cwd: consumerRoot,
  });
  return { result, rows: data.data.rows };
}

/** Creates an upstream "fixing" spec (child of the root PRD), draft. */
function createFixingSpec(upstreamRoot: string, rootPrdId: string, title: string): { id: string; slug: string } {
  const { result, data } = runJson<{ ok: true; data: { id: string; slug: string } }>(
    [
      "create",
      "spec",
      "--title",
      title,
      "--parent",
      rootPrdId,
      "--content",
      "# Overview/Goal\nfix\n## Scope\nn/a\n## Acceptance Criteria\nn/a",
    ],
    { cwd: upstreamRoot },
  );
  expect(result.exitCode).toBe(0);
  return { id: data.data.id, slug: data.data.slug };
}

/** Walks a doc draft -> approved -> archived via `lore set --status` (bypasses the review-judgment-gated `lore approve` verb entirely). */
function archiveDoc(upstreamRoot: string, idOrSlug: string): void {
  const approveResult = run(["set", idOrSlug, "--status", "approved", "--by", "tester"], { cwd: upstreamRoot });
  expect(approveResult.exitCode).toBe(0);
  const archiveResult = run(["set", idOrSlug, "--status", "archived", "--by", "tester"], { cwd: upstreamRoot });
  expect(archiveResult.exitCode).toBe(0);
}

/** Links `fromIdOrSlug --resolves--> toIdOrSlug` on the upstream corpus. */
function linkResolves(upstreamRoot: string, fromIdOrSlug: string, toIdOrSlug: string): void {
  const linkResult = run(["link", fromIdOrSlug, toIdOrSlug, "--type", "resolves", "--by", "tester"], {
    cwd: upstreamRoot,
  });
  expect(linkResult.exitCode).toBe(0);
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

beforeAll(() => {
  const buildResult = Bun.spawnSync(["bun", "run", "build"], { cwd: WORKTREE_ROOT });
  if (buildResult.exitCode !== 0) {
    throw new Error(
      `'bun run build' failed (exit ${buildResult.exitCode}):\n` +
        `stdout: ${buildResult.stdout.toString()}\nstderr: ${buildResult.stderr.toString()}`,
    );
  }
  if (!existsSync(DIST_LORE)) {
    throw new Error(`Expected ${DIST_LORE} to exist after 'bun run build'`);
  }
}, 120_000);

afterAll(() => {
  for (const path of fixturesToClean) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup — a fixture already removed by a test
      // itself (the ERROR case below) must not throw.
    }
  }
});

// ─── HAPPY: the decisive case — a resolves edge to an ARCHIVED doc reports "fixed" ──

describe("AC-ICL-7: consumer report-issue --list reports computed resolution", () => {
  it("AC-ICL-7: a resolves edge to an ARCHIVED fixing spec reports 'fixed', never the issue task's own 'draft' status", () => {
    const { upstream, consumerRoot } = makeTwin("fixed");
    track(upstream.root, consumerRoot);
    disableUpstreamGates(upstream.root);

    const issueId = fileReport(consumerRoot, "Report: the 9-day misreport shape", "agent:icl7-fixed");

    const spec = createFixingSpec(upstream.root, upstream.rootPrdId, "Fixing Spec (archived)");
    archiveDoc(upstream.root, spec.id);
    linkResolves(upstream.root, spec.id, issueId);

    // The issue task's OWN doc status was never touched — still draft.
    const issueDoc = runJson<{ ok: true; data: { doc: { status: string } } }>(["get", issueId], {
      cwd: upstream.root,
    });
    expect(issueDoc.data.data.doc.status).toBe("draft");

    const { result, rows } = listRows(consumerRoot);
    expect(result.exitCode).toBe(0);
    const row = rows.find((r) => r.upstream_doc_id === issueId);
    expect(row).toBeTruthy();
    // reason: this is the decisive assertion the whole task exists for — the
    // primary `status` field must be the COMPUTED resolution ("fixed"), not
    // the issue task's raw (still-draft) doc status.
    expect(row?.status).toBe("fixed");
    expect(row?.doc_status).toBe("draft");
  }, 20_000);

  it("AC-ICL-7: an explicit 'rejected' resolution echoes its reason, never the raw doc status", () => {
    const { upstream, consumerRoot } = makeTwin("rejected");
    track(upstream.root, consumerRoot);

    const issueId = fileReport(consumerRoot, "Report: not actually a defect", "agent:icl7-rejected");

    const resolveResult = run(
      ["issue", "resolve", issueId, "--state", "rejected", "--reason", "not a lore defect", "--by", "tester"],
      { cwd: upstream.root },
    );
    expect(resolveResult.exitCode).toBe(0);

    const { result, rows } = listRows(consumerRoot);
    expect(result.exitCode).toBe(0);
    const row = rows.find((r) => r.upstream_doc_id === issueId);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("rejected");
    expect(row?.rejection_reason).toBe("not a lore defect");
    expect(row?.doc_status).toBe("draft");
  }, 20_000);

  it("AC-ICL-7: an explicit 'wontfix' resolution echoes its reason", () => {
    const { upstream, consumerRoot } = makeTwin("wontfix");
    track(upstream.root, consumerRoot);

    const issueId = fileReport(consumerRoot, "Report: known limitation", "agent:icl7-wontfix");

    const resolveResult = run(
      ["issue", "resolve", issueId, "--state", "wontfix", "--reason", "duplicate of an accepted tradeoff", "--by", "tester"],
      { cwd: upstream.root },
    );
    expect(resolveResult.exitCode).toBe(0);

    const { result, rows } = listRows(consumerRoot);
    expect(result.exitCode).toBe(0);
    const row = rows.find((r) => r.upstream_doc_id === issueId);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("wontfix");
    expect(row?.rejection_reason).toBe("duplicate of an accepted tradeoff");
  }, 20_000);

  // ─── BOUNDARY: a resolves edge exists but its source is not yet terminal ──

  it("AC-ICL-7: a resolves edge whose source doc is still draft reports 'resolving', never 'fixed'", () => {
    const { upstream, consumerRoot } = makeTwin("resolving");
    track(upstream.root, consumerRoot);
    disableUpstreamGates(upstream.root);

    const issueId = fileReport(consumerRoot, "Report: fix in flight", "agent:icl7-resolving");

    const spec = createFixingSpec(upstream.root, upstream.rootPrdId, "Fixing Spec (still draft)");
    linkResolves(upstream.root, spec.id, issueId);

    const { result, rows } = listRows(consumerRoot);
    expect(result.exitCode).toBe(0);
    const row = rows.find((r) => r.upstream_doc_id === issueId);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("resolving");
  }, 20_000);

  // ─── NEGATIVE: unconfigured feedback.upstream — byte-for-byte regression pin (SPEC-072 AC-072-2) ──

  it("AC-ICL-7: unconfigured feedback.upstream still fails loud exactly as before (regression pin)", () => {
    const consumerRoot = makeConsumer("unconfigured");
    track(consumerRoot);

    const result = run(["report-issue", "--list"], { cwd: consumerRoot });
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("feedback.upstream.corpus_path");
    expect(result.stderr).toContain("feedback.upstream.root_prd");
  });

  // ─── ERROR: whole upstream corpus unreachable — degrades every row, never crashes (SPEC-072 AC-072-10) ──

  it("AC-ICL-7: an upstream corpus that no longer exists degrades every row to 'unreachable', exit 0, no crash", () => {
    const { upstream, consumerRoot } = makeTwin("upstream-gone");
    track(consumerRoot); // upstream.root is deliberately removed below

    const issueId = fileReport(consumerRoot, "Report: upstream will vanish", "agent:icl7-gone");

    assertUnderTmp(upstream.root);
    rmSync(upstream.root, { recursive: true, force: true });

    const { result, rows } = listRows(consumerRoot);
    expect(result.exitCode).toBe(0);
    const row = rows.find((r) => r.upstream_doc_id === issueId);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("unreachable");
    expect(row?.doc_status).toBeUndefined();
  }, 20_000);

  // ─── STATE: a receipt referencing a doc that never existed upstream — degrades that ONE row (SPEC-072 AC-072-10) ──

  it("AC-ICL-7: a receipt whose doc no longer exists upstream degrades to 'unreachable' with the documented warning", () => {
    const { upstream, consumerRoot } = makeTwin("doc-missing");
    track(upstream.root, consumerRoot);

    const bogusId = "01BOGUSDOCTHATNEVEREXISTED0";
    appendFileSync(
      join(consumerRoot, ".lore", "issue-receipts.jsonl"),
      JSON.stringify({ upstream_doc_id: bogusId, title: "Never actually filed", at: "2026-01-01T00:00:00.000Z" }) +
        "\n",
    );

    const { result, rows } = listRows(consumerRoot);
    expect(result.exitCode).toBe(0);
    const row = rows.find((r) => r.upstream_doc_id === bogusId);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("unreachable");
    expect(row?.warnings).toContain("upstream doc no longer found (deleted, or never existed)");
  }, 20_000);

  // ─── REGRESSION: a freshly-filed, untouched report reports "open" — never "fixed", never leaks raw "draft" as the primary signal ──

  it("AC-ICL-7: a freshly-filed report with no resolves edge and no explicit resolution reports 'open'", () => {
    const { upstream, consumerRoot } = makeTwin("open");
    track(upstream.root, consumerRoot);

    const issueId = fileReport(consumerRoot, "Report: brand new, untouched", "agent:icl7-open");

    const { result, rows } = listRows(consumerRoot);
    expect(result.exitCode).toBe(0);
    const row = rows.find((r) => r.upstream_doc_id === issueId);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("open");
    expect(row?.doc_status).toBe("draft");
    expect(row?.rejection_reason).toBeUndefined();
  }, 20_000);
});
