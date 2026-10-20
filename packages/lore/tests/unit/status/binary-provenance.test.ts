// @spawns scripts/build.ts
// @spawns dist/lore
/**
 * AC-BFI-1 oracle — `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`.
 *
 * Proves that a binary produced by a REAL `bun run build` carries the commit it
 * was built from, and that `lore status --json` exposes it as
 * `binary_provenance{build_commit, build_dirty, built_at}`.
 *
 * ⛔ WHY THIS FILE RUNS A REAL BUILD instead of asserting a shape: a hardcoded
 * 40-hex placeholder satisfies `/^[0-9a-f]{40}$/`, so a shape assertion has
 * ZERO power to tell a measured commit from a plausible fake. The assertions
 * below therefore compare against facts read INDEPENDENTLY at test time —
 * `git rev-parse HEAD` for the commit, `git status --porcelain` for the
 * dirtiness, and this process's own wall clock for `built_at`. The declared
 * REDs are (a) remove the `define` injection from `scripts/build.ts` → the
 * field is null → fails, and (b) replace the injection with a well-formed
 * CONSTANT sha → the shape still passes but the equality-to-real-HEAD
 * assertion fails. (b) is the one that matters, and only an equality
 * assertion can catch it.
 *
 * The rest of the file is subprocess-free unit coverage of
 * `service/binary-provenance.ts`'s pure surface — the classifier, the
 * compiled-vs-source discriminator (D2), the embedded-literal reader, the
 * renderer, and the exit map. Those back BOTH AC-BFI-1 and AC-BFI-2; AC-BFI-2's
 * own oracle (`tests/integration/binary-provenance-check.test.ts`) drives the
 * three states through the REAL compiled binary rather than through fabricated
 * facts, because a classifier that is right about hand-built facts proves
 * nothing about the CLI a user actually runs.
 *
 * SAFETY: never writes to the repo's own `.lore/` — the status read below runs
 * inside a `mkdtemp` throwaway corpus (project CLAUDE.md hard rule).
 *
 * ⛔ TG-24: this suite builds into its OWN `mkdtemp` path with
 * `scripts/build.ts --outfile`, never into `dist/`. The build's generated-source
 * write is idempotent (see the outfile comment in `scripts/build.ts`), so this
 * variant build cannot make a source newer than `dist/lore` and trip the
 * stale-binary check (`tests/integration/helpers/assert-fresh-binary.ts`) of the
 * compiled tests running in parallel.
 *
 * Coverage dimensions: HAPPY (real build → real HEAD equality) / NEGATIVE
 * (malformed and schema-violating embedded payloads) / BOUNDARY (unreadable
 * HEAD; dirty tree at HEAD) / ERROR (a compiled binary carrying no provenance
 * fails loud rather than degrading to `skipped`) / STATE (all five verdicts and
 * their exact exit codes) / REGRESSION (git is never probed when there is no
 * build commit to classify).
 *
 * @spec_ref AC-BFI-1
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BINARY_PROVENANCE_EXIT_CODES,
  BUN_COMPILED_ENTRY_PREFIX,
  classifyBinaryProvenance,
  formatBinaryProvenanceStatusLine,
  gatherBinaryProvenanceFacts,
  isCompiledBinary,
  parseEmbeddedBuildProvenance,
  provenanceOrNull,
  readEmbeddedBuildProvenance,
  renderBinaryProvenanceVerdict,
  type BinaryProvenanceFacts,
  type BuildProvenance,
  type GitProvenanceProbe,
} from "../../../src/service/binary-provenance.js";

// ─── Paths ──────────────────────────────────────────────────────────────────

/** Repo root: five levels up from `packages/lore/tests/unit/status/`. Asserted in `beforeAll`. */
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url)).replace(/\/$/, "");

/** Resolves a binary through the test runner's own PATH (`bunx vitest` runs test files under node). */
function resolveBinOrThrow(name: string): string {
  const resolved = execSync(`command -v ${name}`, { encoding: "utf8" }).trim();
  if (resolved.length === 0) {
    throw new Error(`binary-provenance.test.ts: could not resolve \`${name}\` via \`command -v\``);
  }
  return resolved;
}

const BUN_BIN = resolveBinOrThrow("bun");
const GIT_BIN = resolveBinOrThrow("git");

