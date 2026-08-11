/**
 * Shared twin-corpus harness for the three M4/M6 read-surface suites
 * (`issue-read-surfaces-agree`, `issue-read-surface-local-control`,
 * `issue-severity-ordering-only`,
 * spec-the-defect-channel-cannot-be-honestly-maintained-an §M4/§M6).
 *
 * ⛔ Named `.shared.ts`, not `.test.ts`: it holds no assertions of its own and
 * must never be collected as a suite (same convention as
 * `tests/unit/store/*.shared.ts`).
 *
 * Public surface:
 *   - `run` / `runJson` — spawn THIS worktree's compiled `dist/lore`.
 *   - `buildDistLoreOnce` — the `beforeAll` anti-stale-binary build.
 *   - `makeTwin` — a throwaway upstream + consumer corpus pair.
 *   - `fileReport` / `tryFileReport` — file one report, with or without
 *     asserting success.
 *   - `firstLine` / `sameRealPath` — the two assertion primitives the declared
 *     render contract needs (a POSITION-anchored first line, and a
 *     symlink-proof path comparison — `mkdtemp` hands out `/var/folders/...`
 *     while `process.cwd()` reports the `/private/var/folders/...` realpath, so
 *     raw string equality on paths is not a sound oracle on macOS).
 *
 * Invariants:
 *   - ⛔ Every fixture path is asserted to live under `os.tmpdir()` — NEVER
 *     this repo's own `.lore/` (root CLAUDE.md's pollution rule). `run`
 *     re-asserts it on every spawn's cwd, so a helper that forgot cannot slip
 *     a repo-rooted invocation through.
 *   - The binary is resolved from THIS worktree's own root and rebuilt in
 *     `beforeAll`, so a stale `dist/lore` (which `assertFreshBinary` turns into
 *     a FATAL exit indistinguishable from an assertion red) can never be
 *     mistaken for a red assertion.
 *   - ⛔ ONE `feedback:` block per config file: duplicate top-level YAML mapping
 *     keys are resolved FIRST-WINS by the `yaml` parser, silently discarding the
 *     later block — a second append would make a case pass for the wrong reason
 *     (the value never parsed at all). Same hazard `issue-cap-configurable.bun.test.ts`
 *     documents; both halves of the consumer's `feedback:` (its `upstream:` and
 *     the upstream's own `inbound:`) are therefore written in a single append.
 *
 * Side-effect class: IO (mkdtemp fixtures, subprocess spawns, one `bun run build`).
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M4, §M6;
 *   task-both-issue-read-surfaces-name-the-corpus-they-read-issues.
 */

import { expect } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** packages/lore/tests/integration/cli -> this worktree's root (5 levels up). */
export const WORKTREE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
export const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** Every fixture path MUST resolve under the OS tmpdir — never the repo's own `.lore/`. */
export function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Synchronous `dist/lore <args>` spawn — CLAUDECODE=1 (agent surface, no AI nesting). */
export function run(args: string[], opts: { cwd: string; env?: Record<string, string> }): RunResult {
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
export function runJson<T>(
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
): { result: RunResult; data: T } {
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

/**
 * The `beforeAll` build. Asserts `WORKTREE_ROOT` really is the workspace root
 * BEFORE building, so a refactor that changes this file's depth fails loudly
 * instead of building some unrelated directory.
 */
export function buildDistLoreOnce(): void {
  const pkg = JSON.parse(readFileSync(join(WORKTREE_ROOT, "package.json"), "utf8")) as { name?: string };
  if (pkg.name !== "lore-workspace") {
    throw new Error(`WORKTREE_ROOT resolved to a non-workspace directory: ${WORKTREE_ROOT}`);
  }
  const buildResult = Bun.spawnSync(["bun", "run", "build"], { cwd: WORKTREE_ROOT });
  if (buildResult.exitCode !== 0) {
    throw new Error(
      `'bun run build' failed (exit ${buildResult.exitCode}):\n` +
        `stdout: ${buildResult.stdout.toString()}\nstderr: ${buildResult.stderr.toString()}`,
    );
  }
  if (!existsSync(DIST_LORE)) throw new Error(`Expected ${DIST_LORE} to exist after 'bun run build'`);
}

export interface UpstreamFixture {
  readonly root: string;
  readonly rootPrdId: string;
  readonly rootPrdSlug: string;
}

const fixturesToClean: string[] = [];

/** Best-effort fixture teardown for an `afterAll`. */
export function cleanFixtures(): void {
  for (const path of fixturesToClean) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup — a fixture a test itself removed must not throw here.
    }
  }
  fixturesToClean.length = 0;
}

