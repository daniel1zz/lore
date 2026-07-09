/**
 * lore feed <checkpoint> [--parent <id-or-slug>] [--json] — the deterministic
 * feed-before-produce PULL surface (IoC vertical-slice tech-spec §4.1/§11, P4 slice).
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
 * Exit code is ALWAYS 0 — feed is advisory context, never a gate (module header,
 * task objective). There is no failure mode this command can report via exit code.
 *
 * Source: IoC vertical-slice tech-spec §4.1/§11, P4 slice
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { buildFeed } from "../../../flows/feed-flow.js";

export default defineCommand({
  meta: {
    name: "feed",
    description:
      "Feed-before-produce PULL: print the governing skill's rule slice for a checkpoint ahead of writing (advisory only, never a gate)",
  },
  args: {
    checkpoint: {
      type: "positional",
      description: 'Checkpoint to feed, e.g. "spec-create"',
      required: true,
    },
    parent: {
      type: "string",
      description: "Intended parent doc id/slug — its MDX-resolved summary is included when supplied",
    },
    json: {
      type: "boolean",
      description: "Output as JSON: { checkpoint, type, skill, feed }",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
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
