/**
 * Shared CLI/MCP composition helper for `lore report-issue` / `lore_report_issue`
 * (SPEC-072 T5; self-provisioning added by
 * spec-out-of-box-reporting-channel-report-issue-self-provisions T3) — builds
 * the real `IssueReportDeps` bundle both surfaces inject into
 * `IssueReportService`, so the two adapters never independently re-derive the
 * upstream wiring (config load, schema probe, port construction, receipt log
 * path, project/version identity). Mirrors the `phase-wiring.ts`/
 * `task-feed-wiring.ts` precedent of a CLI-adjacent shared wiring module — NOT
 * `service/`, since these functions construct real IO ports (`bun:sqlite` via
 * `flows/upstream-context-flow.ts`, filesystem via `ReceiptLog`), which
 * `service/` files never do themselves (composition lives in adapters/`flows/`,
 * per this repo's service-layer convention).
 *
 * Public surface:
 *   - `resolveConsumerCorpusRoot()` — the CALLING corpus's own root directory
 *     (the one containing `.lore/`), derived the SAME walk-up `loadLoreApp`
 *     uses — NOT the upstream corpus this feature reports issues INTO.
 *   - `resolveFeedbackUpstreamCfg(config)` — narrows a parsed `LoreConfig`'s
 *     optional `feedback.upstream` section to the `{corpus_path, root_prd}`
 *     shape `IssueReportService.report`/`.list` take. STAYS the ONLY
 *     `feedback.upstream` READ site (plan invariant) — self-provisioning
 *     below never reads it, only writes it.
 *   - `buildIssueReportDeps(corpusRoot)` — the real `IssueReportDeps` bundle.
 *   - `resolveUpstreamFromInstalledBinary(ctx?)` — self-provisioning READ
 *     half: resolves + identity-verifies an upstream candidate from the
 *     running binary's own location. Pure reads only, never writes.
 *   - `provisionFeedbackUpstream(consumerCorpusRoot, candidate)` —
 *     self-provisioning WRITE half: the SINGLE `feedback.upstream` config
 *     write, non-destructive + idempotent.
 *
 * Invariants:
 *   - `loadUpstreamConfig` in the returned deps bundle loads the UPSTREAM
 *     corpus's OWN `.lore/config.yaml` (its `sync.enabled` flag) — the SAME
 *     `@lore/core/node` `loadConfig` this codebase's `loader.ts` uses for the
 *     LOCAL corpus, called here against whatever root
 *     `IssueReportService.report`/`.list` pass in (the consumer's configured
 *     `feedback.upstream.corpus_path`, never this process's own cwd).
 *   - `resolveConsumerCorpusRoot` is safe to call from a long-lived MCP
 *     handler despite internally calling `findLoreDbPath` (which
 *     `process.exit(1)`s on a miss) — `loadLoreApp()` already called it once,
 *     successfully, at MCP server STARTUP (`index.ts`'s `--mcp-server`
 *     branch), and `process.cwd()` does not change over the server's
 *     lifetime, so a per-call re-walk from the same cwd cannot newly fail.
 *     This mirrors the established precedent `loader.ts::loadProjectConfig`
 *     already sets (also re-calls `findLoreDbPath()` per MCP `lore_feed`
 *     "task-start" invocation, SPEC-070 F6).
 *   - This module does NO actor resolution — the CLI resolves via
 *     `resolveActor` (fallback chain), MCP requires `by` explicitly
 *     (SPEC-025 precedent); both thread the resolved actor through
 *     `IssueReportInput.by`, never through anything built here.
 *   - Self-provisioning is an IDENTITY PIN, not path trust: a resolved
 *     candidate is accepted only when its `.lore/lore.db` opens (reusing
 *     `buildUpstreamContext`'s own existence/schema-version checks) AND its
 *     root PRD matches `LORE_PROJECT_ROOT_PRD_SLUG` via SPEC-072's own
 *     `matchRootPrd` — never a guess, never a silent fallback to an
 *     unverified path. This module never wires the `--auto-config` CLI flag
 *     itself (that orchestration — deciding WHEN to call these two
 *     functions — is `commands/report-issue.ts`'s job, a separate task).
 *
 * Side-effect class: IO indirectly (every port this module wires performs
 * real file/db access) — `resolveUpstreamFromInstalledBinary` is read-only;
 * `provisionFeedbackUpstream` performs exactly one conditional file write.
 *
 * Source: SPEC-072 §3 Structure, §4 Public Interface, §11 Downstream Handoff;
 * spec-out-of-box-reporting-channel-report-issue-self-provisions §Design
 * ("One resolver, one writer", "Identity pin, not path trust").
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import yaml from "yaml";
import { loadConfig } from "@lore/core/node";
import {
  err,
  FeedbackConfigSchema,
  LoreConfigSchema,
  matchRootPrd,
  ok,
  resolveUpstreamWriteWaitMs,
  type LoreConfig,
  type LoreError,
  type Result,
} from "@lore/core";
import { LATEST_SCHEMA_VERSION } from "../../store/sqlite-store.js";
import { probeUpstreamDb } from "../../flows/upstream-probe.js";
import { buildUpstreamContext } from "../../flows/upstream-context-flow.js";
import { ReceiptLog } from "../../service/receipt-log.js";
import type { IssueReportDeps } from "../../service/issue-report-service.js";
import { findLoreDbPath } from "./utils.js";

/**
 * This install's CLI version string, threaded into every filed report's
 * `extra.issue_report.lore_version` field. Mirrors the pre-existing hardcoded
 * literal in `./index.ts`'s and `../mcp/index.ts`'s own `meta.version` —
 * established precedent in this codebase (neither file reads `package.json`
 * at runtime, since a `bun build --compile` binary cannot reliably resolve a
 * relative `package.json` path post-compile). SPEC-072 introduces no new
 * version SSOT; keep this literal in sync with those two if the CLI version
 * is ever bumped.
 */
