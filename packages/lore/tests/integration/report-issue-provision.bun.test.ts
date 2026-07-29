/**
 * @spec_ref spec-out-of-box-reporting-channel-report-issue-self-provisions
 *   AC-OOB-1..5
 *
 * RED integration suite (task-t1-red-provision-integration-suite-ac-oob-1-5).
 * The behaviour under test — `lore report-issue --auto-config` self-provisioning
 * `feedback.upstream` from the installed binary's own location — DOES NOT EXIST
 * YET. Every test below is written from the SPEC, not from reading the (absent)
 * implementation, and is expected to be RED until a later GREEN task (T3/T4)
 * lands `resolveUpstreamFromInstalledBinary()` / `provisionFeedbackUpstream()`
 * (packages/lore/src/adapters/cli/report-issue-wiring.ts seam) and wires the
 * `--auto-config` flag into `commands/report-issue.ts`.
 *
 * Runs under `bun test` (spawns the compiled `dist/lore` binary — the
 * stale-binary false-oracle vector, root CLAUDE.md's "Four false-oracle
 * vectors" — so `beforeAll` runs `bun run build` ONCE before any test spawns
 * it).
 *
 * ── Never touches the repo's own `.lore/` corpus ──
 * Every fixture is a THROWAWAY `mkdtempSync` directory tracked under
 * `TMP_ROOT` (`os.tmpdir()`) and asserted (`assertUnderTmp`) to live there —
 * NEVER under this worktree's checkout, and NEVER under the main checkout
 * (root CLAUDE.md's hard rule + the 2026-07-07 dashboard e2e pollution
 * incident this rule exists to prevent).
 *
 * ── Design decision: simulating "installed binary" resolution ──
 * The spec's resolver walks "symlink → real path → repo root carrying
 * `.lore/lore.db`" from the CURRENTLY RUNNING binary's own location. This
 * worktree's OWN `dist/lore` cannot stand in for "the installed binary" in
 * any scenario that exercises resolution: `.lore/lore.db` is gitignored (see
 * `.gitignore` — `.lore/*` except `export-index.json`/`audit-anchor.json`),
 * so this worktree has NONE, but walking up from `<worktree>/dist/lore`
 * eventually reaches the MAIN checkout directory (this worktree is nested at
 * `<mainCheckout>/.claude/worktrees/<name>`) — which DOES have a live, real
 * `.lore/lore.db`. A naive "walk up looking for `.lore/lore.db`" resolver
 * given the worktree's real binary path could therefore find and match the
 * REAL team corpus. To make this categorically impossible, every test that
 * exercises `--auto-config` resolution spawns a FRESH COPY of the compiled
 * binary placed under a `mkdtemp` "install root" (never a symlink back to
 * this worktree's `dist/lore` — a symlink's realpath would resolve BACK to
 * the worktree), reached via one or more symlink hops from a separate `bin/`
 * dir (mirrors a real global install: `~/.bun/bin/lore` → dev checkout). See
 * `buildInstalledBinaryFixture` + `assertNoTmpWorktreeOverlap`.
 *
 * ── Design decision: the "expected lore root-PRD identity" ──
 * AC-OOB-5 requires a candidate whose root PRD does NOT match "the expected
 * lore root-PRD identity" to be rejected; AC-OOB-2/4b require a MATCHING
 * candidate to be accepted. Nothing in the spec text pins the exact matching
 * VALUE the (unwritten) resolver will hardcode — but the spec's own parent
 * PRD (`prd-lore-internal-first-ai-team-knowledge-platform`, goal G14) states
 * the upstream this feature reports into is explicitly "THIS corpus", i.e.
 * the real Lore project's own root PRD. `LORE_PROJECT_ROOT_PRD_TITLE`/`_SLUG`
 * below encode that identity (title copied verbatim from `lore get
 * prd-lore-internal-first-ai-team-knowledge-platform --json`, a READ against
 * the real corpus — never a write; slug verified independently deterministic
 * via a throwaway `lore create prd` with the same title, confirmed to
 * reproduce the identical slug with zero collision suffix). If T3 instead
 * pins the identity by ULID (a non-portable, unguessable value with no
 * plausible fixture-construction path), AC-OOB-2/4b's specific
 * "matching-identity" assertions would need a follow-up adjustment — AC-OOB-1
 * (no identity dependency), AC-OOB-3 (no `.lore/` candidate at all), and
 * AC-OOB-5 (an arbitrary WRONG identity, correct regardless of what the RIGHT
 * one is) do not depend on this assumption at all.
 *
 * Test names embed their AC token verbatim (`AC-OOB-N`) so `-t 'AC-OOB-N'`
 * filters match ≥1 test per id (SPEC-061 matched-count discipline).
 *
 * Six-dimension coverage across the suite:
 *   HAPPY:      AC-OOB-2 (resolvable upstream, full round-trip),
 *               AC-OOB-4a (idempotent no-op on an already-configured corpus)
 *   NEGATIVE:   AC-OOB-1 (unconfigured, no flag, no prompt-tolerant guidance)
 *   BOUNDARY:   AC-OOB-2 multi-hop symlink chain (3 hops to the real binary)
 *   ERROR:      AC-OOB-3 (unresolvable candidate), AC-OOB-5 (identity mismatch)
 *   STATE:      AC-OOB-3/AC-OOB-5 byte-identical config on failure, AC-OOB-4b
 *               top-level key preservation on a successful provisioning write
 *   REGRESSION: an already-configured consumer's PLAIN (no `--auto-config`)
 *               `report-issue` path is unaffected by this spec (pins the
 *               pre-existing SPEC-072 happy path this spec must not disturb)
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import yaml from "yaml";
import { FeedbackConfigSchema } from "@lore/core";

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

/**
 * One-time sanity guard (see module header "simulating 'installed binary'
 * resolution"): if the OS tmpdir and this worktree ever overlapped, a
 * resolved "installed binary" path built under `TMP_ROOT` could in principle
 * walk back up into a real git checkout. On every platform this suite
 * actually runs on they are disjoint trees — this just makes that assumption
 * loud instead of ambient.
 */
