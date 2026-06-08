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
  },
});

export default main;