const CLI_VERSION = "0.1.0";

/**
 * Resolves the CALLING corpus's own root — the directory containing
 * `.lore/` — via the SAME walk-up `loadLoreApp` uses. This is NEVER the
 * upstream corpus `lore report-issue` files a report INTO; it is where the
 * local receipt log (`<root>/.lore/issue-receipts.jsonl`) lives.
 *
 * @returns absolute path to the consumer corpus root
 * @throws process.exit(1) via `findLoreDbPath` (unchanged CLI convention)
 *   when no `.lore/lore.db` is discoverable from `cwd` — see this module's
 *   header for why this is still safe to call from an MCP tool handler.
 */
export function resolveConsumerCorpusRoot(): string {
  const dbPath = findLoreDbPath();
  return dirname(dirname(dbPath));
}

/** Consumer-side `feedback.upstream.*` config, as `IssueReportService` expects it. */
export type UpstreamCfg = { corpus_path: string; root_prd: string };

/**
 * Narrows a parsed `LoreConfig`'s optional `feedback.upstream` section to the
 * shape `IssueReportService.report`/`.list` take.
 *
 * @param config - the consumer's OWN parsed `.lore/config.yaml` (or
 *   `undefined` when none was found/parsed)
 * @returns `{corpus_path, root_prd}` when configured; `undefined` otherwise
 *   (SPEC-072 §5 step 1's "not configured" case) — `FeedbackConfigSchema`'s
 *   `.strict()` `upstream` object already guarantees BOTH fields are present
 *   whenever the object exists at all, so no partial-config case can reach
 *   here.
 */
export function resolveFeedbackUpstreamCfg(config: LoreConfig | undefined): UpstreamCfg | undefined {
  return config?.feedback?.upstream;
}

/**
 * Builds the real `IssueReportDeps` bundle both `lore report-issue` (CLI) and
 * `lore_report_issue` (MCP) inject into `IssueReportService` — see this
 * module's header for the full port-by-port rationale.
 *
 * @param corpusRoot - the CALLING corpus's own root (see
 *   `resolveConsumerCorpusRoot`) — receipts are written under
 *   `<corpusRoot>/.lore/issue-receipts.jsonl`, and `reporterProject` is
 *   derived from it
 * @param consumerConfig - the CALLING corpus's own parsed config (the CLI's
 *   `loadLoreApp()` result, MCP's `getConfig?.()`), or `undefined` when none
 *   loaded. REQUIRED positionally — deliberately not optional — so a new
 *   caller surface cannot silently skip the declared write-wait bound and
 *   leave `feedback.upstream.write_wait_ms` inert on its path
 *   (spec-report-issue-has-no-specified-concurrency-contract-ac-072 D4).
 *   `undefined` resolves the documented default, never a silent zero.
 * @returns a fully-wired `IssueReportDeps` — construction is cheap (mirrors
 *   `ReceiptLog`'s own "cheap to construct per call" doc), so callers may
 *   build a fresh bundle per invocation rather than caching one
 */
