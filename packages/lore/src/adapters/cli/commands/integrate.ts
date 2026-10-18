/**
 * `lore integrate <branch> [--session <id>] [--message <text>] [--json]` — the one path by which a branch lands on main
 * (spec-main-advances-only-through-lore-integrate-per-session, AC-INT-1; adr-main-advances-only-by-lore-integrate-
 * per-session). Thin pipe over `IntegrateService`: the merge, floor, compare-and-swap and retry bound live in
 * `service/integrate-service.ts`, never here.
 *
 * It merges `<branch>` onto the current main in this session's own detached integration worktree
 * (`<main checkout>/.claude/worktrees/integrate-<session>`, created on first use), runs the project's post-merge floor
 * (`workflow.integrate.floor_command` in `.lore/config.yaml`, no default: absent is a refusal) and advances main by
 * `git update-ref refs/heads/main <new> <base>`. At most 3 attempts per call; every lost race is recorded in the
 * corpus directory (`integrate-losses/`) and listed by `lore status` until the branch lands.
 *
 * The caller's session: `--session <id>` else `CLAUDE_CODE_SESSION_ID` / `CLAUDE_SESSION_ID`; none is a refusal.
 *
 * Exit codes: 0 = landed, or already integrated (a re-run after a crash past the CAS); 1 = the floor failed (main
 * unchanged) or a git/filesystem failure; 4 = a merge conflict (paths named, nothing changed) or a refused request
 * (unknown branch, missing floor key, missing session); 75 = three lost races (EX_TEMPFAIL, safe to re-run; the
 * integrations that moved main are named).
 *
 * After landing (and on an already-integrated no-op) the shared checkout's detached view is moved to main with a plain
 * `git checkout --detach main`; the outcome carries `shared_view` = refreshed | kept_dirty <paths> | not_measured <reason>.
 * With `workflow.integrate.post_refresh_command` set, a `refreshed` view is then rebuilt (INT-T11); the outcome carries
 * `rebuild` = rebuilt | rebuild_failed <exit> | skipped <reason>, never silent (a failed rebuild never un-lands main).
 * Output: progress and the result on stdout/stderr as text; `--json` prints `{ ok: true, data: <outcome> }` on stdout.
 * Side-effect class: IO (git subprocesses, the floor command, the corpus directory's loss ledger).
 */
import { spawnSync } from "node:child_process";
import { exitCli } from "../cli-exit.js";
import { dirname, resolve as resolvePath } from "node:path";
import { defineCommand } from "citty";
import { invocationOf } from "../command-invocation.js";
import { loadLoreApp } from "../loader.js";
import { resolveCallerSession } from "../caller-session.js";
import { exitCode, formatError } from "../utils.js";
import { IntegrateLossLedger } from "../../../service/integrate-loss-ledger.js";
import {
  IntegrateService,
  integrateExitCode,
  type FloorRunner,
  type IntegrateGit,
  type IntegrateOutcome,
  type SharedViewRebuild,
  type SharedViewRefresh,
} from "../../../service/integrate-service.js";

type AmbientEnv = Readonly<Record<string, string | undefined>>;

/** Runner over the invocation's environment: never throws; a spawn failure is status 1 with the message on stderr. */
function gitRunnerFor(ambient: AmbientEnv): IntegrateGit {
  return (cwd, args, env) => {
    const result = spawnSync("git", [...args], { cwd, encoding: "utf8", env: { ...ambient, ...env } });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
  };
}

