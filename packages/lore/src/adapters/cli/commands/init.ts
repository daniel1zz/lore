/**
 * lore init — create the `.lore/` corpus as ONE atomic scaffold.
 *
 * BR-807 / BR-810 (spec-defect-clusters-round-2-part-a-sessions-seats-setup-init D5): the corpus
 * (ignore list, `config.yaml` seeded from the shipped template, migrated SQLite DB, and the
 * state-binding arm) is built in a sibling temp directory by
 * `flows/init-corpus.ts::initCorpusAt` and renamed into place only when complete. Any failing step
 * exits 1 and leaves no `.lore`, so a retry runs as on a fresh directory.
 *
 * Reverses the SPEC-058 D6 note that kept the verification-profile template out of `lore init`: that
 * note protected fixtures which `appendFileSync` a second top-level `workflow:` block onto a freshly
 * initialised `config.yaml`. The user's decision (BR-807 as modified) is that a fresh corpus carries
 * the template; such fixtures must merge their overrides instead of appending.
 *
 * It writes no corpus document, version or audit entry (BR-807): the write-spec rule the spec-create gate feeds
 * ships with the binary (`assets/governance/write-spec-rule.md`, read by `lore gate`, BR-1359), so a fresh corpus
 * passes `lore status --check-tree`.
 *
 * Side-effect class: IO (fs writes, SQLite, one rename).
 */

import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { join } from "path";
import { ambientOfInvocation } from "../../../app.js";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { formatErrorFor, resolveActor } from "../utils.js";
import { isInsideGitRepository } from "../../../service/git-state-stamp.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import { initCorpusAt } from "../../../flows/init-corpus.js";
import { resolveAssetsRoot } from "../setup-args.js";

// packages/lore/src/adapters/cli/commands/init.ts -> repo root is 6 levels up (same as setup.ts).
const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..", "..", "..", "..", "..");

/** Shipped asset `lore init` seeds the settings from (path relative to the resolved `assets/` root). */
const CONFIG_TEMPLATE_ASSET = join("project", "lore-config-template.yaml");

/** Reads one shipped asset; a missing or unreadable asset is a loud `STORE_ERROR` (never a silent skip). */
function readShippedAsset(assetsRoot: string, relativePath: string): Result<string, LoreError> {
  const path = join(assetsRoot, relativePath);
  try {
    return ok(readFileSync(path, "utf-8"));
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message: `lore init: cannot read the shipped asset ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }
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

    const fail = (msg: string): never => {
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      return exitCli(1);
    };

    if (existsSync(loreDir)) fail("Lore project already initialised in this directory.");

    const projectName = args.name ?? cwd.split("/").filter(Boolean).pop() ?? "lore";

    const assetsRoot = resolveAssetsRoot({ repoRoot: REPO_ROOT, isCompiled: inv.isCompiled, execPath: inv.execPath });
    const template = readShippedAsset(assetsRoot, CONFIG_TEMPLATE_ASSET);
    if (!template.ok) return fail(formatErrorFor(inv, template.error));

    // reason: SPEC-143 AC-CT-3 — a fresh corpus is armed at init: nothing predates the cutoff, so
    // the R13 impact report is zero rows by construction, and both write paths (`lore verify`,
    // `lore evidence --capture`) now stamp state. Existing corpora keep the explicit
    // `lore audit arm --confirm` step. A failed arm is fatal: an unarmed "fresh" corpus would
    // silently accept unbound rows. The arm runs INSIDE the atomic scaffold (`onDatabaseReady`), so a
    // failed arm leaves no corpus behind (BR-810).
    //
    // reason: user decision 2026-10-17 — outside a git repository there is no state to stamp
    // against, so init does NOT arm, and says so (stdout line, `--json` field, `lore status`) rather
    // than downgrading silently. `lore audit arm --confirm` arms it once the corpus is in git.
    const insideGit = isInsideGitRepository(cwd);
    const armedBox: { summary?: { arming_rev: number; status: string; would_become_unbound_rows: number } } = {};

    const actor = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
    const scaffold = await initCorpusAt(cwd, ambientOfInvocation(inv), {
      name: projectName,
      author: args.author,
      configTemplateYaml: template.value,
      onDatabaseReady: async (app) => {
        if (!insideGit) return ok(undefined);
        const stateBinding = app.stateBindingService;
        if (stateBinding === undefined) {
          return err({
            code: "STORE_ERROR",
            message: "stateBindingService is not wired on this App (internal wiring error)",
          });
        }
        const armed = await stateBinding.arm({ actor, nowIso: new Date().toISOString() });
        if (!armed.ok) return armed;
        armedBox.summary = {
          arming_rev: armed.value.arming_rev,
          status: armed.value.status,
          would_become_unbound_rows: armed.value.status === "armed" ? armed.value.report.would_become_unbound_rows : 0,
        };
        return ok(undefined);
      },
    });
    if (!scaffold.ok) return fail(`Failed to initialise the corpus: ${formatErrorFor(inv, scaffold.error)}`);

    const footer = (): void => {
      printLine(inv.io.stdout, `Initialised Lore project "${projectName}"`);
      printLine(inv.io.stdout, `  Database: ${join(loreDir, "lore.db")}`);
      printLine(inv.io.stdout, `  Config:   ${join(loreDir, "config.yaml")}`);
      printLine(inv.io.stdout, "");
      printLine(inv.io.stdout, "Run `lore create prd --title \"My Project\"` to add your first document.");
    };

    const armedSummary = armedBox.summary;
    if (armedSummary === undefined) {
      if (args.json) {
        printLine(
          inv.io.stdout,
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
        printLine(
          inv.io.stdout,
          `state binding not armed: ${cwd} is not inside a git repository; run \`lore audit arm --confirm\` after placing the corpus in git`,
        );
        footer();
      }
      return 0;
    }

    if (args.json) {
      printLine(
        inv.io.stdout,
        JSON.stringify({
          ok: true,
          data: {
            path: loreDir,
            project: projectName,
            author: args.author,
            state_binding: {
              armed: true,
              status: armedSummary.status,
              arming_rev: armedSummary.arming_rev,
              would_become_unbound_rows: armedSummary.would_become_unbound_rows,
            },
          },
        }),
      );
    } else {
      printLine(
        inv.io.stdout,
        `State binding armed (audit row id ${armedSummary.arming_rev}); ${armedSummary.would_become_unbound_rows} existing rows affected.`,
      );
      footer();
    }
    return 0;
  },
});