export function buildIssueReportDeps(
  corpusRoot: string,
  consumerConfig: LoreConfig | undefined,
): IssueReportDeps {
  // The DECLARED write-wait bound, resolved ONCE here and used on EVERY
  // upstream connection this bundle can open: the standalone schema-version
  // probe (`deps.probe`, step 4 of `openValidatedUpstream`), the TOCTOU
  // re-probe + real write connection inside `openUpstream`/
  // `buildUpstreamContext`, and the number `IssueReportService` surfaces
  // verbatim when that bound expires. Resolving it in one place is what makes
  // "the bound printed is the bound applied" true by construction rather than
  // by convention (spec-report-issue-has-no-specified-concurrency-contract-
  // ac-072 D4). Threading it into `probe` too closes
  // task-fix-the-spec-072-cross-corpus-database-is-locked-race: that probe
  // used to open with busy_timeout=0 regardless of this bound, so a reader
  // racing a concurrent writer's `BEGIN IMMEDIATE` failed immediately with a
  // bare "database is locked" instead of waiting out the declared window.
  const writeWaitMs = resolveUpstreamWriteWaitMs(consumerConfig);
  return {
    loadUpstreamConfig: (root: string) => loadConfig(root),
    probe: (dbPath: string) => probeUpstreamDb(dbPath, writeWaitMs),
    expectedSchemaVersion: LATEST_SCHEMA_VERSION,
    openUpstream: (root: string) => buildUpstreamContext(root, { writeWaitMs }),
    receipts: new ReceiptLog(join(corpusRoot, ".lore", "issue-receipts.jsonl")),
    loreVersion: CLI_VERSION,
    reporterProject: `${basename(corpusRoot)} (${corpusRoot})`,
    writeWaitMs,
    now: () => new Date().toISOString(),
  };
}

// ─── Self-provisioning (spec-out-of-box-reporting-channel-report-issue-self-provisions T3) ───

/**
 * The real Lore project's own root-PRD SLUG — the identity every
 * self-provisioned `feedback.upstream` candidate must match before
 * {@link resolveUpstreamFromInstalledBinary} accepts it.
 *
 * Pinned by SLUG, deliberately not by ULID: a ULID is unique per `lore
 * create` invocation, so pinning by id would reject EVERY candidate corpus
 * that seeds its own fresh root PRD with the matching title — which is the
 * only reproducible identity a consumer (or a test fixture) can construct
 * ahead of time. Slug generation is deterministic from title
 * (`@lore/core/node`'s `slugify`/`slugify-node.ts`), so any corpus whose
 * root PRD is titled exactly `"Lore — Internal-First AI Team Knowledge
 * Platform"` reproduces this exact slug with zero collision suffix.
 *
 * Verified directly against the real corpus (a READ, never a write):
 * `lore get prd-lore-internal-first-ai-team-knowledge-platform --json` →
 * `data.doc.slug === "prd-lore-internal-first-ai-team-knowledge-platform"`.
 */
const LORE_PROJECT_ROOT_PRD_SLUG = "prd-lore-internal-first-ai-team-knowledge-platform";

/**
 * Ambient facts about how the CURRENTLY RUNNING `lore` process was invoked —
 * resolved ONCE by the caller and passed in, never read directly inside
 * {@link deriveInstalledBinaryDir} itself. Mirrors `setup-args.ts`'s
 * `SetupPathContext` split (ambient reads live at the call site; the
 * resolution logic they feed stays a plain, directly-testable function).
 */