/**
 * Ambient env minus secret-shaped names and minus `NODE_ENV`/`TEST` — the
 * latter two are stripped per `npm-install-simulation.test.ts`'s measured
 * finding that the compiled binary's citty/consola output can go silent under
 * them, which would read here as a false "empty stdout".
 */
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

/** `git <args>` in `cwd`, trimmed stdout. Throws on non-zero — these reads must never degrade silently. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_BIN, args, { cwd, encoding: "utf8" }).trim();
}

// ─── Suite state, captured once in beforeAll ────────────────────────────────

let tempRoot = "";
let builtBinary = "";
let realHeadSha = "";
let porcelainBeforeBuild = "";
let porcelainAfterBuild = "";
let buildSpawnedAtMs = 0;
let buildFinishedAtMs = 0;
let statusJson: { binary_provenance: BuildProvenance | null } = { binary_provenance: null };

beforeAll(() => {
  if (!existsSync(join(REPO_ROOT, "scripts", "build.ts"))) {
    throw new Error(
      `binary-provenance.test.ts: REPO_ROOT resolved to "${REPO_ROOT}", which has no scripts/build.ts — ` +
        `the up-level count in this file's REPO_ROOT is wrong.`,
    );
  }

  tempRoot = mkdtempSync(join(tmpdir(), "lore-bfi1-"));
  // reason: a compiled `lore init` reads the config template from `<binary dir>/../assets`
  // (DC2-5), as an installed package ships it beside the binary; the variant binary sits in `<tempRoot>/bin`, so
  // `<tempRoot>/assets` links the repo's assets in.
  mkdirSync(join(tempRoot, "bin"), { recursive: true });
  symlinkSync(join(REPO_ROOT, "assets"), join(tempRoot, "assets"));
  builtBinary = join(tempRoot, "bin", "lore");

  // Porcelain is read on BOTH sides of the build. `scripts/build.ts` samples it
  // once, immediately before `Bun.build`; if a concurrent writer moved the tree
  // during the build the two samples disagree, and the assertion below reports
  // THAT rather than blaming the injection for someone else's write.
  porcelainBeforeBuild = git(REPO_ROOT, "status", "--porcelain");

  buildSpawnedAtMs = Date.now();
  // TG-24: build into THIS suite's own mkdtemp path (`--outfile`), never into dist/.
  const build = spawnSync(BUN_BIN, ["run", "scripts/build.ts", "--outfile", builtBinary], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: sanitizedEnv(),
    timeout: 300_000,
  });
  buildFinishedAtMs = Date.now();
  if (build.status !== 0) {
    throw new Error(
      `variant build failed (exit ${String(build.status)}, signal ${String(build.signal)}):\n${build.stdout ?? ""}\n${build.stderr ?? ""}`,
    );
  }
  if (!existsSync(builtBinary)) {
    throw new Error(`the variant build exited 0 but produced no binary at ${builtBinary}`);
  }
  chmodSync(builtBinary, 0o755);

  porcelainAfterBuild = git(REPO_ROOT, "status", "--porcelain");
  realHeadSha = git(REPO_ROOT, "rev-parse", "HEAD");

  // Throwaway corpus — `lore status` needs one, and the repo's own `.lore/` is
  // never an acceptable target for a test (project CLAUDE.md hard rule).
  const corpusDir = join(tempRoot, "corpus");
  mkdirSync(corpusDir, { recursive: true });
  const init = spawnSync(builtBinary, ["init", "--name", "bfi1-throwaway"], {
    cwd: corpusDir,
    encoding: "utf8",
    env: sanitizedEnv(),
  });
  if (init.status !== 0) {
    throw new Error(`throwaway 'lore init' failed (exit ${String(init.status)}): ${init.stderr ?? ""}`);
  }

  const status = spawnSync(builtBinary, ["status", "--json"], {
    cwd: corpusDir,
    encoding: "utf8",
    env: sanitizedEnv(),
  });
  if (status.status !== 0) {
    throw new Error(`'lore status --json' failed (exit ${String(status.status)}): ${status.stderr ?? ""}`);
  }
  const envelope = JSON.parse(status.stdout) as { ok: boolean; data: { binary_provenance: BuildProvenance | null } };
  statusJson = envelope.data;
}, 300_000);

afterAll(() => {
  if (tempRoot.length > 0) rmSync(tempRoot, { recursive: true, force: true });
});

// ─── AC-BFI-1: the embedded provenance is MEASURED, not plausible ───────────

describe("AC-BFI-1: a bun run build binary carries provenance pinned to the real build tree", () => {
  it("exposes binary_provenance on lore status --json", () => {
    expect(statusJson.binary_provenance).not.toBeNull();
    expect(Object.keys(statusJson.binary_provenance ?? {}).sort()).toEqual([
      "build_commit",
      "build_dirty",
      "built_at",
    ]);
  });

  it("embeds a build_commit EQUAL to the HEAD sha read independently via git rev-parse at test time", () => {
    // ⛔ Equality, never a /^[0-9a-f]{40}$/ shape check: RED (b) replaces the
    // injection with a well-formed CONSTANT sha, which a shape check accepts.
    expect(statusJson.binary_provenance?.build_commit).toBe(realHeadSha);
    expect(realHeadSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("embeds a build_dirty EQUAL to the build tree's actual porcelain-emptiness", () => {
    // AC-BFI-1 pins `build_dirty` to porcelain-EMPTINESS — a boolean — so that
    // is what is compared. ⛔ Do not tighten this back to string identity of
    // the two porcelain listings: that asserts something the criterion never
    // claims and `build_dirty` could not encode anyway, and it is FALSIFIED by
    // an unrelated untracked path appearing mid-build (measured 2026-08-17: a
    // co-scheduled suite's dashboard prebuild created the un-gitignored
    // `packages/dashboard/.tanstack/` between the two samples, reddening a
    // sound implementation). The before/after guard is RETAINED at the boolean
    // level, so a concurrent writer that genuinely flips the tree from clean to
    // dirty still fails loudly instead of being absorbed.
    const dirtyBeforeBuild = porcelainBeforeBuild.length > 0;
    const dirtyAfterBuild = porcelainAfterBuild.length > 0;
    expect(dirtyAfterBuild).toBe(dirtyBeforeBuild);
    expect(statusJson.binary_provenance?.build_dirty).toBe(dirtyAfterBuild);
  });

  it("embeds a built_at that falls inside this test run's own build window", () => {
    // A hardcoded timestamp cannot satisfy this: the window opens when THIS
    // process spawned the build and closes when the build returned.
    const builtAtMs = Date.parse(statusJson.binary_provenance?.built_at ?? "");
    expect(Number.isFinite(builtAtMs)).toBe(true);
    expect(builtAtMs).toBeGreaterThanOrEqual(buildSpawnedAtMs - 1000);
    expect(builtAtMs).toBeLessThanOrEqual(buildFinishedAtMs + 1000);
  });
});

// ─── D2: compiled-vs-source discriminator ───────────────────────────────────

describe("D2 compiled-vs-source discriminator", () => {
  it("treats Bun's /$bunfs/ entry prefix as compiled and a real on-disk entry as source", () => {
    expect(BUN_COMPILED_ENTRY_PREFIX).toBe("/$bunfs/");
    expect(isCompiledBinary("/$bunfs/root/index.js")).toBe(true);
    expect(isCompiledBinary("/repo/packages/lore/src/index.ts")).toBe(false);
    expect(isCompiledBinary("")).toBe(false);
    // A path that merely CONTAINS the marker is not an entry under it.
    expect(isCompiledBinary("/repo/$bunfs/index.ts")).toBe(false);
  });

  it("classifies this vitest worker (uncompiled, no injection) as a legitimate source-run, exit 0", () => {
    const read = readEmbeddedBuildProvenance();
    expect(read.kind).toBe("absent");
    const verdict = classifyBinaryProvenance({
      embedded: read,
      is_compiled: false,
      repo_head: null,
      build_commit_in_repo: false,
    });
    expect(verdict.kind).toBe("source-run");
    expect(BINARY_PROVENANCE_EXIT_CODES[verdict.kind]).toBe(0);
  });
});

// ─── Embedded-literal reader ────────────────────────────────────────────────

const SAMPLE: BuildProvenance = {
  build_commit: "0123456789abcdef0123456789abcdef01234567",
  build_dirty: false,
  built_at: "2026-08-17T03:45:21.774Z",
};

describe("readEmbeddedBuildProvenance / parseEmbeddedBuildProvenance", () => {
  it("accepts a well-formed payload", () => {
    const read = parseEmbeddedBuildProvenance(JSON.stringify(SAMPLE));
    expect(read).toEqual({ kind: "present", provenance: SAMPLE });
    expect(provenanceOrNull(read)).toEqual(SAMPLE);
  });

  it("reports non-JSON as malformed rather than throwing or degrading to absent", () => {
    const read = parseEmbeddedBuildProvenance("{not json");
    expect(read.kind).toBe("malformed");
    expect(provenanceOrNull(read)).toBeNull();
  });

  it("rejects a payload whose build_commit is not a 40-hex sha", () => {
    const read = parseEmbeddedBuildProvenance(JSON.stringify({ ...SAMPLE, build_commit: "deadbeef" }));
    expect(read.kind).toBe("malformed");
    expect(read.kind === "malformed" ? read.reason : "").toContain("build_commit");
  });

  it("rejects a payload missing built_at", () => {
    const read = parseEmbeddedBuildProvenance(JSON.stringify({ build_commit: SAMPLE.build_commit, build_dirty: true }));
    expect(read.kind).toBe("malformed");
    expect(read.kind === "malformed" ? read.reason : "").toContain("built_at");
  });

  it("renders a status line for every read outcome, never silence", () => {
    expect(formatBinaryProvenanceStatusLine({ kind: "present", provenance: SAMPLE })).toContain(SAMPLE.build_commit);
    expect(formatBinaryProvenanceStatusLine({ kind: "absent" })).toContain("none embedded");
    expect(formatBinaryProvenanceStatusLine({ kind: "malformed", raw: "x", reason: "bad" })).toContain("MALFORMED");
  });
});

// ─── Pure classifier: all five states + their exact exit codes ──────────────

/** Builds classifier facts, defaulting to the dev-synced shape. */
function facts(overrides: Partial<BinaryProvenanceFacts> = {}): BinaryProvenanceFacts {
  return {
    embedded: { kind: "present", provenance: SAMPLE },
    is_compiled: true,
    repo_head: SAMPLE.build_commit,
    build_commit_in_repo: true,
    ...overrides,
  };
}

