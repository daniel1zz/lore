// @spawns dist/lore
/**
 * AC-BFI-2 oracle — `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`.
 *
 * Drives `lore status --check-binary-provenance` through the REAL compiled
 * binary in all three states the criterion names, asserting EXACT exit codes:
 *
 *   dev-synced          build commit == this repo's HEAD        → EXACTLY 0
 *   dev-stale           build commit is in this repo, not HEAD  → EXACTLY 3, naming BOTH shas
 *   not-a-dev-checkout  build commit unknown to this repo       → EXACTLY 0, literal token `skipped`
 *
 * ⛔ Every assertion is `toBe(<n>)`, never "non-zero": a check that crashes
 * before inspecting anything also exits non-zero and has zero discriminating
 * power.
 *
 * ⛔ NO STUBBED CLASSIFIER — each state is a real repository:
 *   - dev-synced: the binary is built from THIS worktree and run inside it.
 *   - dev-stale: `git clone --local --no-hardlinks` this worktree, then
 *     `git commit --allow-empty` in the clone. Measured: the clone's HEAD moves
 *     while `git cat-file -e <build-sha>^{commit}` still succeeds there — which
 *     is exactly the "commit exists but is not HEAD" shape.
 *   - not-a-dev-checkout: a fresh `git init` repo WITH one commit of its own —
 *     the npm-installed consumer. It carries a readable HEAD deliberately, so
 *     collapsing this state into dev-stale (declared RED (a)) produces a
 *     comparison that exits 3 instead of 0. An EMPTY repo would take the
 *     `no-readable-head` path instead and would not exercise that collapse; it
 *     is covered separately below as a boundary case.
 *   Measured while building this: `git cat-file -e <unknown-sha>^{commit}`
 *   exits 128 in a foreign repo. ⛔ That 128 is NOT an error path — it is the
 *   classifier's evidence for state 3.
 *
 * The declared REDs are classifier collapses, both machine-checkable here:
 * (a) drop the commit-membership branch so not-a-dev-checkout falls through to
 * dev-stale → the consumer case exits 3 instead of 0; (b) return dev-synced
 * whenever provenance is present → the stale case exits 0 instead of 3.
 *
 * SAFETY: never touches the repo's own `.lore/` — `--check-binary-provenance`
 * returns before `loadLoreApp` is ever reached (that is the point of its
 * standalone dispatch), so no corpus is opened at all. Every fixture repo lives
 * under `mkdtemp`, and the clone is `--no-hardlinks` so nothing in a fixture
 * can ever share an object file with the real checkout.
 *
 * ⛔ The build writes the ORDINARY `dist/lore`, then this suite COPIES the
 * artifact to a `mkdtemp` path and spawns only the copy. Do NOT "improve" this
 * by redirecting the build's output elsewhere: `bun run build` also rewrites
 * `packages/lore/src/generated/assets-manifest.ts`, so a build that leaves
 * `dist/lore` untouched makes a generated source newer than the binary — the
 * exact condition `tests/integration/helpers/assert-fresh-binary.ts` refuses,
 * which took two unrelated suites down when it was tried (measured 2026-08-17;
 * see the fixed-`outfile` comment in `scripts/build.ts`). Copying is what
 * protects THIS suite's binary from a later rebuild by a co-scheduled test.
 *
 * Coverage dimensions: HAPPY (dev-synced) / NEGATIVE (dev-stale, the drift
 * verdict) / BOUNDARY (a consumer repo, and an empty repo with no readable
 * HEAD) / ERROR (exit codes are exact, never "non-zero") / STATE (dispatch
 * precedence: this flag wins over every other status flag) / REGRESSION (the
 * `--json` surface carries the same tokens as stdout, so a consumer reading
 * either sees the same verdict).
 *
 * @spec_ref AC-BFI-2
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root: four levels up from `packages/lore/tests/integration/`. Asserted in `beforeAll`. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");

/** Resolves a binary through the test runner's own PATH (`bunx vitest` runs test files under node). */
function resolveBinOrThrow(name: string): string {
  const resolved = execSync(`command -v ${name}`, { encoding: "utf8" }).trim();
  if (resolved.length === 0) {
    throw new Error(`binary-provenance-check.test.ts: could not resolve \`${name}\` via \`command -v\``);
  }
  return resolved;
}

