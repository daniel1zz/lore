/**
 * lore approve <id> — approve a draft document.
 *
 * Implicit calibration capture (SPEC-035 §3 D3): after a successful approve,
 * pairs the human decision against the doc's latest AI review judgment (if any
 * whose `doc_version` matches the version the human just acted on) and records
 * a `confirmed`/`overridden` calibration outcome. This is a byproduct, never a
 * gate — a calibration write failure warns to stderr and still exits 0 (see
 * `../../../flows/calibration-hook.ts`).
 */

import { defineCommand } from "citty";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { runCalibrationHook } from "../../../flows/calibration-hook.js";
import type { DocId } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

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
    "calibration-note": {
      type: "string",
      description: "Optional note recorded as the calibration record's delta_reasons[0]",
    },
    "override-judgment": {
      type: "string",
      description:
        "SPEC-103 M2 audited escape — id of an existing review_judgments row on this doc " +
        "whose blocking verdict (or absence) to override. Skips the judgment-required " +
        "gate for this call only; recorded on the approve audit entry as override_judgment_id.",
    },
    "override-no-judgment": {
      type: "boolean",
      description:
        "task-t3-hardening audited escape — sibling of --override-judgment for the ONE " +
        "denial it cannot reach: NO_JUDGMENT with zero review_judgments rows for this doc " +
        "at all (there is no id to name). Legal only in that exact zero-judgment-ever state; " +
        "recorded on the approve audit entry as override_no_judgment. Mutually exclusive " +
        "with --override-judgment.",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const reviewer = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
      const result = await app.reviewService.approve(args.id as DocId, {
        reviewer,
        ...(typeof args["override-judgment"] === "string"
          ? { overrideJudgmentId: args["override-judgment"] }
          : {}),
        ...(args["override-no-judgment"] === true ? { overrideNoJudgment: true } : {}),
      });

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const doc = result.value;

      // reason: spec-verify-reachability-plan-promote-early-warning §Scope M1
      // — the `plan-promote` reachability EARLY-WARNING advisory, rendered to
      // stderr, NEVER to stdout/exit code (D1: advisory never changes the
      // outcome — this doc is already approved by the time this runs, exit
      // stays 0 regardless of whether any advisory lines print). Absent field
      // (the common case: non-plan approval, reachable plan, or no advisory
      // dependency wired) prints nothing at all.
      for (const advisory of doc.reachability_advisories ?? []) {
        inv.io.stderr.write(`${advisory}\n`);
      }

      // reason: ReviewService.approve() bumps doc.version by 1 as part of the
      // draft → approved transition — the version the human was reviewing
      // (and that a judgment would be pinned to) is one less than the
      // returned doc's version. See flows/calibration-hook.ts's CalibrationHookParams.
      await runCalibrationHook(app, {
        updatedDoc: doc,
        actedOnVersion: doc.version - 1,
        humanAction: "approve",
        actor: reviewer,
        ...(typeof args["calibration-note"] === "string" ? { note: args["calibration-note"] } : {}),
      });

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        printLine(inv.io.stdout, `Approved ${doc.slug} → status: approved (v${doc.version})`);
      }
    } finally {
      app.close();
    }
  },
});
