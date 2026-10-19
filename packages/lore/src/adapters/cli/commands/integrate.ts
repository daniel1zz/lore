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
 * corpus directory (`integrate-losses/`) and listed by `lore status` until the branch lands. Every attempt (lost or not) also records its
 * phase durations (merge, corpus snapshot, each floor step, CAS) and outcome in `integrate-attempts/<branch>.json` (last 20
 * per branch, kept after landing) and prints one `integrate: attempt N/3 phases: ...` line; `lore status` shows each
 * starving branch's loss count and median attempt duration. The floor's per-step timings come from the machine-readable
 * file named by `LORE_FLOOR_TIMINGS_FILE` that scripts/run-chain.ts writes; a floor command that writes none is recorded
 * as one step named `floor (no per-step timings emitted)`.
 *
 * After main moved, the landing ({branch, branch_head, main_before, main_after, landing_commit}) is written to
 * `extra.landing` of every task whose claim (current or historical) recorded the branch, so a later re-claim cannot
 * replace the task's commit range; a failed write is logged as a WARNING and never un-lands main.
 *
 * The caller's session: `--session <id>` else `CLAUDE_CODE_SESSION_ID` / `CLAUDE_SESSION_ID`; none is a refusal.
 *
 * Exit codes: 0 = landed, or already integrated (a re-run after a crash past the CAS); 1 = the floor failed (main
 * unchanged) or a git/filesystem failure; 4 = a merge conflict (paths named, nothing changed) or a refused request
 * (unknown branch, missing floor key, missing session); 75 = three lost races (EX_TEMPFAIL, safe to re-run; the
 * integrations that moved main are named), or another integrate of the SAME session is still running in the session's
 * integration worktree (refused at once, before any merge or snapshot, naming its pid, branch and start time; the run
 * holds an OS lock on the worktree for its whole duration, so a killed run frees it with nothing to clean up).
 *
 * The floor runs against a snapshot of the shared corpus (INT-T12): a consistent `VACUUM INTO` copy written to
 * `<integration worktree>/.lore/lore.db` just before the floor and removed right after. The line `integrate: floor runs
 * against a corpus snapshot taken <iso ts>` is printed per attempt. Corpus upgrades are explicit (an older corpus is
 * refused), so with `workflow.integrate.migrate_command` set (the branch binary's `lore migrate schema`) the snapshot is
 * migrated before the floor (a failure = `snapshot_migrate_failed`, exit 1, main unchanged), and after landing, refresh and
 * rebuild the live corpus is migrated once; the outcome carries `schema` and a line `schema: <from> -> <to>` or
 * `schema: already current` (a failure there is exit 1 with the corpus and the exact command to rerun; main stays landed).
 * See `IntegrateService.landOn` and `IntegrateService.migrateLiveCorpus`.
 *
 * After landing (and on an already-integrated no-op) the shared checkout's detached view is moved to main with a plain
 * `git checkout --detach main`; the outcome carries `shared_view` = refreshed | kept_dirty <paths> | not_measured <reason>.
 * With `workflow.integrate.post_refresh_command` set, a `refreshed` view is then rebuilt (INT-T11); the outcome carries
 * `rebuild` = rebuilt | rebuild_failed <exit> | skipped <reason>, never silent (a failed rebuild never un-lands main).
 * Output: progress and the result on stdout/stderr as text; `--json` prints `{ ok: true, data: <outcome> }` on stdout.
 * Side-effect class: IO (git subprocesses, the floor command, the corpus directory's loss ledger).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { invocationOf } from "../command-invocation.js";
import { loadLoreApp } from "../loader.js";
import { resolveCallerSession } from "../caller-session.js";
import { exitCode, formatError } from "../utils.js";
import { removeCorpusSnapshot, takeCorpusSnapshot } from "../../../store/corpus-snapshot.js";
import { sqliteIntegrationLease } from "../../../store/integration-lease.js";
import { IntegrateLossLedger } from "../../../service/integrate-loss-ledger.js";
import { IntegrateAttemptLedger } from "../../../service/integrate-attempt-ledger.js";
import { OwnDiffJudgment } from "../../../service/own-diff-judgment.js";
import { loadCoChangeRules } from "../../../service/co-change-review.js";
import {
  IntegrateService,
  describeSchemaMigration,
  integrateExitCode,
  type FloorRunner,
  type IntegrateGit,
  type IntegrateOutcome,
  type SchemaMigration,
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

/** The env var naming the file a floor command (scripts/run-chain.ts) writes its machine-readable per-step timings to. */
const FLOOR_TIMINGS_ENV = "LORE_FLOOR_TIMINGS_FILE";

/** The shape scripts/run-chain.ts writes to `LORE_FLOOR_TIMINGS_FILE` (the one contract; prose is never parsed). */
const FloorTimingsFileSchema = z
  .object({ schema_version: z.literal(1), steps: z.array(z.object({ step: z.string().min(1), exit: z.number().int(), seconds: z.number().nonnegative() })) })
  .strict();

/**
 * Floor runner: `sh -c <command>` in the integration worktree; output is stdout+stderr as one string. The command gets
 * a private timings file path in `LORE_FLOOR_TIMINGS_FILE`; when it wrote one, its steps are returned. No file (a custom
 * floor_command) = `steps` absent, which the service records as one named step. A file that exists but is malformed is
 * a thrown failure of the floor's contract, not a silent "no timings".
 */
function floorRunnerFor(ambient: AmbientEnv): FloorRunner {
  return (command, cwd) => {
    const scratch = mkdtempSync(join(tmpdir(), "lore-floor-timings-"));
    const timingsFile = join(scratch, "timings.json");
    try {
      const result = spawnSync("sh", ["-c", command], { cwd, encoding: "utf8", env: { ...ambient, [FLOOR_TIMINGS_ENV]: timingsFile }, maxBuffer: 256 * 1024 * 1024 });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error !== undefined ? `\n${result.error.message}` : ""}`;
      let raw: string | undefined;
      try {
        raw = readFileSync(timingsFile, "utf8");
      } catch {
        raw = undefined; // reason: ENOENT is the normal "floor emitted no timings" case; the service names it as one step
      }
      if (raw === undefined) return { status: result.status ?? 1, output };
      const parsed = FloorTimingsFileSchema.parse(JSON.parse(raw));
      return { status: result.status ?? 1, output, steps: parsed.steps.map((s) => ({ step: s.step, exit: s.exit, ms: Math.round(s.seconds * 1000) })) };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
}

/** UTF-8 content of `path`, or null when it does not exist; any other fault throws (the co-change loader reports it). */
function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
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

/** The live-corpus migrate line; a failure goes to stderr (the landing stands) with the corpus and the exact command to rerun. */
function renderSchema(schema: SchemaMigration): { out?: string; err?: string } {
  if (schema.state !== "failed") return { out: `integrate: ${describeSchemaMigration(schema)}` };
  return {
    err:
      `integrate: ${describeSchemaMigration(schema)}; main stays landed, the live corpus was NOT upgraded\n${schema.output_tail.trimEnd()}\n` +
      `integrate: rerun in the shared checkout: ${schema.command}`,
  };
}

/** Joins the landed/already-integrated stdout lines with the schema line, and carries a schema failure to stderr. */
function withSchema(head: string, schema: SchemaMigration): { out?: string; err?: string } {
  const rendered = renderSchema(schema);
  return { out: rendered.out === undefined ? head : `${head}\n${rendered.out}`, ...(rendered.err !== undefined ? { err: rendered.err } : {}) };
}

function renderOutcome(outcome: IntegrateOutcome): { out?: string; err?: string } {
  switch (outcome.kind) {
    case "landed":
      return withSchema(`integrate: landed ${outcome.branch} on main as ${outcome.sha.slice(0, 12)} after ${outcome.attempts} attempt(s)\n${renderSharedView(outcome.shared_view)}\n${renderRebuild(outcome.rebuild)}`, outcome.schema);
    case "already_integrated":
      return withSchema(`integrate: ${outcome.branch} is already integrated into main (${outcome.main.slice(0, 12)}); nothing to do\n${renderSharedView(outcome.shared_view)}\n${renderRebuild(outcome.rebuild)}`, outcome.schema);
    case "snapshot_migrate_failed":
      return {
        err:
          `integrate: migrating the floor's corpus snapshot ${outcome.snapshot} failed (exit ${outcome.exit_status}, \`${outcome.command}\`); the floor did not run and main is unchanged\n` +
          `${outcome.output_tail.trimEnd()}\nintegrate: fix the migration in ${outcome.branch} and re-run`,
      };
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
    case "busy": {
      const who = outcome.holder === undefined ? "holder not yet recorded" : `pid ${outcome.holder.pid}, branch ${outcome.holder.branch}, started ${outcome.holder.started_at}`;
      return { err: `integrate: another integrate is running in ${outcome.worktree} (${who}); wait for it to finish, then re-run. Nothing was changed` };
    }
    case "lost_races":
      return {
        err:
          `integrate: lost ${outcome.attempts} races; main moved by ${outcome.moved_by.join(", ")}\n` +
          `integrate: ${outcome.branch} has ${outcome.consecutive_losses} consecutive lost race(s); main and ${outcome.branch} are unchanged; re-run to try again`,
      };
  }
}

export default defineLoreCommand({
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
      const ownership = app.branchOwnershipReader;
      if (ownership === undefined) {
        inv.io.stderr.write("Error: this composition has no branch ownership reader, so the branch's own change cannot be judged; nothing was landed\n");
        return 1;
      }
      const service = new IntegrateService({
        git: runGit,
        lease: sqliteIntegrationLease,
        runFloor: floorRunnerFor(inv.env),
        corpus: {
          take: (worktree) => takeCorpusSnapshot(corpusDir, worktree),
          remove: (worktree) => removeCorpusSnapshot(worktree),
        },
        ledger: new IntegrateLossLedger(corpusDir),
        attempts: new IntegrateAttemptLedger(corpusDir),
        // the landing is recorded through the corpus write route (TaskWorkflowService -> CorpusService.writeDoc)
        landings: { record: (landing) => app.taskWorkflowService.recordLanding(landing) },
        // the branch's own change is judged before the floor (BR-1346, BR-1347, BR-1348); it reads the repository and the claims only
        ownDiff: new OwnDiffJudgment({
          git: runGit,
          projectRoot,
          ownership,
          loadCoChangeRules: () => loadCoChangeRules(projectRoot, readFileOrNull),
          matchesGlob: (pattern, path) => new Bun.Glob(pattern).match(path),
        }),
        projectRoot,
        worktreesRoot: resolvePath(mainRoot, ".claude", "worktrees"),
        log: (line) => inv.io.stdout.write(`${line}\n`),
      });
      const result = await service.integrate({
        branch,
        sessionId: resolveCallerSession(typeof args.session === "string" ? args.session : undefined, inv.env) ?? "",
        floorCommand: config?.workflow?.integrate?.floor_command,
        postRefreshCommand: config?.workflow?.integrate?.post_refresh_command,
        migrateCommand: config?.workflow?.integrate?.migrate_command,
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
