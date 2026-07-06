/**
 * Main CLI definition — aggregates all subcommands with lazy imports.
 * Entry point: src/index.ts calls runMain(main).
 */

import { defineCommand } from "citty";

const main = defineCommand({
  meta: {
    name: "lore",
    version: "0.1.0",
    description: "AI-native shared knowledge/memory platform",
  },
  subCommands: {
    init: () => import("./commands/init.js").then((m) => m.default),
    create: () => import("./commands/create.js").then((m) => m.default),
    get: () => import("./commands/get.js").then((m) => m.default),
    set: () => import("./commands/set.js").then((m) => m.default),
    delete: () => import("./commands/delete.js").then((m) => m.default),
    list: () => import("./commands/list.js").then((m) => m.default),
    search: () => import("./commands/search.js").then((m) => m.default),
    tree: () => import("./commands/tree.js").then((m) => m.default),
    link: () => import("./commands/link.js").then((m) => m.default),
    unlink: () => import("./commands/unlink.js").then((m) => m.default),
    pending: () => import("./commands/pending.js").then((m) => m.default),
    approve: () => import("./commands/approve.js").then((m) => m.default),
    reject: () => import("./commands/reject.js").then((m) => m.default),
    log: () => import("./commands/log.js").then((m) => m.default),
    diff: () => import("./commands/diff.js").then((m) => m.default),
    restore: () => import("./commands/restore.js").then((m) => m.default),
    migrate: () => import("./commands/migrate.js").then((m) => m.default),
    status: () => import("./commands/status.js").then((m) => m.default),
    serve: () => import("./commands/serve.js").then((m) => m.default),
    agent: () => import("./commands/agent.js").then((m) => m.default),
    sync: () => import("./commands/sync.js").then((m) => m.default),
    eval: () => import("./commands/eval.js").then((m) => m.default),
    dashboard: () => import("./commands/dashboard.js").then((m) => m.default),
    "sync-docs": () => import("./commands/sync-docs.js").then((m) => m.default),
    "export-docs": () => import("./commands/export-docs.js").then((m) => m.default),
    phase: () => import("./commands/phase.js").then((m) => m.default),
    claim: () => import("./commands/claim.js").then((m) => m.default),
    release: () => import("./commands/release.js").then((m) => m.default),
    evidence: () => import("./commands/evidence.js").then((m) => m.default),
    ready: () => import("./commands/ready.js").then((m) => m.default),
    assess: () => import("./commands/assess.js").then((m) => m.default),
    audit: () => import("./commands/audit.js").then((m) => m.default),
    calibration: () => import("./commands/calibration.js").then((m) => m.default),
    review: () => import("./commands/review.js").then((m) => m.default),
  },
});

export default main;
