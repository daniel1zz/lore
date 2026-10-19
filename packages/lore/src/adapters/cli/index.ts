/**
 * Main CLI definition — the command registry plus `buildMain(inv)`, which delivers ONE resolved
 * `Invocation` to every command's `run` (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D4).
 *
 * Public surface: `COMMAND_LOADERS` (name -> lazy module import: the REAL registry), `buildMain(inv, options)`
 * (the command tree for one invocation), `default` (an introspection-only tree, see below).
 * Invariants:
 *   - Every subcommand import is piped through `wrapDefault` (SPEC-051 D1, strict unknown-flag rejection via
 *     `wrapCommandStrict`) and then `deliverInvocation`, so every command AND every nested leaf (`gate
 *     spec-create`, `phase add`, `anchor rm`) runs with the same `inv` object as `ctx.inv`.
 *   - A command added to `COMMAND_LOADERS` gets delivery for free; there is no per-command wiring to forget.
 *   - The `default` export is built with `inv = null`: it exists so tests can WALK the tree (flags, leaves);
 *     running one of its leaves throws `CommandTreeWithoutInvocationError` instead of running without `inv`.
 * Side-effect class: pure construction; lazy `import()` of command modules on dispatch.
 *
 * `wrapDefault` is the ONE composition-site seam that wires strict unknown-flag rejection onto every command
 * without editing any `commands/*.ts` file for that concern. See `strict-flags.ts`'s module header.
 */

import { defineCommand } from "citty";
import type { CommandContext, CommandDef } from "citty";
import type { Invocation } from "@lore/core";
import { wrapCommandStrict } from "./strict-flags.js";

/** A lazily imported command module, exactly what `import("./commands/x.js")` yields. */
export type CommandModule = { default: CommandDef<any> };

/** Test seam of {@link buildMain}: rewrite a freshly imported command tree before strict/delivery wrapping. */
export interface BuildMainOptions {
  readonly transformCommand?: (name: string, command: CommandDef<any>) => CommandDef<any> | Promise<CommandDef<any>>;
  /**
   * Receives the exit code a command RETURNED (a number; `undefined` is success and is not reported). citty drops the
   * result of a nested subcommand, so this explicit callback, owned by the one `runCli` call that built the tree, is
   * how a returned code leaves the tree (no scope, no process global).
   */
  readonly reportExit?: (code: number) => void;
}

/** Thrown when a leaf of the introspection-only tree (`default` export, built without an Invocation) is run. */
export class CommandTreeWithoutInvocationError extends Error {
  constructor(readonly commandPath: string) {
    super(`lore ${commandPath}: command tree was built without an Invocation; build it with buildMain(inv)`);
    this.name = "CommandTreeWithoutInvocationError";
  }
}

/** Resolve a citty `Resolvable` (value, promise or thunk). */
async function resolveMaybe<T>(value: T | Promise<T> | (() => T | Promise<T>)): Promise<T> {
  return typeof value === "function" ? (value as () => T | Promise<T>)() : value;
}

/**
 * Wrap every `run` in `cmd`'s tree (nested subCommands included) so it receives `inv` as `context.inv`;
 * a command body reads it with `invocationOf(context)` and passes it on explicitly (`loadLoreApp({ inv })`).
 *
 * @param inv - the invocation to deliver, or `null` for the introspection-only tree
 * @param commandPath - `lore <path>` words, for the error of the `null` tree
 */
async function deliverInvocation(
  cmd: CommandDef<any>,
  inv: Invocation | null,
  commandPath: string,
  reportExit: ((code: number) => void) | undefined,
): Promise<CommandDef> {
  const delivered: CommandDef = { ...cmd };
  const subCommandsDef = cmd.subCommands === undefined ? undefined : await resolveMaybe(cmd.subCommands);
  if (subCommandsDef !== undefined) {
    const nested: Record<string, CommandDef> = {};
    for (const [name, sub] of Object.entries(subCommandsDef)) {
      const resolved = await resolveMaybe(sub);
      nested[name] = await deliverInvocation(resolved, inv, `${commandPath} ${name}`, reportExit);
    }
    delivered.subCommands = nested;
  }
  if (typeof cmd.run === "function") {
    const originalRun = cmd.run;
    // reason: NOT `async`: the introspection-only tree must refuse a leaf with a synchronous throw, not a rejected promise.
    delivered.run = (context: CommandContext) => {
      if (inv === null) throw new CommandTreeWithoutInvocationError(commandPath);
      return Promise.resolve(originalRun({ ...context, inv } as CommandContext)).then((returned: number) => {
        reportExit?.(returned);
        return returned;
      });
    };
  }
  return delivered;
}