describe("classifyBinaryProvenance", () => {
  it("dev-synced when the build commit is the repo's HEAD → exit exactly 0", () => {
    const verdict = classifyBinaryProvenance(facts());
    expect(verdict.kind).toBe("dev-synced");
    expect(BINARY_PROVENANCE_EXIT_CODES[verdict.kind]).toBe(0);
  });

  it("dev-stale when the build commit is in the repo but is not HEAD → exit exactly 3, naming both shas", () => {
    const head = "1111111111111111111111111111111111111111";
    const verdict = classifyBinaryProvenance(facts({ repo_head: head }));
    expect(verdict.kind).toBe("dev-stale");
    expect(BINARY_PROVENANCE_EXIT_CODES[verdict.kind]).toBe(3);
    const rendered = renderBinaryProvenanceVerdict(verdict);
    expect(rendered.summary).toContain(SAMPLE.build_commit);
    expect(rendered.summary).toContain(head);
  });

  it("not-a-dev-checkout when the build commit is unknown to the repo → exit exactly 0 with `skipped`", () => {
    // ⛔ This is the npm-installed consumer. Collapsing it into dev-stale (RED
    // (a)) would exit 3 here and tell a consumer their binary is stale.
    const verdict = classifyBinaryProvenance(
      facts({ repo_head: "1111111111111111111111111111111111111111", build_commit_in_repo: false }),
    );
    expect(verdict.kind).toBe("not-a-dev-checkout");
    expect(verdict.kind === "not-a-dev-checkout" ? verdict.reason : "").toBe("build-commit-unknown-to-repo");
    expect(BINARY_PROVENANCE_EXIT_CODES[verdict.kind]).toBe(0);
    expect(renderBinaryProvenanceVerdict(verdict).summary).toContain("skipped");
  });

  it("not-a-dev-checkout when HEAD is unreadable, so dev-stale can never lack a sha to name", () => {
    const verdict = classifyBinaryProvenance(facts({ repo_head: null, build_commit_in_repo: true }));
    expect(verdict.kind).toBe("not-a-dev-checkout");
    expect(verdict.kind === "not-a-dev-checkout" ? verdict.reason : "").toBe("no-readable-head");
    expect(renderBinaryProvenanceVerdict(verdict).summary).toContain("skipped");
  });

  it("source-run when uncompiled and unprovenanced → exit exactly 0 with `skipped`", () => {
    const verdict = classifyBinaryProvenance(facts({ embedded: { kind: "absent" }, is_compiled: false }));
    expect(verdict.kind).toBe("source-run");
    expect(BINARY_PROVENANCE_EXIT_CODES[verdict.kind]).toBe(0);
    expect(renderBinaryProvenanceVerdict(verdict).summary).toContain("skipped");
  });

  it("provenance-missing — a COMPILED binary with no provenance fails loud on exit 4, never `skipped`", () => {
    // D2: the whole mechanism is hollow if a build that forgot the injection
    // passes silently. `skipped` must NOT appear here.
    const verdict = classifyBinaryProvenance(facts({ embedded: { kind: "absent" }, is_compiled: true }));
    expect(verdict.kind).toBe("provenance-missing");
    expect(BINARY_PROVENANCE_EXIT_CODES[verdict.kind]).toBe(4);
    const summary = renderBinaryProvenanceVerdict(verdict).summary;
    expect(summary).toContain("BUILD DEFECT");
    expect(summary).not.toContain("skipped");
  });

  it("provenance-missing — a COMPILED binary with a malformed payload also fails loud on exit 4", () => {
    const verdict = classifyBinaryProvenance(
      facts({ embedded: { kind: "malformed", raw: "{", reason: "not valid JSON" }, is_compiled: true }),
    );
    expect(verdict.kind).toBe("provenance-missing");
    expect(BINARY_PROVENANCE_EXIT_CODES[verdict.kind]).toBe(4);
  });

  it("keeps a dirty tree at HEAD on dev-synced/exit 0 (D1) while NAMING the dirtiness", () => {
    const dirty: BuildProvenance = { ...SAMPLE, build_dirty: true };
    const verdict = classifyBinaryProvenance(facts({ embedded: { kind: "present", provenance: dirty } }));
    expect(verdict.kind).toBe("dev-synced");
    expect(BINARY_PROVENANCE_EXIT_CODES[verdict.kind]).toBe(0);
    expect(renderBinaryProvenanceVerdict(verdict).summary).toContain("DIRTY");
  });

  it("assigns an exit code to every verdict kind — no kind can ship uncoded", () => {
    expect(Object.values(BINARY_PROVENANCE_EXIT_CODES).sort()).toEqual([0, 0, 0, 3, 4]);
  });
});

