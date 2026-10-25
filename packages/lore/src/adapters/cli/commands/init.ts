/**
 * lore init — create the `.lore/` corpus as ONE atomic scaffold.
 *
 * BR-807 / BR-810 (spec-defect-clusters-round-2-part-a-sessions-seats-setup-init D5): the corpus
 * (ignore list, `config.yaml` seeded from the shipped template, migrated SQLite DB, the invoking run's
 * registration and the state-binding arm) is built in a sibling temp directory by
 * `flows/init-corpus.ts::initCorpusAt` and renamed into place only when complete. Any failing step
 * exits 1 and leaves no `.lore`, so a retry runs as on a fresh directory.
 *
 * Reverses the SPEC-058 D6 note that kept the verification-profile template out of `lore init`: that
 * note protected fixtures which `appendFileSync` a second top-level `workflow:` block onto a freshly
 * initialised `config.yaml`. The user's decision (BR-807 as modified) is that a fresh corpus carries
 * the template; such fixtures must merge their overrides instead of appending.
 *
 * It writes no corpus document, version or audit entry for a document (BR-807): the write-spec rule the spec-create
 * gate feeds ships with the binary (`assets/governance/write-spec-rule.md`, read by `lore gate`, BR-1359), so a fresh
 * corpus adds no orphan to the tree check.
 *
 * Side-effect class: IO (fs writes, SQLite, one rename).
 */

import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { join } from "path";
import { ambientOfInvocation, type App } from "../../../app.js";
import { err, ok, type Invocation, type LoreError, type Result } from "@lore/core";
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

/** How the arm step ended: not attempted (and why), or armed with the numbers the report prints. */
type ArmOutcome =
  | { readonly kind: "not_armed"; readonly reason: "not_a_git_repo" | "no_known_party" }
  | { readonly kind: "armed"; readonly arming_rev: number; readonly status: string; readonly would_become_unbound_rows: number };

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
    //
    // reason: spec-every-write-is-made-by-a-known-party-an-attested-agent-run — arming writes an audit row, and a
    // write needs a known party. A person has no human session yet at `init` (`lore session start` needs the corpus
    // this command creates), so init does NOT arm for an invocation with no known party and says so, exactly as it
    // does outside git; `lore audit arm --confirm` arms it once a session is open.
    // The integration that vouched for the run named on the command line (`--harness-run cc:<session>`) can only
    // register it in a corpus that exists, and this command is what creates it: registering that MAIN run here keeps
    // every later write of the same session from being refused as unknown. A subagent run is left to the hook /
    // `lore run register`.
    const insideGit = isInsideGitRepository(cwd);
    const armedBox: { outcome?: ArmOutcome } = {};

    const scaffold = await initCorpusAt(cwd, ambientOfInvocation(inv), {
      name: projectName,
      author: args.author,
      configTemplateYaml: template.value,
      writeContext: { identity: inv.identity },
      onDatabaseReady: async (app) => {
        await registerInvokingMainRun(app, inv);
        if (!insideGit) {
          armedBox.outcome = { kind: "not_armed", reason: "not_a_git_repo" };
          return ok(undefined);
        }
        const verifiedParty = inv.identity.claimed === null ? undefined : await app.verifiedInvocationIdentity?.();
        const knownParty = inv.identity.claimed !== null && (verifiedParty === undefined || verifiedParty.ok);
        if (!knownParty) {
          armedBox.outcome = { kind: "not_armed", reason: "no_known_party" };
          return ok(undefined);
        }
        const stateBinding = app.stateBindingService;
        if (stateBinding === undefined) {
          return err({
            code: "STORE_ERROR",
            message: "stateBindingService is not wired on this App (internal wiring error)",
          });
        }
        const armed = await stateBinding.arm({ actor: resolveActor(inv), nowIso: new Date().toISOString() });
        if (!armed.ok) return armed;
        armedBox.outcome = {
          kind: "armed",
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

    const outcome = armedBox.outcome;
    if (outcome === undefined) return fail("internal wiring error: the arm step did not report an outcome");
    if (outcome.kind === "not_armed") {
      if (args.json) {
        printLine(
          inv.io.stdout,
          JSON.stringify({
            ok: true,
            data: {
              path: loreDir,
              project: projectName,
              author: args.author,
              state_binding: { armed: false, reason: outcome.reason },
            },
          }),
        );
      } else {
        printLine(
          inv.io.stdout,
          outcome.reason === "not_a_git_repo"
            ? `state binding not armed: ${cwd} is not inside a git repository; run \`lore audit arm --confirm\` after placing the corpus in git`
            : "state binding not armed: no known party yet (a write needs an attested agent run registered in this corpus, or a human session); " +
                "run `lore session start --human <name>` (or `lore run register`), then `lore audit arm --confirm`",
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
              status: outcome.status,
              arming_rev: outcome.arming_rev,
              would_become_unbound_rows: outcome.would_become_unbound_rows,
            },
          },
        }),
      );
    } else {
      printLine(
        inv.io.stdout,
        `State binding armed (audit row id ${outcome.arming_rev}); ${outcome.would_become_unbound_rows} existing rows affected.`,
      );
      footer();
    }
    return 0;
  },
});