export interface InstalledBinaryContext {
  /**
   * `Bun.main.startsWith("/$bunfs/")` — the empirically-verified compiled-vs-
   * dev signal `setup-args.ts`'s own module header documents at length (Bun
   * 1.3.x has no public `Bun.isStandaloneExecutable`; `/$bunfs/` is Bun's
   * documented internal prefix for a compiled binary's embedded entry).
   */
  isCompiled: boolean;
  /** `process.execPath` — the compiled binary's own (possibly symlinked) invocation path, consulted only when `isCompiled`. */
  execPath: string;
  /** `Bun.main` — the real on-disk entry script path `bun run <file>` was invoked with, consulted only when NOT `isCompiled`. */
  bunMain: string;
}

/**
 * Realpath-resolves `path`, falling back to `path` unchanged on ANY failure
 * (dangling symlink, permission error, non-existent path) — never throws.
 * Mirrors `setup-args.ts`'s module-local `resolveRealExecPath`'s documented
 * fallback contract (duplicated in miniature rather than imported: that
 * function is not exported, and belongs to a different concern — resolving
 * THIS binary's own bin/assets paths, not an upstream corpus root).
 *
 * @param path - a filesystem path, possibly a symlink chain
 * @returns the fully realpath-resolved path, or `path` itself on failure
 */
function resolveRealpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Derives the directory the running `lore` process was invoked from —
 * symlink-resolved in compiled mode. Exported (and DI-shaped via
 * {@link InstalledBinaryContext}) purely for direct unit testing; production
 * callers reach it only through {@link resolveUpstreamFromInstalledBinary}'s
 * own default `ctx`.
 *
 * @param ctx - `{isCompiled, execPath, bunMain}` — see field docs
 * @returns an absolute directory path. Never throws (delegates the one
 *   fallible read to {@link resolveRealpathOrSelf}).
 * @example
 *   deriveInstalledBinaryDir({isCompiled: true, execPath: "/opt/lore/dist/lore", bunMain: ""})
 *   // "/opt/lore/dist" (or its realpath-resolved equivalent)
 * @example
 *   deriveInstalledBinaryDir({isCompiled: false, execPath: "", bunMain: "/repo/packages/lore/src/index.ts"})
 *   // "/repo/packages/lore/src"
 */
export function deriveInstalledBinaryDir(ctx: InstalledBinaryContext): string {
  const binaryPath = ctx.isCompiled ? resolveRealpathOrSelf(ctx.execPath) : ctx.bunMain;
  return dirname(binaryPath);
}

/**
 * Walks from `startDir` up to the filesystem root looking for a directory
 * carrying `.lore/lore.db` directly beneath it — same walk-up shape as
 * `utils.ts::findLoreDbPath`, parameterized by start directory instead of
 * `process.cwd()`, and returning the CONTAINING directory (a corpus root,
 * the shape `buildUpstreamContext` takes) rather than the db file path
 * itself. Stops at the FIRST match — single-candidate resolution, matching
 * this module's "verify the ONE resolved candidate's identity, never search
 * for a different one" contract (a found-but-wrong-identity candidate is a
 * REJECTION, not a cue to keep walking further up for a better one).
 *
 * @param startDir - directory to start the walk from (checked itself, as
 *   the loop's first candidate, before ascending)
 * @returns the first ancestor directory (inclusive of `startDir`) whose
 *   `.lore/lore.db` exists, or `undefined` when the walk reaches the
 *   filesystem root with no match
 * @example
 *   walkUpForLoreDbRoot("/repo/dist") // "/repo", when /repo/.lore/lore.db exists
 *   walkUpForLoreDbRoot("/tmp/empty") // undefined, when no ancestor has one
 */
