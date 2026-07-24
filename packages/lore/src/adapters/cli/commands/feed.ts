/**
 * lore feed <checkpoint> [<target>] [--parent <id-or-slug>] [--plan <id-or-slug>]
 *   [--handoff <id-or-slug>] [--by <name>] [--json] — the deterministic
 * feed-before-produce PULL surface (IoC vertical-slice tech-spec §4.1/§11, P4 slice)
 * PLUS the SPEC-041 S2 session-resume dispatch (D5) PLUS the SPEC-056 phase-start
 * dispatch PLUS the SPEC-070 task-start dispatch (D1).
 *
 * Where `lore gate <checkpoint>` PUSHES a feeding pack back to the caller only AFTER a
 * violation, `lore feed <checkpoint>` lets a caller PULL the same governing rule ahead
 * of time — before writing anything — so an AI agent (or a human) can read the rule
 * first instead of discovering it via a rejected write. Both surfaces assemble their
 * pack through the exact same shared composition (`../../../flows/feed-flow.js::buildFeed`,
 * which itself reuses `renderDocMarkdown` + `buildFeedingPack`/`renderFeedingPack`) so
 * the two can never drift on how a rule doc's (or a `--parent` doc's) markdown gets
 * rendered into a feeding-pack slice.
 *
 * DISPATCH (SPEC-070 D1 — refactored from an if/else chain to a checkpoint→handler
 * table): `SPECIAL_CHECKPOINT_HANDLERS` maps the three checkpoints with a dedicated
 * assembly (`session-resume`, `phase-start`, `task-start`) to their own handler
 * function; any OTHER checkpoint (including the pre-existing `spec-create`) falls
 * through to the generic `buildFeed` composition below, driven by `feed-flow.ts`'s
 * `CHECKPOINT_PRODUCED_TYPE` map. `spec-create`/`session-resume`/`phase-start`'s
 * rendered output is BYTE-IDENTICAL to before this refactor (AC-070-7 regression pin
 * — see `tests/integration/cli-feed-task-start.bun.test.ts`) — this file's dispatch
 * SHAPE changed, no checkpoint's OWN logic did.
 *
 * DISPATCH TABLE MEMBERSHIP (SPEC-070 review Fix F7 — dispatch-triplication fix):
 * `SPECIAL_CHECKPOINT_HANDLERS`'s key set is asserted (at MODULE INIT, fail loud,
 * `assertHandlersCoverDescriptor`) to cover every checkpoint named by
 * `../../../flows/feed-flow.js::SPECIAL_FEED_CHECKPOINTS` — the SAME descriptor
 * `adapters/mcp/tools.ts`'s `lore_feed` handler consumes for its own branch
 * membership + required-field validation + contradictory-combo rejection (Fix F8).
 * Before this fix, "which checkpoints are special" was maintained independently in
 * three places with no test catching drift between them; a checkpoint added to the
 * descriptor without a matching entry here now throws at CLI startup instead of
 * silently falling through to the generic `buildFeed` advisory-note path.
 *
 * `<checkpoint>` derives a produced-type via `CHECKPOINT_PRODUCED_TYPE`
 * (`flows/feed-flow.ts`) for the generic path — this slice only wires `spec-create` →
 * `"spec"`. When an approved `knowledge/skill` doc scoped `extra.skill.applies_to` to
 * that type exists (`corpusService.findFeedingSkill`, the SAME discovery `lore gate
 * spec-create` uses), its rule slice (plus the `--parent` doc's MDX-resolved summary,
 * when supplied) is printed. No approved skill → a clear one-line note, NOT an error.
 *
 * `--checkpoint session-resume` (SPEC-041 §3 D5) — `flows/feed-flow.ts::buildResumeFeed`
 * (`SessionService.resume`). `--plan`/`--handoff`/`--by` are only meaningful for this
 * checkpoint. Unlike the generic path, this dispatch CAN fail (an unresolvable
 * `--plan`/`--handoff` target) — see the exit-code note below.
 *
 * `lore feed phase-start <target>` (SPEC-056 §Design Decisions D5) — `<target>` names
 * the phase document id/slug. `buildPhaseStartPack` (`../../../flows/phase-feed-flow.js`)
 * does the actual assembly over a REAL `PhaseFeedFlowDeps` binding
 * (`../phase-wiring.js::buildPhaseFeedFlowDeps`).
 *
 * `lore feed task-start <target>` (SPEC-070 §Design Decisions D1, D7) — `<target>`
 * names the TASK document id/slug. `buildTaskStartPack`
 * (`../../../flows/task-feed-flow.js`) assembles the eight-section deterministic
 * dispatch pack over a REAL `TaskFeedFlowDeps` binding
 * (`../task-feed-wiring.js::buildTaskFeedFlowDeps`), with `workflow.task_feed.*`
 * config budgets resolved via `../task-feed-wiring.js::resolveTaskStartBudgets` —
 * the SAME construction a future MCP `lore_feed` task-start branch calls, so CLI/MCP
 * payloads stay deep-equal by construction (mirrors `phase-start`'s rationale).
 * Rendering (non-`--json`) goes through the exported `../task-feed-render.js::
 * renderTaskStartPack` (D7 — vitest-testable, reusable by a future claim-time print
 * or dashboard surface without touching this file).
 *
 * Exit code: for the generic `CHECKPOINT_PRODUCED_TYPE`-driven path, ALWAYS 0 — feed
 * is advisory context, never a gate (module header, task objective). For
 * `session-resume`, `phase-start`, AND `task-start`, 0 on success — a resolution
 * failure maps through the normal `exitCode()`/`formatError()` pipeline instead, since
 * an unresolvable target is a caller input error, not an advisory-degrade case.
 *
 * Source: IoC vertical-slice tech-spec §4.1/§11, P4 slice; SPEC-041 §3 D5;
 *   SPEC-056 §Design Decisions D5; SPEC-070 §Design Decisions D1, D7
 */