/**
 * Build the `.then()` callback for one lazily-imported command module: resolves its `default` export,
 * layers SPEC-051 D1 strict-flag enforcement on top, then delivers `inv`. `name` becomes the `--help`
 * pointer rendered in an "Unknown option" error (e.g. `"link"` -> `lore link --help`).
 */
function wrapDefault(name: string, inv: Invocation | null, options: BuildMainOptions): (m: CommandModule) => Promise<CommandDef> {
  return async (m) => {
    const command = options.transformCommand === undefined ? m.default : await options.transformCommand(name, m.default);
    const strict = await wrapCommandStrict(command, `lore ${name}`);
    return deliverInvocation(strict, inv, name, options.reportExit);
  };
}

/**
 * The command registry: the SSOT list of `lore <name>` verbs and how each is loaded.
 * reason: literal-specifier dynamic imports so `bun build --compile` bundles every command module.
 */
export const COMMAND_LOADERS: Readonly<Record<string, () => Promise<CommandModule>>> = {
    init: () => import("./commands/init.js"),
    create: () => import("./commands/create.js"),
    get: () => import("./commands/get.js"),
    set: () => import("./commands/set.js"),
    delete: () => import("./commands/delete.js"),
    list: () => import("./commands/list.js"),
    search: () => import("./commands/search.js"),
    tree: () => import("./commands/tree.js"),
    link: () => import("./commands/link.js"),
    unlink: () => import("./commands/unlink.js"),
    pending: () => import("./commands/pending.js"),
    decide: () => import("./commands/decide.js"),
    // autonomy — the governed threshold record (`show|set|regenerable|verify-pushed-heads`, spec-autonomy-phase-1 AC-AU-9);
    // see commands/autonomy.ts's header.
    autonomy: () => import("./commands/autonomy.js"),
    approve: () => import("./commands/approve.js"),
    reject: () => import("./commands/reject.js"),
    reopen: () => import("./commands/reopen.js"),
    log: () => import("./commands/log.js"),
    diff: () => import("./commands/diff.js"),
    restore: () => import("./commands/restore.js"),
    migrate: () => import("./commands/migrate.js"),
    status: () => import("./commands/status.js"),
    serve: () => import("./commands/serve.js"),
    agent: () => import("./commands/agent.js"),
    sync: () => import("./commands/sync.js"),
    eval: () => import("./commands/eval.js"),
    dashboard: () => import("./commands/dashboard.js"),
    "sync-docs": () => import("./commands/sync-docs.js"),
    "export-docs": () => import("./commands/export-docs.js"),
    phase: () => import("./commands/phase.js"),
    // plan (SPEC-069 §Design Decisions D1) — plan-level writers for the audited
    // plan-close exemptions (`exempt-attestation` / `exempt-assessment-freshness`).
    // Both were gate-read fields with NO authoring surface until this group
    // existed; see commands/plan.ts's module header.
    plan: () => import("./commands/plan.js"),
    claim: () => import("./commands/claim.js"),
    release: () => import("./commands/release.js"),
    evidence: () => import("./commands/evidence.js"),
    // done (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3) —
    // evidence-validated atomic lifecycle walk to archived; see commands/done.ts's
    // module header.
    done: () => import("./commands/done.js"),
    ready: () => import("./commands/ready.js"),
    assess: () => import("./commands/assess.js"),
    audit: () => import("./commands/audit.js"),
    calibration: () => import("./commands/calibration.js"),
    review: () => import("./commands/review.js"),
    ac: () => import("./commands/ac.js"),
    verify: () => import("./commands/verify.js"),
    gate: () => import("./commands/gate.js"),
    feed: () => import("./commands/feed.js"),
    bootstrap: () => import("./commands/bootstrap.js"),
    handoff: () => import("./commands/handoff.js"),
    uat: () => import("./commands/uat.js"),
    requirement: () => import("./commands/requirement.js"),
    anchor: () => import("./commands/anchor.js"),
    // rule / baseline (spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C3) —
    // dedicated writers of a baseline doc's verb-owned `extra` keys (rules, label, depends_on,
    // glossary) and of baseline node creation; `lore set` is refused on those keys. See each
    // command file's own module header.
    rule: () => import("./commands/rule.js"),
    baseline: () => import("./commands/baseline.js"),
    // scope (spec-declared-scope-attestation-contract-task-owned-ac-scope) —
    // dedicated writer for a task's/phase's `extra.ac_scope`, the anchor
    // command's sibling; see commands/scope.ts's module header.
    scope: () => import("./commands/scope.js"),
    // red-first (task-red-first-discipline-is-asked-for-in-prose-but-never) —
    // dedicated writer for a task's `extra.red_first`; see commands/red-first.ts's
    // module header.
    "red-first": () => import("./commands/red-first.js"),
    invalidate: () => import("./commands/invalidate.js"),
    setup: () => import("./commands/setup.js"),
    // governance (SPEC-083 D1) — bootstrap-stage, no corpus required; see
    // commands/governance.ts's module header.
    governance: () => import("./commands/governance.js"),
    // context (spec-context-verb-family-two-zone-claude-md-anatomy-lore) — init/refresh
    // the two-zone root CLAUDE.md; see commands/context.ts's module header.
    context: () => import("./commands/context.js"),
    // fragments (spec-context-fragments-config-driven-layered-rule-injection D13) — read-only,
    // hook-facing render/check/pointers; bootstrap-stage, see commands/fragments.ts's module header.
    fragments: () => import("./commands/fragments.js"),
    // run (spec-run-identity-slice-1 D2/D5/D10) — `run register|show|attest-input`; see
    // commands/run.ts's module header.
    run: () => import("./commands/run.js"),
    outline: () => import("./commands/outline.js"),
    seat: () => import("./commands/seat.js"),
    "report-issue": () => import("./commands/report-issue.js"),
    // issue / issues (spec-issue-closure-loop-computed-resolution-agent-reachable
    // §D3/D4) — `issue resolve` writes the explicit rejected/wontfix terminal
    // state; `issues` is the upstream-side pull-only listing with computed
    // resolution. See each command file's own module header.
    issue: () => import("./commands/issue.js"),
    issues: () => import("./commands/issues.js"),
    // archive (spec-lifecycle-archival-plan-close-cascade-deterministic D3) —
    // deterministic sweep/apply verb; see commands/archive.ts's module header.
    archive: () => import("./commands/archive.js"),
    // trace (SPEC-102) — `lore trace stats`, read/deny observability
    // aggregation surface; see commands/trace.ts's module header.
    trace: () => import("./commands/trace.js"),
    // territory / session (spec-multi-session-concurrency-queryable-
    // ownership-checkout §Scope L0, AC-OWN-1/AC-OWN-5) — the two read-only
    // ownership surfaces: `territory` partitions every worktree/branch
    // corpus-wide into mine/foreign/unowned/unmeasured; `session list|show`
    // joins corpus claims with probed process liveness. See each command
    // file's own module header.
    territory: () => import("./commands/territory.js"),
    session: () => import("./commands/session.js"),
    // worktree — `worktree check <path>` / `worktree sweep [--apply]`: lore's ONE "may this worktree be removed
    // now" test (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a); see commands/worktree.ts's header.
    worktree: () => import("./commands/worktree.js"),
    // stash — `stash prune [--apply]`: archive every stash under refs/lore/archive/stash, then lore drops it on an
    // auto decide(stash-drop) verdict (spec-autonomy-phase-1 AC-AU-4); see commands/stash.ts's header.
    stash: () => import("./commands/stash.js"),
    // integrate — `integrate <branch>`: the one path by which a branch lands on main (merge in the session's detached
    // integration worktree, post-merge floor, CAS update of main, max 3 attempts, exit 75 on three lost races;
    // spec-main-advances-only-through-lore-integrate-per-session AC-INT-1); see commands/integrate.ts's header.
    integrate: () => import("./commands/integrate.js"),
};

/**
 * Build the command tree of ONE invocation: every registry entry wrapped with strict-flag checking and
 * `inv` delivery.
 *
 * @param inv - the resolved invocation delivered to every `run`, or `null` for an introspection-only tree
 * @param options - test seam, see {@link BuildMainOptions}
 */
export function buildMain(inv: Invocation | null, options: BuildMainOptions = {}): CommandDef {
  const subCommands: Record<string, () => Promise<CommandDef>> = {};
  for (const [name, load] of Object.entries(COMMAND_LOADERS)) {
    subCommands[name] = () => load().then(wrapDefault(name, inv, options));
  }
  return defineCommand({
    meta: {
      name: "lore",
      version: "0.1.0",
      description: "AI-native shared knowledge/memory platform",
    },
    subCommands,
  });
}

/** Introspection-only tree (no Invocation): tests walk it; running a leaf throws. */
const main = buildMain(null);

export default main;
