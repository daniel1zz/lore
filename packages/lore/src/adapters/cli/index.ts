/**
 * Main CLI definition — aggregates all subcommands with lazy imports.
 * Entry point: src/index.ts calls runMain(main).
 *
 * Every subcommand import is piped through `wrapDefault` (SPEC-051 D1) — the
 * ONE composition-site seam that wires strict unknown-flag rejection onto
 * every command (and, recursively via `wrapCommandStrict`, every nested
 * group leaf like `gate spec-create` / `phase add` / `anchor rm`) without
 * editing any individual `commands/*.ts` file for that concern. See
 * `strict-flags.ts`'s module header for the full rationale.
 */

import { defineCommand } from "citty";
import type { CommandDef } from "citty";
import { wrapCommandStrict } from "./strict-flags.js";

/**
 * Build the `.then()` callback for one lazily-imported command module:
 * resolves its `default` export and layers SPEC-051 D1 strict-flag
 * enforcement on top. `name` becomes the `--help` pointer rendered in an
 * "Unknown option" error (e.g. `"link"` → `lore link --help`).
 *
 * @param name - the CLI subcommand name as typed after `lore` (no leading `lore `)
 * @returns a `.then()`-compatible callback: `{ default: CommandDef } => Promise<CommandDef>`
 */
function wrapDefault(name: string): (m: { default: CommandDef<any> }) => Promise<CommandDef> {
  return (m) => wrapCommandStrict(m.default, `lore ${name}`);
}

const main = defineCommand({
  meta: {
    name: "lore",
    version: "0.1.0",
    description: "AI-native shared knowledge/memory platform",
  },
  subCommands: {
    init: () => import("./commands/init.js").then(wrapDefault("init")),
    create: () => import("./commands/create.js").then(wrapDefault("create")),
    get: () => import("./commands/get.js").then(wrapDefault("get")),
    set: () => import("./commands/set.js").then(wrapDefault("set")),
    delete: () => import("./commands/delete.js").then(wrapDefault("delete")),
    list: () => import("./commands/list.js").then(wrapDefault("list")),
    search: () => import("./commands/search.js").then(wrapDefault("search")),
    tree: () => import("./commands/tree.js").then(wrapDefault("tree")),
    link: () => import("./commands/link.js").then(wrapDefault("link")),
    unlink: () => import("./commands/unlink.js").then(wrapDefault("unlink")),
    pending: () => import("./commands/pending.js").then(wrapDefault("pending")),
    approve: () => import("./commands/approve.js").then(wrapDefault("approve")),
    reject: () => import("./commands/reject.js").then(wrapDefault("reject")),
    log: () => import("./commands/log.js").then(wrapDefault("log")),
    diff: () => import("./commands/diff.js").then(wrapDefault("diff")),
    restore: () => import("./commands/restore.js").then(wrapDefault("restore")),
    migrate: () => import("./commands/migrate.js").then(wrapDefault("migrate")),
    status: () => import("./commands/status.js").then(wrapDefault("status")),
    serve: () => import("./commands/serve.js").then(wrapDefault("serve")),
    agent: () => import("./commands/agent.js").then(wrapDefault("agent")),
    sync: () => import("./commands/sync.js").then(wrapDefault("sync")),
    eval: () => import("./commands/eval.js").then(wrapDefault("eval")),
    dashboard: () => import("./commands/dashboard.js").then(wrapDefault("dashboard")),
    "sync-docs": () => import("./commands/sync-docs.js").then(wrapDefault("sync-docs")),
    "export-docs": () => import("./commands/export-docs.js").then(wrapDefault("export-docs")),
    phase: () => import("./commands/phase.js").then(wrapDefault("phase")),
    claim: () => import("./commands/claim.js").then(wrapDefault("claim")),
    release: () => import("./commands/release.js").then(wrapDefault("release")),
    evidence: () => import("./commands/evidence.js").then(wrapDefault("evidence")),
    // done (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3) —
    // evidence-validated atomic lifecycle walk to archived; see commands/done.ts's
    // module header.
    done: () => import("./commands/done.js").then(wrapDefault("done")),
    ready: () => import("./commands/ready.js").then(wrapDefault("ready")),
    assess: () => import("./commands/assess.js").then(wrapDefault("assess")),
    audit: () => import("./commands/audit.js").then(wrapDefault("audit")),
    calibration: () => import("./commands/calibration.js").then(wrapDefault("calibration")),
    review: () => import("./commands/review.js").then(wrapDefault("review")),
    ac: () => import("./commands/ac.js").then(wrapDefault("ac")),
    verify: () => import("./commands/verify.js").then(wrapDefault("verify")),
    gate: () => import("./commands/gate.js").then(wrapDefault("gate")),
    feed: () => import("./commands/feed.js").then(wrapDefault("feed")),
    bootstrap: () => import("./commands/bootstrap.js").then(wrapDefault("bootstrap")),
    handoff: () => import("./commands/handoff.js").then(wrapDefault("handoff")),
    uat: () => import("./commands/uat.js").then(wrapDefault("uat")),
    requirement: () => import("./commands/requirement.js").then(wrapDefault("requirement")),
    anchor: () => import("./commands/anchor.js").then(wrapDefault("anchor")),
    // scope (spec-declared-scope-attestation-contract-task-owned-ac-scope) —
    // dedicated writer for a task's/phase's `extra.ac_scope`, the anchor
    // command's sibling; see commands/scope.ts's module header.
    scope: () => import("./commands/scope.js").then(wrapDefault("scope")),
    invalidate: () => import("./commands/invalidate.js").then(wrapDefault("invalidate")),
    setup: () => import("./commands/setup.js").then(wrapDefault("setup")),
    // governance (SPEC-083 D1) — bootstrap-stage, no corpus required; see
    // commands/governance.ts's module header.
    governance: () => import("./commands/governance.js").then(wrapDefault("governance")),
    // context (spec-context-verb-family-two-zone-claude-md-anatomy-lore) — init/refresh
    // the two-zone root CLAUDE.md; see commands/context.ts's module header.
    context: () => import("./commands/context.js").then(wrapDefault("context")),
    outline: () => import("./commands/outline.js").then(wrapDefault("outline")),
    seat: () => import("./commands/seat.js").then(wrapDefault("seat")),
    "report-issue": () => import("./commands/report-issue.js").then(wrapDefault("report-issue")),
    // issue / issues (spec-issue-closure-loop-computed-resolution-agent-reachable
    // §D3/D4) — `issue resolve` writes the explicit rejected/wontfix terminal
    // state; `issues` is the upstream-side pull-only listing with computed
    // resolution. See each command file's own module header.
    issue: () => import("./commands/issue.js").then(wrapDefault("issue")),
    issues: () => import("./commands/issues.js").then(wrapDefault("issues")),
    // archive (spec-lifecycle-archival-plan-close-cascade-deterministic D3) —
    // deterministic sweep/apply verb; see commands/archive.ts's module header.
    archive: () => import("./commands/archive.js").then(wrapDefault("archive")),
    // trace (SPEC-102) — `lore trace stats`, read/deny observability
    // aggregation surface; see commands/trace.ts's module header.
    trace: () => import("./commands/trace.js").then(wrapDefault("trace")),
  },
});

export default main;
