/**
 * `lore archive --sweep [--json]` / `lore archive --apply [--json]`
 * — the deterministic, on-demand half of lifecycle archival (R2-R4 sweep
 * rules; R1's automatic plan-close cascade lives in
 * `CorpusService.cascadeArchiveOnPlanClose`, wired into `lore set`).
 *
 * `--sweep` (report-only, mirrors `lore status --check-drift`'s
 * discover-don't-mutate contract): recomputes `computeArchiveCandidates`
 * (`@lore/core`) over the FULL corpus, prints each candidate's rule + reason
 * + a literal repair command, exit 0 when there are none, exit 3 when there
 * are — CI-composable the same way `--check-drift` is.
 *
 * `--apply`: recomputes candidates FRESH (never reuses a
 * stale `--sweep` snapshot — the corpus may have changed between the two
 * invocations) and archives every one of them via
 * `CorpusService.archiveSweepCandidate`, one audited write each
 * (`action: "archive-sweep"`). A per-candidate write failure is printed and
 * does not abort the loop (spec-lifecycle-archival-plan-close-cascade-deterministic
 * §Design Decisions D2's "loud, never silent, never rolls back" ethos applied
 * here too) — exit 0 regardless, since the operation is fundamentally
 * best-effort over an already-computed candidate list (an individual
 * INVALID_TRANSITION/STALE_VERSION on one doc is itemized in the printed
 * output, not swallowed).
 *
 * Neither flag, or BOTH flags together, is a usage error (exit 2) — the two
 * modes are mutually exclusive by design (report vs mutate), same discipline
 * `lore set`'s `--regenerate`/`--refine` mutex uses.
 *
 * Exit codes: 0 = sweep found nothing / apply completed; 2 = usage error
 * (no flag, or both flags); 3 = sweep found candidates.
 *
 * Source: spec-lifecycle-archival-plan-close-cascade-deterministic §Design
 *   Decisions D3, D5.
 */

import { defineCommand } from "citty";
import { setExitCode } from "../run-scope.js";
import { computeArchiveCandidates, resolveClaimTtlMinutes, resolveHandoffTtlMinutes } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import type { IssueCloseItem } from "../../../service/issue-close-on-archive.js";
import { emitIssueCloseItems } from "../issue-close-output.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/**
 * The literal, copy-pasteable repair command printed for every `--sweep`
 * candidate — a SINGLE global command (not per-candidate) since `--apply`
 * archives every current candidate in one pass, not just the one it's
 * printed under.
 */
const REPAIR_COMMAND = "lore archive --apply";