function makeUpstream(prefix: string, inboundCap?: number): UpstreamFixture {
  const root = mkdtempSync(join(TMP_ROOT, `lore-m4-upstream-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) throw new Error(`upstream 'lore init' failed: ${initResult.stderr}`);
  if (inboundCap !== undefined) {
    appendFileSync(
      join(root, ".lore", "config.yaml"),
      ["feedback:", "  inbound:", `    open_report_cap: ${inboundCap}`, ""].join("\n"),
    );
  }
  const { result, data } = runJson<{ ok: true; data: { id: string; slug: string } }>(
    ["create", "prd", "--title", `Upstream Root PRD (${prefix})`, "--content", "root prd content"],
    { cwd: root },
  );
  if (result.exitCode !== 0) throw new Error(`upstream root PRD creation failed: ${result.stderr}`);
  return { root, rootPrdId: data.data.id, rootPrdSlug: data.data.slug };
}

/**
 * @param upstreamOverride - when supplied, the consumer's
 *   `feedback.upstream.corpus_path` points HERE instead of at the real upstream
 *   (the ERROR-dimension probe: an upstream that cannot be opened at all).
 *   `null` writes NO `feedback:` block at all (the unconfigured case).
 */
function makeConsumer(
  prefix: string,
  upstream: UpstreamFixture,
  upstreamOverride?: string | null,
): string {
  const root = mkdtempSync(join(TMP_ROOT, `lore-m4-consumer-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) throw new Error(`consumer 'lore init' failed: ${initResult.stderr}`);
  if (upstreamOverride === null) return root;
  appendFileSync(
    join(root, ".lore", "config.yaml"),
    [
      "feedback:",
      "  upstream:",
      `    corpus_path: ${upstreamOverride ?? upstream.root}`,
      `    root_prd: ${upstream.rootPrdSlug}`,
      "",
    ].join("\n"),
  );
  return root;
}

export interface TwinOptions {
  /** The UPSTREAM's own declared `feedback.inbound.open_report_cap`; omitted → the shipped default. */
  readonly upstreamCap?: number;
  /** Point the consumer's `feedback.upstream.corpus_path` at this path instead (ERROR probe). */
  readonly upstreamPathOverride?: string;
  /** Write NO `feedback:` block into the consumer at all (unconfigured case). */
  readonly unconfigured?: boolean;
}

export interface Twin {
  readonly upstream: UpstreamFixture;
  readonly consumerRoot: string;
}

export function makeTwin(prefix: string, opts: TwinOptions = {}): Twin {
  const upstream = makeUpstream(prefix, opts.upstreamCap);
  const consumerRoot = makeConsumer(
    prefix,
    upstream,
    opts.unconfigured === true ? null : opts.upstreamPathOverride,
  );
  fixturesToClean.push(upstream.root, consumerRoot);
  return { upstream, consumerRoot };
}

export interface ReportFlags {
  readonly severity?: string;
  readonly category?: string;
}

function reportArgs(title: string, flags: ReportFlags): string[] {
  return [
    "report-issue",
    "--title",
    title,
    "--description",
    "desc",
    "--expected",
    "exit 0",
    "--actual",
    "exit 4",
    ...(flags.severity !== undefined ? ["--severity", flags.severity] : []),
    ...(flags.category !== undefined ? ["--category", flags.category] : []),
  ];
}

/** Attempts one report WITHOUT asserting success — the observation primitive for a refusal. */
export function tryFileReport(consumerRoot: string, title: string, flags: ReportFlags = {}): RunResult {
  return run(reportArgs(title, flags), {
    cwd: consumerRoot,
    env: { LORE_ACTOR: "agent:m4-reporter" },
  });
}

/** Files one report, asserting exit 0; returns its upstream doc id. */
export function fileReport(consumerRoot: string, title: string, flags: ReportFlags = {}): string {
  const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
    reportArgs(title, flags),
    { cwd: consumerRoot, env: { LORE_ACTOR: "agent:m4-reporter" } },
  );
  expect(result.exitCode).toBe(0);
  return data.data.upstream_doc_id;
}

/**
 * The FIRST line of a stdout buffer, with no trailing newline.
 *
 * The declared render contract is POSITIONAL ("the human output's FIRST line
 * matches the fixed prefix `Corpus: `"), so every assertion keys on this rather
 * than on `.toContain("Corpus: ")` — incidental presence anywhere in the buffer
 * is exactly what the fixed prefix was declared to rule out.
 */
export function firstLine(stdout: string): string {
  return stdout.split("\n")[0] ?? "";
}

/**
 * Symlink-proof path equality. `mkdtempSync` returns `/var/folders/...` on macOS
 * while a spawned process's `process.cwd()`-derived corpus root reports the
 * `/private/var/folders/...` realpath, so raw string equality would fail for a
 * fully correct implementation (and, worse, could PASS for the wrong path on a
 * system without that symlink).
 */
export function sameRealPath(a: string, b: string): boolean {
  return realpathSync(a) === realpathSync(b);
}

/** Sorted copy — set comparison over doc ids is order-insensitive by contract. */
export function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}