/** Floor runner: `sh -c <command>` in the integration worktree; output is stdout+stderr as one string. */
function floorRunnerFor(ambient: AmbientEnv): FloorRunner {
  return (command, cwd) => {
    const result = spawnSync("sh", ["-c", command], { cwd, encoding: "utf8", env: { ...ambient }, maxBuffer: 256 * 1024 * 1024 });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error !== undefined ? `\n${result.error.message}` : ""}`;
    return { status: result.status ?? 1, output };
  };
}

/** The main checkout's root, from the git common dir of `cwd` (so a linked session worktree still names the one main checkout). */
function mainCheckoutRoot(runGit: IntegrateGit, cwd: string): string | undefined {
  const out = runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const commonDir = out.stdout.trim();
  if (out.status !== 0 || commonDir === "" || !commonDir.endsWith("/.git")) return undefined;
  return dirname(commonDir);
}

/** One line naming what happened to the shared checkout's view of main. */
function renderSharedView(view: SharedViewRefresh): string {
  switch (view.state) {
    case "refreshed":
      return "integrate: shared checkout refreshed to main";
    case "kept_dirty":
      return `integrate: shared checkout kept-dirty (not refreshed; an uncommitted edit would be overwritten): ${view.paths.join(" ")}`;
    case "not_measured":
      return `integrate: shared checkout not-measured: ${view.reason}`;
  }
}

/** One line (plus the failing output) naming what happened to the shared checkout's build artifacts. */
function renderRebuild(rebuild: SharedViewRebuild): string {
  switch (rebuild.state) {
    case "rebuilt":
      return `integrate: shared checkout rebuild: rebuilt${rebuild.tracked_changes === undefined ? "" : ` (WARNING: the build left tracked changes: ${rebuild.tracked_changes.join(" ")})`}`;
    case "rebuild_failed":
      return `integrate: shared checkout rebuild: rebuild-failed ${rebuild.exit_status} (main stays landed; rebuild by hand)\n${rebuild.output_tail.trimEnd()}`;
    case "skipped":
      return `integrate: shared checkout rebuild: skipped (${rebuild.reason})`;
  }
}

function renderOutcome(outcome: IntegrateOutcome): { out?: string; err?: string } {
  switch (outcome.kind) {
    case "landed":
      return { out: `integrate: landed ${outcome.branch} on main as ${outcome.sha.slice(0, 12)} after ${outcome.attempts} attempt(s)\n${renderSharedView(outcome.shared_view)}\n${renderRebuild(outcome.rebuild)}` };
    case "already_integrated":
      return { out: `integrate: ${outcome.branch} is already integrated into main (${outcome.main.slice(0, 12)}); nothing to do\n${renderSharedView(outcome.shared_view)}\n${renderRebuild(outcome.rebuild)}` };
    case "floor_failed":
      return {
        err:
          `integrate: the post-merge floor failed (exit ${outcome.exit_status}); main is unchanged\n${outcome.output_tail.trimEnd()}\n` +
          `integrate: fix ${outcome.branch} and re-run`,
      };
    case "conflict":
      return {
        err:
          `integrate: ${outcome.branch} conflicts with main in ${outcome.paths.length} path(s); main and the integration worktree are unchanged:\n` +
          outcome.paths.map((p) => `  ${p}`).join("\n") +
          `\nintegrate: merge main into ${outcome.branch} in your own worktree, resolve, commit, and re-run`,
      };
    case "lost_races":
      return {
        err:
          `integrate: lost ${outcome.attempts} races; main moved by ${outcome.moved_by.join(", ")}\n` +
          `integrate: ${outcome.branch} has ${outcome.consecutive_losses} consecutive lost race(s); main and ${outcome.branch} are unchanged; re-run to try again`,
      };
  }
}

export default defineCommand({
  meta: {
    name: "integrate",
    description: "Land a branch on main: merge in your integration worktree, run the post-merge floor, advance main by compare-and-swap (max 3 attempts; exit 75 = lost 3 races)",
  },
  args: {
    branch: { type: "positional", required: false, description: "Branch (or commit) to integrate onto main" },
    session: { type: "string", description: "Caller's session id (default: CLAUDE_CODE_SESSION_ID / CLAUDE_SESSION_ID); names the integration worktree" },
    message: { type: "string", alias: "m", description: "Merge commit message (default: merge(<branch>): <tip subject>)" },
    json: { type: "boolean", description: "Output { ok, data } as JSON" },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const runGit = gitRunnerFor(inv.env);
    const branch = typeof args.branch === "string" ? args.branch : "";
    if (branch === "") {
      inv.io.stderr.write("Error: lore integrate requires a <branch>\n");
      exitCli(2);
    }
    const { app, dbPath, config } = loadLoreApp({ inv });
    try {
      const corpusDir = dirname(resolvePath(dbPath));
      const projectRoot = dirname(corpusDir);
      const mainRoot = mainCheckoutRoot(runGit, projectRoot);
      if (mainRoot === undefined) {
        inv.io.stderr.write(`Error: ${projectRoot} is not inside a non-bare git repository whose common dir is <root>/.git\n`);
        return 1;
      }
      const service = new IntegrateService({
        git: runGit,
        runFloor: floorRunnerFor(inv.env),
        ledger: new IntegrateLossLedger(corpusDir),
        projectRoot,
        worktreesRoot: resolvePath(mainRoot, ".claude", "worktrees"),
        log: (line) => inv.io.stdout.write(`${line}\n`),
      });
      const result = await service.integrate({
        branch,
        sessionId: resolveCallerSession(typeof args.session === "string" ? args.session : undefined, inv.env) ?? "",
        floorCommand: config?.workflow?.integrate?.floor_command,
        postRefreshCommand: config?.workflow?.integrate?.post_refresh_command,
        ...(typeof args.message === "string" && args.message !== "" ? { message: args.message } : {}),
      });
      if (!result.ok) {
        inv.io.stderr.write(`${formatError(result.error)}\n`);
        return exitCode(result.error);
      }
      const rendered = renderOutcome(result.value);
      if (args.json === true) inv.io.stdout.write(`${JSON.stringify({ ok: true, data: result.value }, null, 2)}\n`);
      else if (rendered.out !== undefined) inv.io.stdout.write(`${rendered.out}\n`);
      if (rendered.err !== undefined) inv.io.stderr.write(`${rendered.err}\n`);
      return integrateExitCode(result.value);
    } finally {
      app.close();
    }
  },
});