export function walkUpForLoreDbRoot(startDir: string): string | undefined {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, ".lore", "lore.db"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resolves the upstream lore corpus to self-provision `feedback.upstream`
 * from — the installed binary's OWN location (symlink → real path →
 * enclosing repo root carrying `.lore/lore.db`), accepted ONLY when its root
 * PRD matches the real Lore project's identity ({@link
 * LORE_PROJECT_ROOT_PRD_SLUG}, via SPEC-072's own `matchRootPrd` — path
 * existence alone is insufficient, spec Design "Identity pin, not path
 * trust"). Pure resolution + identity verification: the only side effects
 * are READS (a filesystem walk, opening the candidate's SQLite db) — this
 * function never writes anything; see {@link provisionFeedbackUpstream} for
 * the write half.
 *
 * @param ctx - defaults to the REAL ambient `Bun.main`/`process.execPath`
 *   facts; tests pass a fabricated context to exercise this function without
 *   spawning a subprocess
 * @returns `ok({corpus_path, root_prd})` — `root_prd` is the matched
 *   candidate's OWN slug (read back from the candidate, never assumed from
 *   the constant, so the written value always reflects what was actually
 *   found). `err(VALIDATION_ERROR)` on ANY failure: no `.lore/lore.db` found
 *   walking up from the installed binary's location, the found candidate's
 *   db won't open (missing/unreadable/schema-version mismatch —
 *   `buildUpstreamContext`'s own checks), the candidate has no root PRD at
 *   all, or its root PRD does not match — every case names what failed and
 *   the path/identity involved. NEVER a guess, NEVER a silent fallback.
 * @example
 *   const result = await resolveUpstreamFromInstalledBinary();
 *   // result.ok === true → {corpus_path: "/opt/lore", root_prd: "prd-lore-internal-first-ai-team-knowledge-platform"}
 */
export async function resolveUpstreamFromInstalledBinary(
  ctx: InstalledBinaryContext = {
    isCompiled: Bun.main.startsWith("/$bunfs/"),
    execPath: process.execPath,
    bunMain: Bun.main,
  },
): Promise<Result<UpstreamCfg, LoreError>> {
  const startDir = deriveInstalledBinaryDir(ctx);
  const corpusRoot = walkUpForLoreDbRoot(startDir);
  if (corpusRoot === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "feedback.upstream",
      message:
        `could not resolve an upstream lore corpus from the installed binary — walked up from ` +
        `'${startDir}' to the filesystem root without finding a '.lore/lore.db'. Is this lore ` +
        "install running from inside a lore-init'd repo checkout?",
      value: startDir,
    });
  }

  const upstreamResult = buildUpstreamContext(corpusRoot);
  if (!upstreamResult.ok) return upstreamResult;
  const port = upstreamResult.value;
  try {
    const rootResult = await port.resolveRootDoc();
    if (!rootResult.ok) return rootResult;
    const root = rootResult.value;
    if (root === null) {
      return err({
        code: "VALIDATION_ERROR",
        field: "feedback.upstream.root_prd",
        message:
          `resolved candidate corpus at '${corpusRoot}' has no root PRD at all — refusing to ` +
          "self-provision an upstream with no identity to verify.",
        value: { expected: LORE_PROJECT_ROOT_PRD_SLUG, found: null, corpus_path: corpusRoot },
      });
    }
    const match = matchRootPrd(root, LORE_PROJECT_ROOT_PRD_SLUG);
    if (!match.ok) {
      return err({
        code: "VALIDATION_ERROR",
        field: "feedback.upstream.root_prd",
        message:
          `resolved candidate corpus at '${corpusRoot}' has the wrong root-PRD identity: expected ` +
          `'${LORE_PROJECT_ROOT_PRD_SLUG}', found '${match.found}' — refusing to self-provision an ` +
          "upstream that is not the real Lore project corpus.",
        value: { expected: LORE_PROJECT_ROOT_PRD_SLUG, found: match.found, corpus_path: corpusRoot },
      });
    }
    return ok({ corpus_path: corpusRoot, root_prd: root.slug });
  } finally {
    port.close();
  }
}

