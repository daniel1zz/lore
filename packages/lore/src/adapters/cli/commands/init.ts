/**
 * lore init — create .lore/ directory, config.yaml, and SQLite DB.
 *
 * SPEC-058 §Design Decisions D6 note: the recommended verification-profile
 * config-template block is DELIBERATELY NOT seeded here. `lore init`'s
 * `config.yaml` is a load-bearing "project: only, nothing else" contract for
 * a wide swath of existing test fixtures (`check-tree.test.ts`,
 * `migrate-spec-kind.test.ts`, `task-workflow.test.ts`, `verify.test.ts`,
 * `get-mdx-render.test.ts`, `sync-docs-cli.bun.test.ts`,
 * `tree-consistency.bun.test.ts`, `cli-drift.bun.test.ts`,
 * `e2e/cli.bun.test.ts`) that `appendFileSync` a SECOND top-level `workflow:`
 * block onto the freshly-`lore init`'d config.yaml (e.g. to disable gates for
 * their own fixture corpus) rather than parsing+merging it — a raw append
 * assumes `workflow:` is not already present; seeding one here was verified
 * (empirically, via this task's own dogfood run) to silently break EVERY one
 * of those fixtures' `workflow.gates.*` overrides (the earlier of the two
 * duplicate `workflow:` YAML mapping keys wins, discarding the appended
 * `gates` block). Seeding is scoped to `lore setup --project`
 * (`commands/setup.ts::runProjectScaffold`) instead — a newer surface with no
 * such append-based fixture depending on an empty `workflow:` key. See
 * `flows/init-corpus.ts`'s own module doc for the shared merge machinery this
 * command deliberately does NOT invoke.
 */

import { defineLoreCommand } from "../cli-exit.js";
import { exitCli } from "../cli-exit.js";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { ambientOfInvocation, createApp } from "../../../app.js";
// reason: saveConfig writes .lore/config.yaml via Node fs — only reachable via
// the @lore/core/node subpath (browser-safety split, packages/core/src/CLAUDE.md).
import { saveConfig } from "@lore/core/node";
import { formatErrorFor, resolveActor } from "../utils.js";
import { isInsideGitRepository } from "../../../service/git-state-stamp.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
  meta: {
    name: "init",
    description: "Initialise a new Lore project in the current directory",
  },
  args: {
    name: {
      type: "string",
      description: "Project name (default: directory name)",
    },
    author: {
      type: "string",
      description: "Default author identity",
      default: "owner",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const cwd = inv.cwd;
    const loreDir = join(cwd, ".lore");

    if (existsSync(loreDir)) {
      const msg = "Lore project already initialised in this directory.";
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    mkdirSync(loreDir, { recursive: true });

    // Write .gitignore
    writeFileSync(
      join(loreDir, ".gitignore"),
      "lore.db\nlore.db-wal\nlore.db-shm\n",
    );

    // Determine project name
    const projectName = args.name ?? cwd.split("/").filter(Boolean).pop() ?? "lore";

    // Write config.yaml via SSOT saveConfig (no hand-assembled yaml)
    const saveResult = saveConfig(cwd, { project: { name: projectName, author: args.author } });
    if (!saveResult.ok) {
      const msg = `Failed to write config: ${formatErrorFor(inv, saveResult.error)}`;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    // Initialise the SQLite DB (SQLiteStore constructor runs migrations)
    const dbPath = join(loreDir, "lore.db");
    const app = createApp(dbPath, undefined, ambientOfInvocation(inv), { identity: inv.identity });
    // reason: SPEC-143 AC-CT-3 — a fresh corpus is armed at init: nothing predates the cutoff, so
    // the R13 impact report is zero rows by construction, and both write paths (`lore verify`,
    // `lore evidence --capture`) now stamp state. Existing corpora keep the explicit
    // `lore audit arm --confirm` step. A failed arm is fatal: an unarmed "fresh" corpus would
    // silently accept unbound rows.
    //
    // reason: user decision 2026-10-17 — outside a git repository there is no state to stamp
    // against, so init does NOT arm, and says so (stdout line, `--json` field, `lore status`) rather
    // than downgrading silently. `lore audit arm --confirm` arms it once the corpus is in git.
    const stateBinding = app.stateBindingService;
    const insideGit = isInsideGitRepository(cwd);
    const armed = !insideGit
      ? "not_a_git_repo"
      : stateBinding === undefined
        ? undefined
        : await stateBinding.arm({ actor: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user), nowIso: new Date().toISOString() });
    app.close();
    if (armed === "not_a_git_repo") {
      const line = `state binding not armed: ${cwd} is not inside a git repository; run \`lore audit arm --confirm\` after placing the corpus in git`;
      if (args.json) {
        printLine(inv.io.stdout, 
          JSON.stringify({
            ok: true,
            data: {
              path: loreDir,
              project: projectName,
              author: args.author,
              state_binding: { armed: false, reason: "not_a_git_repo" },
            },
          }),
        );
      } else {
        printLine(inv.io.stdout, line);
        printLine(inv.io.stdout, `Initialised Lore project "${projectName}"`);
        printLine(inv.io.stdout, `  Database: ${join(loreDir, "lore.db")}`);
        printLine(inv.io.stdout, `  Config:   ${join(loreDir, "config.yaml")}`);
        printLine(inv.io.stdout, "");
        printLine(inv.io.stdout, "Run `lore create prd --title \"My Project\"` to add your first document.");
      }
      return;
    }
    if (armed === undefined || !armed.ok) {
      const msg =
        armed === undefined
          ? "stateBindingService is not wired on this App (internal wiring error)"
          : `Failed to arm state binding: ${formatErrorFor(inv, armed.error)}`;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }
    const armedRows = armed.value.status === "armed" ? armed.value.report.would_become_unbound_rows : 0;

    if (args.json) {
      printLine(inv.io.stdout, 
        JSON.stringify({
          ok: true,
          data: {
            path: loreDir,
            project: projectName,
            author: args.author,
            state_binding: { armed: true, status: armed.value.status, arming_rev: armed.value.arming_rev, would_become_unbound_rows: armedRows },
          },
        }),
      );
    } else {
      printLine(inv.io.stdout, `State binding armed (audit row id ${armed.value.arming_rev}); ${armedRows} existing rows affected.`);
      printLine(inv.io.stdout, `Initialised Lore project "${projectName}"`);
      printLine(inv.io.stdout, `  Database: ${join(loreDir, "lore.db")}`);
      printLine(inv.io.stdout, `  Config:   ${join(loreDir, "config.yaml")}`);
      printLine(inv.io.stdout, "");
      printLine(inv.io.stdout, "Run `lore create prd --title \"My Project\"` to add your first document.");
    }
  },
});
