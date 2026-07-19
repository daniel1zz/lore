/**
 * lore feed <checkpoint> [<phase>] [--parent <id-or-slug>] [--plan <id-or-slug>]
 *   [--handoff <id-or-slug>] [--by <name>] [--json] — the deterministic
 * feed-before-produce PULL surface (IoC vertical-slice tech-spec §4.1/§11, P4 slice)
 * PLUS the SPEC-041 S2 session-resume dispatch (D5) PLUS the SPEC-056 phase-start
 * dispatch (task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence).
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
 * `<checkpoint>` derives a produced-type via `CHECKPOINT_PRODUCED_TYPE`
 * (`flows/feed-flow.ts`) — this slice only wires `spec-create` → `"spec"`. When an
 * approved `knowledge/skill` doc scoped `extra.skill.applies_to` to that type exists
 * (`corpusService.findFeedingSkill`, the SAME discovery `lore gate spec-create` uses),
 * its rule slice (plus the `--parent` doc's MDX-resolved summary, when supplied) is
 * printed. No approved skill → a clear one-line note, NOT an error.
 *
 * `--checkpoint session-resume` is a SEPARATE dispatch (SPEC-041 §3 D5) —
 * `flows/feed-flow.ts::buildResumeFeed` (`SessionService.resume`), consulted BEFORE
 * the `CHECKPOINT_PRODUCED_TYPE` lookup above. `--plan`/`--handoff`/`--by` are only
 * meaningful for this checkpoint. Unlike the gate-checkpoint path, this dispatch CAN
 * fail (an unresolvable `--plan`/`--handoff` target) — see the exit-code note below.
 *
 * `lore feed phase-start <phase>` is a THIRD, SEPARATE dispatch (SPEC-056 §Design
 * Decisions D5), also consulted BEFORE the `CHECKPOINT_PRODUCED_TYPE` lookup — even
 * though `"phase-start"` IS registered in that map (unlike `session-resume`), a
 * generic `buildFeed` call has no notion of a phase-scoped bundle. `<phase>` is a
 * SECOND positional (consumed only when `checkpoint === "phase-start"`); it names
 * the phase document id/slug to build the pack for. `buildPhaseStartPack`
 * (`../../../flows/phase-feed-flow.js`) does the actual assembly over a REAL
 * `PhaseFeedFlowDeps` binding (`../phase-wiring.js::buildPhaseFeedFlowDeps`) — the
 * SAME binding a future MCP `lore_feed` phase-start branch would call, so CLI/MCP
 * payloads stay deep-equal by construction. UNLIKE the other two checkpoints, this
 * dispatch CAN fail (an unresolvable/non-phase `<phase>` target) — see the exit-code
 * note below.
 *
 * Exit code: for the generic `CHECKPOINT_PRODUCED_TYPE`-driven path, ALWAYS 0 — feed
 * is advisory context, never a gate (module header, task objective). For
 * `session-resume` AND `phase-start`, 0 on success — a resolution failure maps
 * through the normal `exitCode()`/`formatError()` pipeline instead, since an
 * unresolvable target is a caller input error, not an advisory-degrade case.
 *
 * Source: IoC vertical-slice tech-spec §4.1/§11, P4 slice; SPEC-041 §3 D5;
 *   SPEC-056 §Design Decisions D5
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { buildFeed, buildResumeFeed, SESSION_RESUME_CHECKPOINT } from "../../../flows/feed-flow.js";
import { buildPhaseStartPack, PHASE_START_CHECKPOINT } from "../../../flows/phase-feed-flow.js";
import type { PhaseStartPack } from "../../../flows/phase-feed-flow.js";
import { buildPhaseFeedFlowDeps } from "../phase-wiring.js";
import { exitCode, formatError } from "../utils.js";

export default defineCommand({
  meta: {
    name: "feed",
    description:
      'Feed-before-produce PULL: print the governing skill\'s rule slice for a checkpoint ahead of writing (advisory only, never a gate); "session-resume" dispatches to SPEC-041 S2 resume instead',
  },
  args: {
    checkpoint: {
      type: "positional",
      description: 'Checkpoint to feed, e.g. "spec-create", "session-resume" (SPEC-041 S2), or "phase-start" (SPEC-056)',
      required: true,
    },
    phase: {
      type: "positional",
      description: "[phase-start only] Phase document ID or slug to build the feed pack for",
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
    const { app } = loadLoreApp();
    try {
      if (args.checkpoint === SESSION_RESUME_CHECKPOINT) {
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
        return;
      }

      if (args.checkpoint === PHASE_START_CHECKPOINT) {
        if (typeof args.phase !== "string" || args.phase.length === 0) {
          process.stderr.write(
            "Error: `lore feed phase-start <phase>` requires a phase document ID or slug.\n",
          );
          process.exitCode = 2;
          return;
        }

        const deps = buildPhaseFeedFlowDeps(app);
        const result = await buildPhaseStartPack(deps, args.phase);

        if (!result.ok) {
          process.stderr.write(formatError(result.error) + "\n");
          process.exitCode = exitCode(result.error);
          return;
        }

        if (args.json) {
          console.log(JSON.stringify(result.value, null, 2));
        } else {
          renderPhaseStartPack(result.value);
        }
        process.exitCode = 0;
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
function renderPhaseStartPack(pack: PhaseStartPack): void {
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
