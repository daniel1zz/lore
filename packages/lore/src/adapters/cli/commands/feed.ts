/**
 * lore feed <checkpoint> [--parent <id-or-slug>] [--plan <id-or-slug>]
 *   [--handoff <id-or-slug>] [--by <name>] [--json] — the deterministic
 * feed-before-produce PULL surface (IoC vertical-slice tech-spec §4.1/§11, P4 slice)
 * PLUS the SPEC-041 S2 session-resume dispatch (D5).
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
 * Exit code: for every OTHER checkpoint, ALWAYS 0 — feed is advisory context, never a
 * gate (module header, task objective). For `session-resume`, 0 on success (including
 * the "(no handoff recorded)" fact) — a resolution failure maps through the normal
 * `exitCode()`/`formatError()` pipeline (VALIDATION_ERROR → 4), since an unresolvable
 * `--plan`/`--handoff` is a caller input error, not an advisory-degrade case.
 *
 * Source: IoC vertical-slice tech-spec §4.1/§11, P4 slice; SPEC-041 §3 D5
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { buildFeed, buildResumeFeed, SESSION_RESUME_CHECKPOINT } from "../../../flows/feed-flow.js";
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
      description: 'Checkpoint to feed, e.g. "spec-create", or "session-resume" (SPEC-041 S2)',
      required: true,
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