/**
 * The SINGLE `feedback.upstream` config write — non-destructive (every OTHER
 * top-level and nested key in the consumer's `.lore/config.yaml` survives
 * verbatim) and idempotent (an already-present `feedback.upstream` is left
 * untouched, byte-identical, never overwritten).
 *
 * Deliberately does NOT round-trip through `loadConfig`/`saveConfig`
 * (`@lore/core/node`) — `LoreConfigSchema`'s field-level `.default(...)`
 * values (e.g. `workflow.staleness`, `workflow.drift`) would get filled in
 * and written back for ANY section already present but only partially
 * specified, turning an unrelated single-key addition into a config-wide
 * normalization side effect. AC-OOB-4's non-destructive contract asks for
 * byte-preservation of what's already there, not schema-canonicalization.
 * Instead: read the raw YAML, parse it as a plain object, splice in ONLY
 * `feedback.upstream`, re-serialize — a minimal, surgical merge.
 *
 * @param consumerCorpusRoot - the CALLING corpus's own root (see
 *   `resolveConsumerCorpusRoot`) — `<consumerCorpusRoot>/.lore/config.yaml`
 *   is read and (conditionally) rewritten
 * @param candidate - the resolved upstream identity to write (typically
 *   `resolveUpstreamFromInstalledBinary`'s own `ok` value)
 * @returns `ok(undefined)` on a successful write OR a no-op (already
 *   configured — idempotent). `err(VALIDATION_ERROR)` when `candidate`
 *   itself fails `FeedbackConfigSchema`, the config file's YAML root isn't a
 *   mapping, or the resulting full config would fail `LoreConfigSchema` (a
 *   pre-write gate — zero bytes written on any validation failure, mirroring
 *   `saveGlobalConfig`'s SPEC-064 D7 validate-then-write order). `err(STORE_ERROR)`
 *   on a read/parse/write IO failure.
 * @example
 *   const result = provisionFeedbackUpstream("/consumer/repo", {
 *     corpus_path: "/opt/lore", root_prd: "prd-lore-internal-first-ai-team-knowledge-platform",
 *   });
 *   // result.ok === true; /consumer/repo/.lore/config.yaml now carries feedback.upstream,
 *   // every other pre-existing key untouched
 */
export function provisionFeedbackUpstream(
  consumerCorpusRoot: string,
  candidate: UpstreamCfg,
): Result<void, LoreError> {
  const configPath = join(consumerCorpusRoot, ".lore", "config.yaml");

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (e) {
    return err({
      code: "STORE_ERROR",
      message: `could not read consumer config at '${configPath}': ${e instanceof Error ? e.message : String(e)}`,
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }

  let parsed: unknown;
  try {
    parsed = yaml.parse(raw);
  } catch {
    return err({
      code: "VALIDATION_ERROR",
      field: "yaml",
      message: `failed to parse '${configPath}': malformed YAML — refusing to write into it.`,
      value: raw,
    });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "root",
      message: `'${configPath}' does not parse to a YAML mapping at its root — refusing to write feedback.upstream into it.`,
      value: parsed,
    });
  }

  const config = parsed as Record<string, unknown>;
  const existingFeedback =
    typeof config["feedback"] === "object" && config["feedback"] !== null && !Array.isArray(config["feedback"])
      ? (config["feedback"] as Record<string, unknown>)
      : undefined;

  // Idempotent: an already-configured feedback.upstream is NEVER overwritten.
  if (existingFeedback?.["upstream"] !== undefined) {
    return ok(undefined);
  }

  const candidateParse = FeedbackConfigSchema.safeParse({ upstream: candidate });
  if (!candidateParse.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "feedback.upstream",
      message:
        `resolved upstream candidate failed FeedbackConfigSchema validation: ` +
        `${candidateParse.error.issues[0]?.message ?? "unknown validation error"}`,
      value: candidate,
    });
  }

  const nextConfig: Record<string, unknown> = {
    ...config,
    feedback: { ...(existingFeedback ?? {}), upstream: candidate },
  };

  // Pre-write gate (SPEC-064 D7 validate-then-write precedent) — zero bytes
  // written if the resulting full config would be schema-invalid. Discards
  // `.data` deliberately (see module doc "Deliberately does NOT round-trip");
  // this parse only GATES validity, `nextConfig` (not `.data`) is what's written.
  const fullParse = LoreConfigSchema.safeParse(nextConfig);
  if (!fullParse.success) {
    const firstIssue = fullParse.error.issues[0];
    return err({
      code: "VALIDATION_ERROR",
      field: firstIssue !== undefined ? firstIssue.path.join(".") || "root" : "root",
      message: firstIssue !== undefined ? firstIssue.message : fullParse.error.message,
      value: nextConfig,
    });
  }

  try {
    writeFileSync(configPath, yaml.stringify(nextConfig), "utf8");
  } catch (e) {
    return err({
      code: "STORE_ERROR",
      message: `failed to write '${configPath}': ${e instanceof Error ? e.message : String(e)}`,
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }

  return ok(undefined);
}
