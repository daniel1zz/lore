/**
 * lore approve <id> — approve a draft document.
 *
 * Implicit calibration capture (SPEC-035 §3 D3): after a successful approve,
 * pairs the human decision against the doc's latest AI review judgment (if any
 * whose `doc_version` matches the version the human just acted on) and records
 * a `confirmed`/`overridden` calibration outcome. This is a byproduct, never a
 * gate — a calibration write failure warns to stderr and still exits 0 (see
 * `../calibration-hook.ts`).
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { runCalibrationHook } from "../calibration-hook.js";
import type { DocId } from "@lore/core";

export default defineCommand({
  meta: {
    name: "approve",
    description: "Approve a draft document (transition draft → approved)",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID",
      required: true,
    },
    reviewer: {
      type: "string",
      description: "Reviewer identity — defaults to $LORE_ACTOR env var, then OS username",
    },
    "calibration-note": {
      type: "string",
      description: "Optional note recorded as the calibration record's delta_reasons[0]",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      const reviewer = resolveActor(typeof args.reviewer === "string" ? args.reviewer : undefined);
      const result = await app.reviewService.approve(args.id as DocId, { reviewer });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const doc = result.value;

      // reason: ReviewService.approve() bumps doc.version by 1 as part of the
      // draft → approved transition — the version the human was reviewing
      // (and that a judgment would be pinned to) is one less than the
      // returned doc's version. See calibration-hook.ts's CalibrationHookParams.
      await runCalibrationHook(app, {
        updatedDoc: doc,
        actedOnVersion: doc.version - 1,
        humanAction: "approve",
        actor: reviewer,
        ...(typeof args["calibration-note"] === "string" ? { note: args["calibration-note"] } : {}),
      });

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Approved ${doc.slug} → status: approved (v${doc.version})`);
      }
    } finally {
      app.close();
    }
  },
});
