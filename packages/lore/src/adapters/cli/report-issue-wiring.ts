/**
 * Shared CLI/MCP composition helper for `lore report-issue` / `lore_report_issue`
 * (SPEC-072 T5) — builds the real `IssueReportDeps` bundle both surfaces inject
 * into `IssueReportService`, so the two adapters never independently re-derive
 * the upstream wiring (config load, schema probe, port construction, receipt
 * log path, project/version identity). Mirrors the `phase-wiring.ts`/
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
 *     shape `IssueReportService.report`/`.list` take.
 *   - `buildIssueReportDeps(corpusRoot)` — the real `IssueReportDeps` bundle.
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
 *
 * Side-effect class: IO indirectly (every port this module wires performs
 * real file/db access) — this module itself only constructs objects.
 *
 * Source: SPEC-072 §3 Structure, §4 Public Interface, §11 Downstream Handoff.
 */

import { basename, dirname, join } from "node:path";
import { loadConfig } from "@lore/core/node";
import type { LoreConfig } from "@lore/core";
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
 * @returns a fully-wired `IssueReportDeps` — construction is cheap (mirrors
 *   `ReceiptLog`'s own "cheap to construct per call" doc), so callers may
 *   build a fresh bundle per invocation rather than caching one
 */
export function buildIssueReportDeps(corpusRoot: string): IssueReportDeps {
  return {
    loadUpstreamConfig: (root: string) => loadConfig(root),
    probe: probeUpstreamDb,
    expectedSchemaVersion: LATEST_SCHEMA_VERSION,
    openUpstream: buildUpstreamContext,
    receipts: new ReceiptLog(join(corpusRoot, ".lore", "issue-receipts.jsonl")),
    loreVersion: CLI_VERSION,
    reporterProject: `${basename(corpusRoot)} (${corpusRoot})`,
    now: () => new Date().toISOString(),
  };
}
