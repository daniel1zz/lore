/**
 * `lore land <task | integration-branch> [--session <id>]` — the closing verb after `lore finish`
 * (spec-integrate-proves-and-lands-evidence-at-landing-the-merge AC-DCS2-7, AC-DCS2-8, AC-DCS2-9, AC-DCS2-19). Thin pipe over
 * `LandService`: what to land and in which order lives in `service/land-service.ts`, never here.
 *
 *   - a task of a plan without an integration branch: requires the contract met, then runs `lore integrate` for the task's branch
 *     (oracle union, evidence rows, archive, worktree cleanup);
 *   - a task of a plan with one: requires the contract met, folds the task tip into the integration branch in the merge queue
 *     (fast-forward, else a merge) and, once no open code task of the plan is unfolded, integrates the branch in the same turn;
 *   - an integration branch: integrates it.
 * The integrate it runs is `runIntegrate` of `commands/integrate.ts` (the one landing path), sharing this command's queue turn.
 *
 * Exit codes: 0 landed, folded, or nothing to do; 1 an integrate oracle failed (main unchanged); 4 a refusal or a later step
 * that failed (every earlier step stays recorded; the output names the command to run again); 75 busy, queue timeout or
 * `fold-raced` (the branch moved during the fold; nothing changed).
 * Side-effect class: IO (git, the corpus, the merge queue).
 */
import { dirname, resolve as resolvePath } from "node:path";
import { spawnSync } from "node:child_process";
import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { invocationOf } from "../command-invocation.js";
import { loadLoreApp } from "../loader.js";
import { resolveCallerSession } from "../caller-session.js";
import { exitCode, formatError, formatErrorFor, resolveActor } from "../utils.js";
import { createLandGit, LandIntegrateFailed } from "../../../service/land-service.js";
import { runIntegrate } from "./integrate.js";

export default defineLoreCommand({
  meta: {
    name: "land",
    description: "Land a finished task: fold it into the plan's integration branch, or integrate it into main, archive and clean up; resumable and idempotent",
  },
  args: {
    target: { type: "positional", required: false, description: "Task slug (or id), or the integration branch of a plan" },
    session: { type: "string", description: "Caller's session id (default: CLAUDE_CODE_SESSION_ID / CLAUDE_SESSION_ID)" },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const target = typeof args.target === "string" ? args.target : "";
    if (target === "") {
      inv.io.stderr.write("Error: lore land requires a <task> or an <integration-branch>\n");
      exitCli(2);
    }
    const session = resolveCallerSession(typeof args.session === "string" ? args.session : undefined, inv.env) ?? "";
    if (session === "") {
      inv.io.stderr.write("Error: lore land needs the caller's session id: pass --session <id> or set CLAUDE_CODE_SESSION_ID\n");
      return 4;
    }
    const { app, dbPath, config } = loadLoreApp({ inv });
    try {
      const verified = await app.verifiedInvocationIdentity?.();
      if (verified !== undefined && !verified.ok) {
        inv.io.stderr.write(`${formatError(verified.error)}\n`);
        return exitCode(verified.error);
      }
      const createLand = app.createLandService;
      const createQueue = app.createIntegrateQueue;
      if (createLand === undefined || createQueue === undefined) {
        inv.io.stderr.write("Error: this composition has no land service or merge queue, so a landing cannot be recorded or serialized; nothing was changed\n");
        return 1;
      }
      const projectRoot = dirname(dirname(resolvePath(dbPath)));
      const commonDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: projectRoot, encoding: "utf8", env: { ...inv.env } });
      if (commonDir.status !== 0 || commonDir.stdout.trim() === "") {
        inv.io.stderr.write(`Error: cannot locate the git common dir of ${projectRoot} for the merge queue: ${(commonDir.stderr ?? "").trim()}\n`);
        return 1;
      }
      // reason: ONE queue instance serves the fold and the integrate, so the integrate inside a held turn shares it (integrate-queue.ts).
      const queue = createQueue({ commonDir: commonDir.stdout.trim(), log: (line) => inv.io.stdout.write(`${line}\n`) });
      const service = createLand({
        git: createLandGit(projectRoot, inv.env),
        queue,
        integrate: {
          integrate: async (branch) => {
            const code = await runIntegrate({ inv, app, dbPath, config, branch, args: { session }, queue });
            if (code !== 0) throw new LandIntegrateFailed(code);
          },
        },
        done: async (slug) => {
          const doneOpts = {
            by: resolveActor(inv),
            harnessRun: verified?.value?.harnessRun ?? null,
            source: app.callerSurface,
            callerSession: session,
          };
          return app.taskWorkflowService.done(slug, doneOpts);
        },
        session,
        now: () => new Date().toISOString(),
      });
      const result = await service.land(target);
      if (!result.ok) {
        inv.io.stderr.write(`${formatErrorFor(inv, result.error)}\n`);
        return exitCode(result.error);
      }
      for (const line of result.value.lines) inv.io.stdout.write(`${line}\n`);
      for (const line of result.value.errors) inv.io.stderr.write(`${line}\n`);
      return result.value.exit;
    } finally {
      app.close();
    }
  },
});
