/**
 * lore reject <id> [--reason] — reject a draft document.
 *
 * Implicit calibration capture (SPEC-035 §3 D3): after a successful reject,
 * pairs the human decision against the doc's latest AI review judgment (if any
 * whose `doc_version` matches the doc's current version — reject never bumps
 * version) and records a `confirmed`/`overridden` calibration outcome. This is
 * a byproduct, never a gate — a calibration write failure warns to stderr and
 * still exits 0 (see `../../../flows/calibration-hook.ts`).
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { runCalibrationHook } from "../../../flows/calibration-hook.js";
import type { DocId } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
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
    item: {
      type: "string",
      description:
        "Baseline node only (BR-1338): discard the pending revision of this one item (BR-n | AS-n | AD-n | node); " +
        "the item reads as its approved version again. Items not named are untouched.",
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
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const reviewer = resolveActor(inv);
      const opts: Record<string, unknown> = { reviewer };
      if (args.reason !== undefined) opts["reason"] = args.reason;

      // BR-1338 — `--item` discards ONE pending revision of a baseline node; no judgment calibration applies (the
      // human decision is about a revision, not about the node's reviewed version).
      if (typeof args.item === "string") {
        const discarded = await app.reviewService.rejectItem(args.id as DocId, args.item, opts);
        if (!discarded.ok) {
          inv.io.stderr.write(formatErrorFor(inv, discarded.error) + "\n");
          return exitCode(discarded.error);
        }
        const { doc, discarded: revision } = discarded.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { ...doc, discarded_item: revision.item, discarded_revision: revision.revisionId } }, null, 2));
        } else {
          printLine(inv.io.stdout, `Discarded the pending revision of ${revision.item} on ${doc.slug} → status: ${doc.status} (v${doc.version})`);
          if (args.reason) printLine(inv.io.stdout, `  Reason: ${args.reason}`);
        }
        return 0;
      }

      const result = await app.reviewService.rejectWithOutcome(args.id as DocId, opts);

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const { doc, from_status: fromStatus } = result.value;

      // reason: ReviewService.reject() never bumps doc.version (status stays
      // 'draft') — the version the human was reviewing IS the returned doc's
      // version. See flows/calibration-hook.ts's CalibrationHookParams.
      await runCalibrationHook(app, {
        updatedDoc: doc,
        actedOnVersion: doc.version,
        humanAction: "reject",
        actor: reviewer,
        ...(typeof args["calibration-note"] === "string" ? { note: args["calibration-note"] } : {}),
      });

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { ...doc, from_status: fromStatus } }, null, 2));
      } else {
        printLine(inv.io.stdout, `Rejected ${doc.slug} (${
            fromStatus === doc.status ? `status unchanged: ${doc.status}` : `${fromStatus} -> ${doc.status}`
          })`);
        if (args.reason) printLine(inv.io.stdout, `  Reason: ${args.reason}`);
      }
    } finally {
      app.close();
    }
    return 0;
  },
});