import { defineCommand } from "citty";
import type { LoreConfig } from "@lore/core";
import type { App } from "../../../app.js";
import { loadLoreApp } from "../loader.js";
import {
  buildFeed,
  buildResumeFeed,
  SESSION_RESUME_CHECKPOINT,
  SPECIAL_FEED_CHECKPOINTS,
  assertHandlersCoverDescriptor,
} from "../../../flows/feed-flow.js";
import { buildPhaseStartPack, PHASE_START_CHECKPOINT } from "../../../flows/phase-feed-flow.js";
import type { PhaseStartPack } from "../../../flows/phase-feed-flow.js";
import { buildTaskStartPack, TASK_START_CHECKPOINT } from "../../../flows/task-feed-flow.js";
import { buildPhaseFeedFlowDeps } from "../phase-wiring.js";
import { buildTaskFeedFlowDeps, resolveTaskStartBudgets } from "../task-feed-wiring.js";
import { renderTaskStartPack } from "../task-feed-render.js";
import { exitCode, formatError } from "../utils.js";

/** Loosely-typed view of the args this command's dispatch table needs — mirrors citty's parsed-args shape. */
interface FeedArgs {
  checkpoint?: unknown;
  target?: unknown;
  parent?: unknown;
  plan?: unknown;
  handoff?: unknown;
  by?: unknown;
  json?: unknown;
}

/**
 * One checkpoint's dedicated handler — sets `process.exitCode`/prints output itself,
 * mirroring the pre-refactor inline branches. Every handler takes the SAME
 * `(app, args, config)` shape (SPEC-070 Fix F7) — `config` is unused by
 * `handleSessionResume`/`handlePhaseStart` (only `handleTaskStart` reads it, for
 * `resolveTaskStartBudgets`) but a uniform signature lets `SPECIAL_CHECKPOINT_HANDLERS`
 * be a single module-scope table instead of a per-invocation closure-building step.
 */
type CheckpointHandler = (app: App, args: FeedArgs, config: LoreConfig | undefined) => Promise<void>;

async function handleSessionResume(app: App, args: FeedArgs, _config: LoreConfig | undefined): Promise<void> {
  const result = await buildResumeFeed(app, {
    ...(typeof args.plan === "string" ? { plan: args.plan } : {}),
    ...(typeof args.handoff === "string" ? { handoff: args.handoff } : {}),
    ...(typeof args.by === "string" ? { by: args.by } : {}),
  });

  if (!result.ok) {
    process.stderr.write(formatError(result.error) + "\n");
    process.exitCode = exitCode(result.error);
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.log(result.value.feed);
  }
  process.exitCode = 0;
}

async function handlePhaseStart(app: App, args: FeedArgs, _config: LoreConfig | undefined): Promise<void> {
  if (typeof args.target !== "string" || args.target.length === 0) {
    process.stderr.write(
      "Error: `lore feed phase-start <phase>` requires a phase document ID or slug.\n",
    );
    process.exitCode = 2;
    return;
  }

  const deps = buildPhaseFeedFlowDeps(app);
  const result = await buildPhaseStartPack(deps, args.target);

  if (!result.ok) {
    process.stderr.write(formatError(result.error) + "\n");
    process.exitCode = exitCode(result.error);
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    renderPhaseStartPackText(result.value);
  }
  process.exitCode = 0;
}

