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

import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { ambientOfInvocation, createApp, type App } from "../../../app.js";
import type { Invocation } from "@lore/core";
// reason: saveConfig writes .lore/config.yaml via Node fs — only reachable via
// the @lore/core/node subpath (browser-safety split, packages/core/src/CLAUDE.md).
import { saveConfig } from "@lore/core/node";
import { formatErrorFor, resolveActor } from "../utils.js";
import { isInsideGitRepository } from "../../../service/git-state-stamp.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/**
 * Register the MAIN agent run (`cc:<session>`) the invocation names in the corpus `init` has just created.
 *
 * Why: the integration's SessionStart hook cannot register a run in a repository that has no corpus yet, and every later
 * write of that session would be refused as an unknown run (BR-1351). A subagent run (`cc:<session>:<agent>`) needs an
 * agent type this command lacks, a non-agent party has its own registration, and an already-registered run is left alone.
 *
 * Side-effect class: IO (one `runs` row). A failure to register is not fatal: the invocation is then simply not a known
 * party in this corpus and `init` reports that it did not arm.
 */
async function registerInvokingMainRun(app: App, inv: Invocation): Promise<void> {
  const run = inv.identity.harnessRun;
  if (run === null || !run.startsWith("cc:") || run.split(":").length !== 2) return;
  const sessionId = run.slice("cc:".length);
  await app.runService?.register({ harness: "claude-code", sessionId, composition: { schemaVersion: 1, fragments: [] } });
}

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
  async run(context): Promise<number> {
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
    // reason: spec-every-write-is-made-by-a-known-party-an-attested-agent-run — arming writes an audit row, and a
    // write needs a known party. A person has no human session yet at `init` (`lore session start` needs the corpus
    // this command creates), so init does NOT arm for an invocation with no known party and says so, exactly as it
    // does outside git; `lore audit arm --confirm` arms it once a session is open.
    // A MAIN agent run named on the command line is registered below (this corpus's registry was just created empty);
    // a subagent run is checked against that registry and is no known party until `lore run register`.
    // reason: the integration that vouched for the run named on the command line (`--harness-run cc:<session>`) can only
    // register it in a corpus that exists, and this command is what creates it: registering that MAIN run here, with the
    // record `lore run register` would have written, keeps every later write of the same session from being refused as
    // unknown. A subagent run (it needs an agent type this command does not have) and a run that is already registered
    // are left to the hook / `lore run register`.
    await registerInvokingMainRun(app, inv);
    const stateBinding = app.stateBindingService;
    const insideGit = isInsideGitRepository(cwd);
    const verifiedParty = inv.identity.claimed === null ? undefined : await app.verifiedInvocationIdentity?.();
    const knownParty = inv.identity.claimed !== null && (verifiedParty === undefined || verifiedParty.ok);
    const armed = !insideGit
      ? "not_a_git_repo"
      : !knownParty
        ? "no_known_party"
        : stateBinding === undefined
          ? undefined
          : await stateBinding.arm({ actor: resolveActor(inv), nowIso: new Date().toISOString() });
    app.close();
    if (armed === "not_a_git_repo" || armed === "no_known_party") {
      const line =
        armed === "not_a_git_repo"
          ? `state binding not armed: ${cwd} is not inside a git repository; run \`lore audit arm --confirm\` after placing the corpus in git`
          : "state binding not armed: no known party yet (a write needs an attested agent run registered in this corpus, or a human session); " +
            "run `lore session start --human <name>` (or `lore run register`), then `lore audit arm --confirm`";
      if (args.json) {
        printLine(inv.io.stdout,
          JSON.stringify({
            ok: true,
            data: {
              path: loreDir,
              project: projectName,
              author: args.author,
              state_binding: { armed: false, reason: armed },
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
      return 0;
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
    return 0;
  },
});