export default defineCommand({
  meta: {
    name: "archive",
    description: "Deterministic lifecycle-archival sweep — report or apply R2-R4 archive candidates",
  },
  args: {
    sweep: {
      type: "boolean",
      description: "Report-only: list current archive candidates (exit 3 if any, 0 if none)",
    },
    apply: {
      type: "boolean",
      description: "Archive every current candidate (one audited write each)",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const sweepRequested = args.sweep === true;
    const applyRequested = args.apply === true;

    if (sweepRequested === applyRequested) {
      // reason: both false (neither flag) and both true (both flags) collapse to
      // the same usage-error branch — exactly one of --sweep/--apply is required.
      inv.io.stderr.write("Exactly one of --sweep or --apply is required.\n");
      setExitCode(2);
      return;
    }

    const { app, config } = loadLoreApp({ inv });
    const ttl = {
      handoffTtlMinutes: resolveHandoffTtlMinutes(config),
      claimTtlMinutes: resolveClaimTtlMinutes(config),
    };

    const listResult = await app.corpusService.listFull({});
    if (!listResult.ok) {
      inv.io.stderr.write(formatErrorFor(inv, listResult.error) + "\n");
      setExitCode(exitCode(listResult.error));
      return;
    }

    const nowIso = new Date().toISOString();
    const candidates = computeArchiveCandidates(listResult.value.docs, nowIso, ttl);

    if (sweepRequested) {
      // Annotate each floor-refused task straggler with its floor (read-only; the service asks the
      // same DoneFloorPort `--apply` does). The candidate is still listed and still exits 3.
      const refusingFloors = new Map<string, string>();
      const sweepDocs = new Map(listResult.value.docs.map((d) => [d.id, d] as const));
      for (const c of candidates) {
        const doc = sweepDocs.get(c.doc_id);
        if (doc === undefined) continue;
        const floorResult = await app.corpusService.checkSweepCandidateFloor(doc, c.rule);
        if (!floorResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, floorResult.error) + "\n");
          setExitCode(exitCode(floorResult.error));
          return;
        }
        if (floorResult.value !== null) refusingFloors.set(c.doc_id, floorResult.value.floor);
      }
      if (args.json) {
        printLine(inv.io.stdout, 
          JSON.stringify(
            {
              ok: true,
              data: {
                candidates: candidates.map((c) => {
                  const floor = refusingFloors.get(c.doc_id);
                  return floor === undefined ? { ...c, repair: REPAIR_COMMAND } : { ...c, repair: REPAIR_COMMAND, floor };
                }),
              },
            },
            null,
            2,
          ),
        );
      } else if (candidates.length === 0) {
        printLine(inv.io.stdout, "No archive candidates.");
      } else {
        printLine(inv.io.stdout, `${candidates.length} archive candidate(s):`);
        for (const c of candidates) {
          const floor = refusingFloors.get(c.doc_id);
          printLine(inv.io.stdout, `  [${c.rule}] ${c.slug} — ${c.reason}`);
          printLine(inv.io.stdout, 
            floor === undefined
              ? `    repair: ${REPAIR_COMMAND}`
              : `    refused by ${floor}: --apply will skip it until the floor is cleared (see \`lore done ${c.slug}\`)`,
          );
        }
      }
      setExitCode(candidates.length === 0 ? 0 : 3);
      return;
    }

    // --apply
    const by = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
    const docsById = new Map(listResult.value.docs.map((d) => [d.id, d] as const));
    const outcomes: Array<{ slug: string; ok: boolean; detail: string; skipped?: true; floor?: string }> = [];
    // spec-archiving-the-work-that-resolves-a-defect-report-closes D4 — the sweep is an archive path too.
    const issueCloseItems: IssueCloseItem[] = [];

    for (const candidate of candidates) {
      const doc = docsById.get(candidate.doc_id);
      if (doc === undefined) {
        outcomes.push({ slug: candidate.slug, ok: false, detail: "doc not found in fetched candidate set" });
        continue;
      }
      const result = await app.corpusService.archiveSweepCandidate(doc, candidate.rule, candidate.reason, { by });
      if (!result.ok) {
        const floor = result.error.code === "VALIDATION_ERROR" ? result.error.details?.floor : undefined;
        if (floor !== undefined) {
          // A `lore done` floor refusal: the task stays open (not a failure), still reported by --sweep.
          outcomes.push({ slug: candidate.slug, ok: false, skipped: true, floor, detail: `refused by ${floor}` });
          continue;
        }
        outcomes.push({ slug: candidate.slug, ok: false, detail: formatErrorFor(inv, result.error) });
        continue;
      }
      outcomes.push({ slug: candidate.slug, ok: true, detail: `archived → v${result.value.version}` });
      issueCloseItems.push(...(result.value.issueClose ?? []));
    }

    if (args.json) {
      printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { outcomes } }, null, 2));
    } else if (outcomes.length === 0) {
      printLine(inv.io.stdout, "No archive candidates to apply.");
    } else {
      for (const o of outcomes) {
        printLine(inv.io.stdout, `  [${o.ok ? "OK" : o.skipped === true ? "SKIPPED" : "FAILED"}] ${o.slug} — ${o.detail}`);
      }
    }
    emitIssueCloseItems(inv.io, issueCloseItems, { json: args.json === true });
    setExitCode(0);
  },
});