async function handleTaskStart(app: App, args: FeedArgs, config: LoreConfig | undefined): Promise<void> {
  if (typeof args.target !== "string" || args.target.length === 0) {
    process.stderr.write(
      "Error: `lore feed task-start <task>` requires a task document ID or slug.\n",
    );
    process.exitCode = 2;
    return;
  }

  const deps = buildTaskFeedFlowDeps(app);
  const budgets = resolveTaskStartBudgets(config);
  const result = await buildTaskStartPack(deps, args.target, budgets);

  if (!result.ok) {
    process.stderr.write(formatError(result.error) + "\n");
    process.exitCode = exitCode(result.error);
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.log(renderTaskStartPack(result.value));
  }
  process.exitCode = 0;
}

/**
 * The checkpoint→handler table (SPEC-070 Fix F7) — module-scope (not rebuilt per
 * `run()` invocation, unlike the pre-fix closure-over-`config` shape) now that every
 * handler shares the uniform `(app, args, config)` signature.
 */
const SPECIAL_CHECKPOINT_HANDLERS: Readonly<Record<string, CheckpointHandler>> = {
  [SESSION_RESUME_CHECKPOINT]: handleSessionResume,
  [PHASE_START_CHECKPOINT]: handlePhaseStart,
  [TASK_START_CHECKPOINT]: handleTaskStart,
};

// SPEC-070 Fix F7: fail loud, at module init, if the shared SPECIAL_FEED_CHECKPOINTS
// descriptor (flows/feed-flow.ts, the SSOT the MCP `lore_feed` handler ALSO consumes)
// names a checkpoint this file has no handler for — the CLI dispatch table's own
// deterministic self-check that it hasn't silently drifted behind the SSOT. A checkpoint
// present in the descriptor but absent here would otherwise silently fall through to the
// generic `buildFeed` advisory-note path below and exit 0, masking the gap.
assertHandlersCoverDescriptor(SPECIAL_FEED_CHECKPOINTS, SPECIAL_CHECKPOINT_HANDLERS);

export default defineCommand({
  meta: {
    name: "feed",
    description:
      'Feed-before-produce PULL: print the governing skill\'s rule slice for a checkpoint ahead of writing (advisory only, never a gate); "session-resume"/"phase-start"/"task-start" dispatch to their own dedicated packs instead',
  },
  args: {
    checkpoint: {
      type: "positional",
      description: 'Checkpoint to feed, e.g. "spec-create", "session-resume" (SPEC-041 S2), "phase-start" (SPEC-056), or "task-start" (SPEC-070)',
      required: true,
    },
    target: {
      type: "positional",
      description: "[phase-start/task-start only] Phase or task document ID or slug to build the feed pack for",
      required: false,
    },
    parent: {
      type: "string",
      description: "Intended parent doc id/slug — its MDX-resolved summary is included when supplied",
    },
    plan: {
      type: "string",
      description: "[session-resume only] Plan doc id/slug to scope resume to (newest-wins)",
    },
    handoff: {
      type: "string",
      description: "[session-resume only] Direct handoff doc id/slug — skips derivation entirely",
    },
    by: {
      type: "string",
      description: "[session-resume only] Actor identity filter",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const { app, config } = loadLoreApp();
    try {
      const handler = SPECIAL_CHECKPOINT_HANDLERS[args.checkpoint as string];
      if (handler !== undefined) {
        await handler(app, args, config);
        return;
      }

      const outcome = await buildFeed(
        app,
        args.checkpoint as string,
        args.parent !== undefined ? (args.parent as string) : undefined,
      );

      if (args.json) {
        console.log(JSON.stringify(outcome, null, 2));
      } else {
        console.log(outcome.feed);
      }

      // reason: feed is advisory context, never a gate — exit 0 always, regardless of
      // whether a governing skill was found (module header).
      process.exitCode = 0;
    } finally {
      app.close();
    }
  },
});

/** Renders a phase-start pack's four sections to stdout, plus a truncation notice when any section was clipped. */
function renderPhaseStartPackText(pack: PhaseStartPack): void {
  console.log(`# Phase start — ${pack.phase_id}\n`);
  console.log("## Scope");
  console.log(pack.sections.scope);
  console.log("\n## Sibling phases");
  console.log(pack.sections.siblings);
  console.log("\n## Linked knowledge");
  console.log(pack.sections.knowledge_pointers);
  console.log("\n## Latest handoff");
  console.log(pack.sections.handoff);
  if (pack.truncated.length > 0) {
    console.log(`\n(truncated sections: ${pack.truncated.join(", ")})`);
  }
}
