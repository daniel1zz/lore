/**
 * lore reject <id> [--reason] — reject a draft document.
 *
 * Implicit calibration capture (SPEC-035 §3 D3): after a successful reject,
 * pairs the human decision against the doc's latest AI review judgment (if any
 * whose `doc_version` matches the doc's current version — reject never bumps
 * version) and records a `confirmed`/`overridden` calibration outcome. This is
 * a byproduct, never a gate — a calibration write failure warns to stderr and
 * still exits 0 (see `../calibration-hook.ts`).
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { runCalibrationHook } from "../calibration-hook.js";
import type { DocId } from "@lore/core";

export default defineCommand({
  meta: {
    name: "reject",
    description: "Reject a draft document (records reason in audit)",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID",
      required: true,
    },
    reason: {
      type: "string",
      description: "Rejection reason (stored in audit log)",
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
      const opts: Record<string, unknown> = { reviewer };
      if (args.reason !== undefined) opts["reason"] = args.reason;

      const result = await app.reviewService.reject(args.id as DocId, opts);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const doc = result.value;

      // reason: ReviewService.reject() never bumps doc.version (status stays
      // 'draft') — the version the human was reviewing IS the returned doc's
      // version. See calibration-hook.ts's CalibrationHookParams.
      await runCalibrationHook(app, {
        updatedDoc: doc,
        actedOnVersion: doc.version,
        humanAction: "reject",
        actor: reviewer,
        ...(typeof args["calibration-note"] === "string" ? { note: args["calibration-note"] } : {}),
      });

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Rejected ${doc.slug} (status remains: ${doc.status})`);
        if (args.reason) console.log(`  Reason: ${args.reason}`);
      }
    } finally {
      app.close();
    }
  },
});