function assertNoTmpWorktreeOverlap(): void {
  if (TMP_ROOT.startsWith(WORKTREE_ROOT) || WORKTREE_ROOT.startsWith(TMP_ROOT)) {
    throw new Error(
      `Refusing to run: OS tmpdir (${TMP_ROOT}) and this worktree root (${WORKTREE_ROOT}) overlap — ` +
        `every fixture in this suite assumes they are disjoint so a resolved 'installed binary' path can ` +
        `never walk up into a real git checkout's .lore/ corpus.`,
    );
  }
}

interface RunOpts {
  cwd: string;
  env?: Record<string, string>;
  /** Which binary to spawn — defaults to this worktree's own compiled dist/lore. */
  binary?: string;
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Synchronous `<binary> <args>` spawn — CLAUDECODE=1 (agent surface, no AI nesting). */
function run(args: string[], opts: RunOpts): RunResult {
  assertUnderTmp(opts.cwd);
  const binary = opts.binary ?? DIST_LORE;
  const proc = Bun.spawnSync([binary, ...args], {
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
function runJson<T>(args: string[], opts: RunOpts): { result: RunResult; data: T } {
  const result = run([...args, "--json"], opts);
  try {
    return { result, data: JSON.parse(result.stdout) as T };
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from '${opts.binary ?? DIST_LORE} ${args.join(" ")}' (exit ${result.exitCode}):\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}\ncause: ${String(e)}`,
    );
  }
}

// ─── Fixture builders ────────────────────────────────────────────────────────

/** Fresh mkdtemp corpus, `lore init`'d, with no `feedback.upstream` configured yet. */
function makeConsumer(prefix: string): string {
  const root = mkdtempSync(join(TMP_ROOT, `lore-oob-consumer-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) {
    throw new Error(`consumer 'lore init' failed: ${initResult.stderr}`);
  }
  return root;
}

interface UpstreamFixture {
  root: string;
  rootPrdId: string;
  rootPrdSlug: string;
}

/** Fresh mkdtemp corpus, `lore init`'d, with a seeded root PRD (plain — no binary copy). */
function makeUpstream(prefix: string, title = `Upstream (${prefix})`): UpstreamFixture {
  const root = mkdtempSync(join(TMP_ROOT, `lore-oob-upstream-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) {
    throw new Error(`upstream 'lore init' failed: ${initResult.stderr}`);
  }
  const { result, data } = runJson<{ ok: true; data: { id: string; slug: string } }>(
    ["create", "prd", "--title", title, "--content", "root prd content"],
    { cwd: root },
  );
  if (result.exitCode !== 0) {
    throw new Error(`upstream root PRD creation failed: ${result.stderr}`);
  }
  return { root, rootPrdId: data.data.id, rootPrdSlug: data.data.slug };
}

/** Appends a `feedback.upstream` stanza onto a consumer's config.yaml (pre-configuring it). */
function configureFeedbackUpstream(consumerRoot: string, upstreamRoot: string, rootPrdIdentity: string): void {
  assertUnderTmp(consumerRoot);
  appendFileSync(
    join(consumerRoot, ".lore", "config.yaml"),
    ["feedback:", "  upstream:", `    corpus_path: ${upstreamRoot}`, `    root_prd: ${rootPrdIdentity}`, ""].join(
      "\n",
    ),
  );
}

function configYamlPath(root: string): string {
  return join(root, ".lore", "config.yaml");
}

function readConfigBytes(root: string): Buffer {
  return readFileSync(configYamlPath(root));
}

function readConfigParsed(root: string): Record<string, any> {
  return yaml.parse(readFileSync(configYamlPath(root), "utf8")) as Record<string, any>;
}

/**
 * The real Lore project's own root-PRD identity — see module header "Design
 * decision: the 'expected lore root-PRD identity'" for how/why this value
 * was derived (a READ against the real corpus, never a write).
 */
const LORE_PROJECT_ROOT_PRD_TITLE = "Lore — Internal-First AI Team Knowledge Platform";
const LORE_PROJECT_ROOT_PRD_SLUG = "prd-lore-internal-first-ai-team-knowledge-platform";

interface InstalledBinaryFixture {
  /** The throwaway "repo root" the copied binary lives under — carries `.lore/lore.db` iff `seedRootPrdTitle` was given. */
  installRoot: string;
  /** The path a test should actually SPAWN — a symlink (chain) resolving to `installRoot/dist/lore`. */
  binPath: string;
  /** Tracked separately from `installRoot` for cleanup (lives in its own mkdtemp dir). */
  binDir: string;
  rootPrdId?: string;
  rootPrdSlug?: string;
}

/**
 * Builds a throwaway "installed binary" fixture: copies THIS worktree's freshly
 * built `dist/lore` bytes into `<installRoot>/dist/lore` (a REAL file, never a
 * symlink back to the worktree — see module header), then reaches it via one or
 * more symlink hops from a SEPARATE bin dir (mirrors a real global install).
 *
 * @param opts.seedRootPrdTitle - when given, `installRoot` is `lore init`'d and
 *   seeded with a root PRD of this title (a "resolvable, readable" candidate —
 *   AC-OOB-2/4b/5 all pass a title here, differing only in whether it matches
 *   the expected Lore identity). When OMITTED, `installRoot` gets no `.lore/`
 *   at all — a genuinely unresolvable candidate (AC-OOB-3/4a).
 * @param opts.symlinkHops - defaults to 1; AC-OOB-2's boundary test uses 3 to
 *   pin multi-hop "symlink → real path" resolution (spec Design wording).
 */
function buildInstalledBinaryFixture(
  prefix: string,
  opts: { seedRootPrdTitle?: string; symlinkHops?: number } = {},
): InstalledBinaryFixture {
  const installRoot = mkdtempSync(join(TMP_ROOT, `lore-oob-install-${prefix}-`));
  assertUnderTmp(installRoot);
  mkdirSync(join(installRoot, "dist"), { recursive: true });
  const copiedBinaryPath = join(installRoot, "dist", "lore");
  copyFileSync(DIST_LORE, copiedBinaryPath);
  chmodSync(copiedBinaryPath, 0o755);

  let rootPrdId: string | undefined;
  let rootPrdSlug: string | undefined;
  if (opts.seedRootPrdTitle !== undefined) {
    const initResult = run(["init"], { cwd: installRoot });
    if (initResult.exitCode !== 0) {
      throw new Error(`install-root 'lore init' failed: ${initResult.stderr}`);
    }
    const { result, data } = runJson<{ ok: true; data: { id: string; slug: string } }>(
      ["create", "prd", "--title", opts.seedRootPrdTitle, "--content", "root prd content"],
      { cwd: installRoot },
    );
    if (result.exitCode !== 0) {
      throw new Error(`install-root root PRD creation failed: ${result.stderr}`);
    }
    rootPrdId = data.data.id;
    rootPrdSlug = data.data.slug;
  }

  const binDir = mkdtempSync(join(TMP_ROOT, `lore-oob-bin-${prefix}-`));
  assertUnderTmp(binDir);
  const hops = opts.symlinkHops ?? 1;
  let target = copiedBinaryPath;
  for (let i = 0; i < hops; i++) {
    const isLast = i === hops - 1;
    const hopPath = isLast ? join(binDir, "lore") : join(binDir, `lore-hop-${i}`);
    symlinkSync(target, hopPath);
    target = hopPath;
  }
  const binPath = join(binDir, "lore");

  return {
    installRoot,
    binPath,
    binDir,
    ...(rootPrdId !== undefined ? { rootPrdId } : {}),
    ...(rootPrdSlug !== undefined ? { rootPrdSlug } : {}),
  };
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

beforeAll(() => {
  assertNoTmpWorktreeOverlap();
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
}, 180_000);

const fixturesToClean: string[] = [];
function track(...paths: string[]): void {
  for (const p of paths) fixturesToClean.push(p);
}

afterAll(() => {
  for (const path of fixturesToClean) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup only.
    }
  }
});

// ─── AC-OOB-1: unconfigured, non-TTY, no --auto-config ───────────────────────

describe("AC-OOB-1: unconfigured + non-TTY + no --auto-config fails loud with the provision command, zero hand-edit-YAML guidance", () => {
  it("AC-OOB-1: exits 4, stderr names the literal --auto-config provision command, contains ZERO 'corpus_path: /path/to' template guidance", () => {
    const consumerRoot = makeConsumer("ac1");
    track(consumerRoot);

    // reason: Bun.spawnSync's default stdio is piped (never an inherited
    // terminal) — the spawned process is inherently non-TTY, matching this
    // AC's "non-TTY" precondition with no extra flag needed.
    const result = run(
      ["report-issue", "--title", "t", "--description", "d", "--expected", "e", "--actual", "a"],
      { cwd: consumerRoot },
    );

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("--auto-config");
    expect(result.stderr).not.toContain("corpus_path: /path/to");
    expect(result.stderr).not.toContain("root_prd: prd-lore");
  });

  it("AC-OOB-1: the --list unconfigured path gets the same actionable message (single wording SSOT)", () => {
    const consumerRoot = makeConsumer("ac1-list");
    track(consumerRoot);

    const result = run(["report-issue", "--list"], { cwd: consumerRoot });

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("--auto-config");
    expect(result.stderr).not.toContain("corpus_path: /path/to");
  });
});

// ─── AC-OOB-2: --auto-config + resolvable upstream ───────────────────────────

describe("AC-OOB-2: --auto-config with a resolvable upstream provisions feedback.upstream and files the report", () => {
  it("AC-OOB-2: writes a FeedbackConfigSchema-clean feedback.upstream, files the report as an upstream draft task, exit 0", () => {
    const install = buildInstalledBinaryFixture("ac2", { seedRootPrdTitle: LORE_PROJECT_ROOT_PRD_TITLE });
    track(install.installRoot, install.binDir);
    // Lock the slugify-determinism assumption this fixture depends on — fail
    // loud HERE (not three assertions later, mid-mystery) if it ever drifts.
    expect(install.rootPrdSlug).toBe(LORE_PROJECT_ROOT_PRD_SLUG);

    const consumerRoot = makeConsumer("ac2");
    track(consumerRoot);

    const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
      [
        "report-issue",
        "--title",
        "AC-OOB-2 report",
        "--description",
        "desc",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
        "--auto-config",
      ],
      { cwd: consumerRoot, binary: install.binPath },
    );
    expect(result.exitCode).toBe(0);
    const upstreamDocId = data.data.upstream_doc_id;
    expect(upstreamDocId).toBeTruthy();

    // feedback.upstream written + schema-clean.
    const parsedConfig = readConfigParsed(consumerRoot);
    const feedbackParse = FeedbackConfigSchema.safeParse(parsedConfig.feedback);
    expect(feedbackParse.success).toBe(true);
    // reason: expected value is realpath-resolved too — on macOS `os.tmpdir()`
    // lives under `/var/...`, itself a symlink to `/private/var/...`; the
    // resolver's Design-mandated walk (symlink → real path → enclosing repo
    // root) correctly follows that OS-level symlink too (not just
    // user-created ones), so the fair comparison is against the fully-resolved
    // expected path, not the raw mkdtemp string. See the sibling suite
    // (report-issue-wiring-provision.bun.test.ts) for the same reasoning
    // against this same resolver.
    expect(parsedConfig.feedback?.upstream?.corpus_path).toBe(realpathSync(install.installRoot));
    expect([install.rootPrdSlug, install.rootPrdId]).toContain(parsedConfig.feedback?.upstream?.root_prd);

    // Report lands as a draft task upstream.
    const pending = runJson<{ ok: true; data: { docs: Array<{ id: string; status: string; type: string }> } }>(
      ["pending", "--all"],
      { cwd: install.installRoot },
    );
    const row = pending.data.data.docs.find((d) => d.id === upstreamDocId);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("draft");
    expect(row?.type).toBe("task");
  }, 30_000);

  it("AC-OOB-2 boundary: a 3-hop symlink chain to the compiled binary still resolves the correct corpus_path", () => {
    const install = buildInstalledBinaryFixture("ac2-multihop", {
      seedRootPrdTitle: LORE_PROJECT_ROOT_PRD_TITLE,
      symlinkHops: 3,
    });
    track(install.installRoot, install.binDir);
    const consumerRoot = makeConsumer("ac2-multihop");
    track(consumerRoot);

    const result = run(
      [
        "report-issue",
        "--title",
        "AC-OOB-2 multihop report",
        "--description",
        "desc",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
        "--auto-config",
      ],
      { cwd: consumerRoot, binary: install.binPath },
    );
    expect(result.exitCode).toBe(0);

    const parsedConfig = readConfigParsed(consumerRoot);
    expect(parsedConfig.feedback?.upstream?.corpus_path).toBe(realpathSync(install.installRoot));
  }, 30_000);
});

// ─── AC-OOB-3: --auto-config + unresolvable upstream ─────────────────────────

describe("AC-OOB-3: --auto-config with an unresolvable upstream fails loud, zero config writes", () => {
  it("AC-OOB-3: exit 4 naming what could not be resolved; consumer .lore/config.yaml stays byte-identical", () => {
    // No `seedRootPrdTitle` — installRoot carries NO .lore/lore.db anywhere up
    // the chain from the copied binary: a genuinely unresolvable candidate.
    const install = buildInstalledBinaryFixture("ac3");
    track(install.installRoot, install.binDir);
    const consumerRoot = makeConsumer("ac3");
    track(consumerRoot);

    const before = readConfigBytes(consumerRoot);

    const result = run(
      ["report-issue", "--title", "t", "--description", "d", "--expected", "e", "--actual", "a", "--auto-config"],
      { cwd: consumerRoot, binary: install.binPath },
    );
    expect(result.exitCode).toBe(4);
    // reason: exact wording is unwritten — a permissive keyword check avoids
    // over-pinning phrasing the future implementer hasn't chosen yet, while
    // still requiring SOME diagnostic naming the resolution failure.
    expect(result.stderr.toLowerCase()).toMatch(/resolv|install|upstream/);

    const after = readConfigBytes(consumerRoot);
    expect(after.equals(before)).toBe(true);
  }, 30_000);
});

// ─── AC-OOB-4: idempotent + non-destructive ──────────────────────────────────

describe("AC-OOB-4a: --auto-config on an ALREADY-configured corpus is a byte-identical no-op", () => {
  it("AC-OOB-4a: exit 0 (report still files normally), config.yaml byte-identical, even against an unresolvable installed binary", () => {
    const upstream = makeUpstream("ac4a");
    const consumerRoot = makeConsumer("ac4a");
    track(upstream.root, consumerRoot);
    configureFeedbackUpstream(consumerRoot, upstream.root, upstream.rootPrdSlug);

    // Deliberately UNRESOLVABLE "installed binary" — proves the already-
    // configured short-circuit never even attempts resolution.
    const install = buildInstalledBinaryFixture("ac4a-install");
    track(install.installRoot, install.binDir);

    const before = readConfigBytes(consumerRoot);

    const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
      [
        "report-issue",
        "--title",
        "AC-OOB-4a report",
        "--description",
        "desc",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
        "--auto-config",
      ],
      { cwd: consumerRoot, binary: install.binPath },
    );
    expect(result.exitCode).toBe(0);
    expect(data.data.upstream_doc_id).toBeTruthy();

    const after = readConfigBytes(consumerRoot);
    expect(after.equals(before)).toBe(true);
  }, 30_000);
});

describe("AC-OOB-4b: on an unconfigured corpus, the provisioning write preserves every pre-existing top-level config key", () => {
  it("AC-OOB-4b: project + workflow keys survive verbatim; feedback.upstream is newly added", () => {
    const install = buildInstalledBinaryFixture("ac4b", { seedRootPrdTitle: LORE_PROJECT_ROOT_PRD_TITLE });
    track(install.installRoot, install.binDir);
    const consumerRoot = makeConsumer("ac4b");
    track(consumerRoot);

    // Seed an extra pre-existing top-level key BEYOND `lore init`'s own
    // `project:` block, so this test can't accidentally pass by only
    // re-verifying `project:` (a key that's always there regardless).
    appendFileSync(configYamlPath(consumerRoot), ["workflow:", "  claim_ttl_minutes: 999", ""].join("\n"));

    const before = readConfigParsed(consumerRoot);
    expect(before.project).toBeTruthy();
    expect(before.workflow?.claim_ttl_minutes).toBe(999);
    expect(before.feedback).toBeUndefined();

    const result = run(
      [
        "report-issue",
        "--title",
        "AC-OOB-4b report",
        "--description",
        "desc",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
        "--auto-config",
      ],
      { cwd: consumerRoot, binary: install.binPath },
    );
    expect(result.exitCode).toBe(0);

    const after = readConfigParsed(consumerRoot);
    expect(after.project).toEqual(before.project);
    expect(after.workflow?.claim_ttl_minutes).toBe(999);
    expect(after.feedback?.upstream?.corpus_path).toBe(realpathSync(install.installRoot));
  }, 30_000);
});

// ─── AC-OOB-5: identity pin over path trust ───────────────────────────────────

describe("AC-OOB-5: identity pin over path trust — a readable but WRONG root PRD is rejected", () => {
  it("AC-OOB-5: exit 4, no config written, when the candidate's root PRD does not match the expected lore identity", () => {
    const install = buildInstalledBinaryFixture("ac5", { seedRootPrdTitle: "Definitely Not The Lore Project" });
    track(install.installRoot, install.binDir);
    expect(install.rootPrdSlug).not.toBe(LORE_PROJECT_ROOT_PRD_SLUG);

    const consumerRoot = makeConsumer("ac5");
    track(consumerRoot);

    const before = readConfigBytes(consumerRoot);

    const result = run(
      ["report-issue", "--title", "t", "--description", "d", "--expected", "e", "--actual", "a", "--auto-config"],
      { cwd: consumerRoot, binary: install.binPath },
    );
    expect(result.exitCode).toBe(4);
    // reason: mirrors this codebase's established matchRootPrd failure-message
    // precedent (AC-072-3's own test asserts the found-but-wrong slug appears).
    expect(result.stderr).toContain(install.rootPrdSlug as string);

    const after = readConfigBytes(consumerRoot);
    expect(after.equals(before)).toBe(true);
  }, 30_000);
});

// ─── REGRESSION: this spec must not disturb the already-configured, non-auto-config path ──

describe("REGRESSION: an already-configured consumer's plain (no --auto-config) report-issue path is unaffected", () => {
  it("REGRESSION: exit 0, report filed upstream — identical to the pre-existing SPEC-072 happy path", () => {
    const upstream = makeUpstream("regression");
    const consumerRoot = makeConsumer("regression");
    track(upstream.root, consumerRoot);
    configureFeedbackUpstream(consumerRoot, upstream.root, upstream.rootPrdSlug);

    const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
      ["report-issue", "--title", "t", "--description", "d", "--expected", "e", "--actual", "a"],
      { cwd: consumerRoot },
    );
    expect(result.exitCode).toBe(0);
    expect(data.data.upstream_doc_id).toBeTruthy();
  }, 20_000);
});