// ─── REGRESSION: no pointless (or misleading) git probing ───────────────────

describe("gatherBinaryProvenanceFacts", () => {
  it("never probes git when there is no build commit to classify", () => {
    // A source run must not be classified against whatever repo the user
    // happens to stand in — there is nothing to compare, and two `git` spawns
    // per `lore status` would be pure cost.
    const calls: string[] = [];
    const probe: GitProvenanceProbe = {
      readHeadCommit: (cwd) => {
        calls.push(`head:${cwd}`);
        return "1111111111111111111111111111111111111111";
      },
      hasCommit: (cwd, sha) => {
        calls.push(`has:${cwd}:${sha}`);
        return true;
      },
    };
    const gathered = gatherBinaryProvenanceFacts({
      embedded: { kind: "absent" },
      is_compiled: false,
      cwd: "/anywhere",
      probe,
    });
    expect(calls).toEqual([]);
    expect(gathered.repo_head).toBeNull();
    expect(gathered.build_commit_in_repo).toBe(false);
  });

  it("probes HEAD and commit-membership exactly once each when provenance is present", () => {
    const calls: string[] = [];
    const probe: GitProvenanceProbe = {
      readHeadCommit: (cwd) => {
        calls.push(`head:${cwd}`);
        return SAMPLE.build_commit;
      },
      hasCommit: (cwd, sha) => {
        calls.push(`has:${cwd}:${sha}`);
        return true;
      },
    };
    const gathered = gatherBinaryProvenanceFacts({
      embedded: { kind: "present", provenance: SAMPLE },
      is_compiled: true,
      cwd: "/repo",
      probe,
    });
    expect(calls).toEqual([`head:/repo`, `has:/repo:${SAMPLE.build_commit}`]);
    expect(classifyBinaryProvenance(gathered).kind).toBe("dev-synced");
  });
});