const BUN_BIN = resolveBinOrThrow("bun");
const GIT_BIN = resolveBinOrThrow("git");

/** Ambient env minus secret-shaped names and `NODE_ENV`/`TEST` (see npm-install-simulation.test.ts). */
function sanitizedEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/token|secret|key|password|credential/i.test(key)) continue;
    if (key === "NODE_ENV" || key === "TEST") continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

/** `git <args>` in `cwd`; identity flags are passed inline so a fixture never depends on ambient git config. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_BIN, ["-c", "user.email=fixture@lore.test", "-c", "user.name=lore fixture", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

/** Runs the built binary and returns its exact exit code plus combined output. */
function runCheck(cwd: string, extraArgs: readonly string[] = []): { exit: number; out: string } {
  const run = spawnSync(builtBinary, ["status", "--check-binary-provenance", ...extraArgs], {
    cwd,
    encoding: "utf8",
    env: sanitizedEnv(),
  });
  if (run.status === null) {
    throw new Error(`the binary was killed by signal ${String(run.signal)} — no exit code to assert`);
  }
  return { exit: run.status, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

// ─── Fixtures, built once ───────────────────────────────────────────────────

let tempRoot = "";
let builtBinary = "";
let buildCommitSha = "";
let staleRepo = "";
let staleRepoHeadSha = "";
let consumerRepo = "";
let emptyRepo = "";

beforeAll(() => {
  if (!existsSync(join(REPO_ROOT, "scripts", "build.ts"))) {
    throw new Error(
      `binary-provenance-check.test.ts: REPO_ROOT resolved to "${REPO_ROOT}", which has no scripts/build.ts — ` +
        `the up-level count in this file's REPO_ROOT is wrong.`,
    );
  }

  tempRoot = mkdtempSync(join(tmpdir(), "lore-bfi2-"));
  builtBinary = join(tempRoot, "lore");

  const build = spawnSync(BUN_BIN, ["run", "build"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: sanitizedEnv(),
  });
  if (build.status !== 0) {
    throw new Error(
      `'bun run build' failed (exit ${String(build.status)}):\n${build.stdout ?? ""}\n${build.stderr ?? ""}`,
    );
  }
  const distBinary = join(REPO_ROOT, "dist", "lore");
  if (!existsSync(distBinary)) {
    throw new Error(`'bun run build' exited 0 but produced no binary at ${distBinary}`);
  }
  // Copy immediately — see the module header: every spawn below reads THIS
  // suite's own artifact, never a `dist/lore` a co-scheduled test may rebuild.
  copyFileSync(distBinary, builtBinary);
  chmodSync(builtBinary, 0o755);
  buildCommitSha = git(REPO_ROOT, "rev-parse", "HEAD");

  // ── dev-stale fixture ──
  staleRepo = join(tempRoot, "stale-clone");
  execFileSync(GIT_BIN, ["clone", "--local", "--no-hardlinks", REPO_ROOT, staleRepo], { encoding: "utf8" });
  git(staleRepo, "commit", "--allow-empty", "-m", "advance HEAD past the build commit");
  staleRepoHeadSha = git(staleRepo, "rev-parse", "HEAD");

  // ── not-a-dev-checkout fixture: a consumer's OWN repo, with its own history ──
  consumerRepo = join(tempRoot, "consumer-repo");
  mkdirSync(consumerRepo, { recursive: true });
  git(consumerRepo, "init");
  writeFileSync(join(consumerRepo, "README.md"), "a project that merely has lore installed\n", "utf8");
  git(consumerRepo, "add", "README.md");
  git(consumerRepo, "commit", "-m", "consumer's own first commit");

  // ── boundary fixture: a git repo with no commit at all ──
  emptyRepo = join(tempRoot, "empty-repo");
  mkdirSync(emptyRepo, { recursive: true });
  git(emptyRepo, "init");
}, 300_000);

afterAll(() => {
  if (tempRoot.length > 0) rmSync(tempRoot, { recursive: true, force: true });
});

// ─── The three states AC-BFI-2 pins ─────────────────────────────────────────

describe("AC-BFI-2: lore status --check-binary-provenance distinguishes three states with exact exits", () => {
  it("dev-synced: run inside the checkout it was built from → exits EXACTLY 0", () => {
    const { exit, out } = runCheck(REPO_ROOT);
    expect(exit).toBe(0);
    expect(out).toContain("dev-synced");
    expect(out).toContain(buildCommitSha);
  });

  it("dev-stale: build commit is a commit in this repo but not HEAD → exits EXACTLY 3, naming BOTH shas", () => {
    const { exit, out } = runCheck(staleRepo);
    expect(exit).toBe(3);
    expect(out).toContain("dev-stale");
    expect(out).toContain(buildCommitSha);
    expect(out).toContain(staleRepoHeadSha);
    // The fixture is only meaningful if the two shas actually differ.
    expect(staleRepoHeadSha).not.toBe(buildCommitSha);
  });

  it("not-a-dev-checkout: build commit unknown to this repo → exits EXACTLY 0 with the literal token `skipped`", () => {
    // ⛔ The npm-installed consumer. RED (a) — collapsing this into dev-stale —
    // makes this exit 3. The consumer repo has a readable HEAD of its own, so
    // the only thing separating it from dev-stale is commit membership.
    const { exit, out } = runCheck(consumerRepo);
    expect(exit).toBe(0);
    expect(out).toContain("skipped");
    expect(out).not.toContain("dev-stale");
  });

  it("boundary: a git repo with no commit yet is also `skipped`, exit EXACTLY 0", () => {
    const { exit, out } = runCheck(emptyRepo);
    expect(exit).toBe(0);
    expect(out).toContain("skipped");
  });
});

// ─── Surfaces and dispatch ──────────────────────────────────────────────────

describe("--check-binary-provenance surfaces and dispatch precedence", () => {
  it("--json carries the same verdict tokens stdout shows, for each of the three states", () => {
    const synced = runCheck(REPO_ROOT, ["--json"]);
    expect(synced.exit).toBe(0);
    const syncedPayload = JSON.parse(synced.out) as {
      data: { binary_provenance_check: { kind: string; summary: string } };
    };
    expect(syncedPayload.data.binary_provenance_check.kind).toBe("dev-synced");

    const stale = runCheck(staleRepo, ["--json"]);
    expect(stale.exit).toBe(3);
    const stalePayload = JSON.parse(stale.out) as {
      data: { binary_provenance_check: { kind: string; summary: string } };
    };
    expect(stalePayload.data.binary_provenance_check.kind).toBe("dev-stale");
    expect(stalePayload.data.binary_provenance_check.summary).toContain(buildCommitSha);
    expect(stalePayload.data.binary_provenance_check.summary).toContain(staleRepoHeadSha);

    const consumer = runCheck(consumerRepo, ["--json"]);
    expect(consumer.exit).toBe(0);
    const consumerPayload = JSON.parse(consumer.out) as {
      data: { binary_provenance_check: { kind: string; summary: string } };
    };
    expect(consumerPayload.data.binary_provenance_check.kind).toBe("not-a-dev-checkout");
    expect(consumerPayload.data.binary_provenance_check.summary).toContain("skipped");
  }, 60_000);

  it("takes precedence over every other status flag, and needs no corpus to do it", () => {
    // Run from a directory that is a git repo but has NO corpus: a combined
    // invocation must still produce the provenance verdict and its exit code,
    // proving the branch returns before anything reaches loadLoreApp.
    const { exit, out } = runCheck(consumerRepo, ["--check-claude-md", "--check-tree", "--check-drift"]);
    expect(exit).toBe(0);
    expect(out).toContain("skipped");
    expect(out).not.toContain("CLAUDE.md");
  });

  it("rejects an unknown neighbouring flag through the existing strict-flag seam (exit 2)", () => {
    const { exit } = runCheck(consumerRepo, ["--check-binary-provenanc"]);
    expect(exit).toBe(2);
  });
});
