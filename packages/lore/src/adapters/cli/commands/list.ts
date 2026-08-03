/**
 * lore list — list documents with optional filters.
 *
 * New in SPEC-023:
 *   --plan-id <id|slug>  Filter tasks by PLAN MEMBERSHIP (extra.plan_id, via the
 *                        shared isPlanMember predicate) — the SAME property
 *                        `lore create task --plan-id` writes, never `parent_id`.
 *   --phase <name>       Filter tasks by extra.phase name (requires --type task or --plan-id).
 *                        Client-side filter — applied after store fetch since StoreFilters
 *                        has no extra-field index. Only useful with --type task.
 *
 * ## `--plan-id`'s contract — JUDGMENT recorded here
 * (task-plan-member-sites-twelve-and-thirteen-both-structurally, site 13)
 *
 * `--plan-id` used to resolve to a `parent_id` filter — its own help text said so
 * verbatim ("resolves to parent_id"). That silently excluded the SUPPORTED
 * divergent shape SPEC-065 D4 describes (`lore create task --plan-id P --parent
 * Q`, P !== Q): a task legitimately a MEMBER of P but filed at Q never appeared
 * under `lore list --plan-id P`. Two fixes were available — change this flag's
 * contract to membership, or leave it alone and add a second, differently-named
 * membership flag beside it. CHOSEN: change the contract, because `--plan-id`
 * ALREADY means membership (`extra.plan_id`) everywhere else this CLI accepts
 * it — `create.ts`'s own `--plan-id` writes `extra.plan_id`, with `--parent` as
 * the SEPARATE flag for filing location (SPEC-065 D4's own vocabulary). A flag
 * whose name means one property at `create` time and a DIFFERENT property at
 * `list` time is a footgun independent of the divergence defect; a second flag
 * would leave that cross-command inconsistency standing forever. No test in
 * this tree pins the old parent_id contract as distinct from membership — the
 * one incidental `list --plan-id` usage (`list-paging.test.ts`) passes a task
 * whose `--parent` and `--plan-id` are the SAME value, so it cannot tell the
 * two contracts apart, and passes under either. `extra.plan_id` exists only on
 * `task` docs, so the filter is `doc.type === "task" && isPlanMember(doc,
 * resolvedPlanId)`; StoreFilters has no index for it, so — like `--phase` — it
 * is applied CLIENT-SIDE after a full DocRecord fetch (`passesPlanMembership`
 * below), composing with `--phase`/`--type task`/`--include-invalid` rather
 * than duplicating each of their branches.
 *
 * --governed-by is exclusive of every other filter flag (--type/--status/--author/
 * --since/--tag/--plan-id/--phase): combining them fails loud (exit 2, naming the
 * conflicting flags) rather than silently running --governed-by alone and dropping
 * the rest. --json is a rendering mode, not a filter, and may combine freely.
 *
 * --limit <n> / --offset <n> — optional paging (pagination hardening, unbounded-payload
 * review). BOTH omitted → current unbounded behavior, byte-identical (backward-compatible
 * default for human CLI usage). Every branch below sources its own list from ONE of two
 * stances: (a) branches whose result set is exactly what the store returned AND no
 * --plan-id filter is active push `limit`/`offset` straight into the `StoreFilters`
 * object via `withPaging()`, so the DB itself bounds the row count; (b) branches that
 * ALREADY narrow the store's result set client-side (--phase's extra.phase filter,
 * --plan-id's membership filter, --governed-by's link-table result) apply
 * `limit`/`offset` via `.slice()` AFTER that narrowing — pushing paging into the store
 * call there would apply the page boundary BEFORE the narrowing filter runs, silently
 * truncating or misaligning pages (same class of bug `StoreInterface.findMany`'s own
 * `tags`-filter-vs-paging guard avoids).
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import {
  exitCode,
  formatError,
  formatTable,
  formatValidityBadge,
  formatWorkflowBadge,
  parsePositiveIntArg,
  relativeTime,
} from "../utils.js";
import { isPlanMember } from "../../../service/plan-membership.js";
import { ok } from "@lore/core";
import type { DocRecord, DocType, DocStatus, LoreError, Result } from "@lore/core";

export default defineCommand({
  meta: {
    name: "list",
    description: "List documents with optional filters",
  },
  args: {
    type: {
      type: "string",
      description: "Filter by type: prd | spec | adr | plan | knowledge | task",
    },
    status: {
      type: "string",
      description: "Filter by status: draft | in-review | approved | active | archived | deprecated",
    },
    author: {
      type: "string",
      description: "Filter by author (created_by)",
    },
    since: {
      type: "string",
      description: "ISO 8601 date — only docs updated at or after this time",
    },
    tag: {
      type: "string",
      description: "Filter by tag",
    },
    "plan-id": {
      type: "string",
      description:
        "Filter tasks by PLAN MEMBERSHIP (extra.plan_id, the same property `lore create task " +
        "--plan-id` writes — never parent_id). Includes a task filed elsewhere via --parent " +
        "(SPEC-065 D4 divergence). Useful with --type task.",
    },
    phase: {
      type: "string",
      description: "Filter tasks by phase name (extra.phase). Combine with --type task and --plan-id. Source: SPEC-023",
    },
    "governed-by": {
      type: "string",
      description: "List artifacts governed by a skill (ID or slug) via its 'governs' links. Exclusive of other filters.",
    },
    "include-invalid": {
      type: "boolean",
      description: "Include invalidated knowledge/adr/task docs (excluded by default). Source: SPEC-043 D3, task-a-task-cannot-be-retracted-supersedes-emits-a-repair.",
    },
    limit: {
      type: "string",
      description: "Max documents to return. Omitted → unbounded (current default behavior).",
    },
    offset: {
      type: "string",
      description: "Number of matching documents to skip before returning results. Requires a deterministic sort — always paired with the store's stable updated_at DESC, id ASC ordering.",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      // BUG-006/007 audit: a NaN --limit/--offset used to reach `.slice(0, NaN)`
      // (silently empty results) or a store-level `LIMIT ?`/`OFFSET ?` bind (a
      // bare bun:sqlite "datatype mismatch" throw) — validate both up front.
      // reason: `--limit 0` is a LEGAL "zero-row page" request here (pre-existing,
      // REGRESSION-tested behavior in list-paging.test.ts) — min is 0, not 1,
      // unlike search/log/audit's --limit (which are result-COUNT caps, never a
      // page-size negotiation).
      let limit: number | undefined;
      if (args.limit !== undefined) {
        const limitResult = parsePositiveIntArg(args.limit, "--limit", { min: 0 });
        if (!limitResult.ok) {
          process.stderr.write(limitResult.message + "\n");
          process.exitCode = 2;
          return;
        }
        limit = limitResult.value;
      }

      let offset: number | undefined;
      if (args.offset !== undefined) {
        const offsetResult = parsePositiveIntArg(args.offset, "--offset", { min: 0 });
        if (!offsetResult.ok) {
          process.stderr.write(offsetResult.message + "\n");
          process.exitCode = 2;
          return;
        }
        offset = offsetResult.value;
      }
      // reason: store-level paging is safe to apply directly to `StoreFilters` ONLY
      // when nothing narrows the result set client-side after the fetch — see this
      // file's header comment for the (a)/(b) branch split.
      const withPaging = (base: Record<string, unknown>): Record<string, unknown> => ({
        ...base,
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
      });
      // reason: client-side slice for branches that ALREADY narrowed the store's
      // result set in-memory (--phase, --governed-by) — see header comment.
      function pageInMemory<T>(docs: T[]): T[] {
        if (limit === undefined && offset === undefined) return docs;
        const start = offset ?? 0;
        return limit !== undefined ? docs.slice(start, start + limit) : docs.slice(start);
      }
      // --governed-by is a link-table reverse query (skill --governs--> artifact),
      // not a StoreFilters column predicate — it short-circuits to its own dedicated
      // service method (CorpusService.listGovernedBy) rather than joining the
      // filters object below. Source: IoC vertical-slice tech-spec §4.1 P4.
      if (args["governed-by"] !== undefined) {
        // Fail loud instead of silently dropping the other filters: --governed-by
        // short-circuits to listGovernedBy above and never reaches the filters
        // block below, so any other filter flag passed alongside it would
        // otherwise be silently ignored. Source: no-silent-fallback project norm.
        const otherFilterKeys = ["type", "status", "author", "since", "tag", "plan-id", "phase"] as const;
        const conflicting = otherFilterKeys.filter((k) => args[k] !== undefined);
        if (conflicting.length > 0) {
          process.stderr.write(
            `Error: --governed-by cannot be combined with ${conflicting.map((k) => `--${k}`).join(", ")}.\n`,
          );
          process.exitCode = 2;
          return;
        }

        const governedResult = await app.corpusService.listGovernedBy(args["governed-by"]);
        if (!governedResult.ok) {
          process.stderr.write(formatError(governedResult.error) + "\n");
          process.exitCode = exitCode(governedResult.error);
          return;
        }
        // reason: listGovernedBy has no store-level limit/offset param — page the
        // already-fetched result in-memory (see header comment's (b) stance).
        const docs = pageInMemory(governedResult.value.docs);
        const total = docs.length;

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { docs, total } }, null, 2));
          return;
        }
        if (total === 0) {
          console.log(`No documents governed by "${args["governed-by"]}".`);
          return;
        }
        const headers = ["ID", "Type", "Title", "Status", "Updated"];
        const rows = docs.map((d) => [
          d.id.slice(0, 10),
          d.type,
          d.title.slice(0, 35),
          d.status,
          relativeTime(d.updated_at),
        ]);
        console.log(formatTable(headers, rows));
        console.log(`\n${total} document${total === 1 ? "" : "s"} (filter: --governed-by ${args["governed-by"]})`);
        return;
      }

      const filters: Record<string, unknown> = {};
      if (args.type !== undefined) filters["type"] = args.type as DocType;
      if (args.status !== undefined) filters["status"] = args.status as DocStatus;
      if (args.author !== undefined) filters["created_by"] = args.author;
      if (args.since !== undefined) filters["since"] = args.since;
      if (args.tag !== undefined) filters["tags"] = [args.tag];
      const includeInvalid = args["include-invalid"] === true;
      if (includeInvalid) filters["include_invalid"] = true;

      // Resolve --plan-id slug or ULID → the plan's own DocId, used as a
      // MEMBERSHIP filter (extra.plan_id via isPlanMember) — see this file's
      // header for the contract decision. Deliberately NOT written into
      // `filters`: StoreFilters has no extra.plan_id column, so this is a
      // client-side predicate applied after a full DocRecord fetch, same as
      // --phase below.
      let planMemberId: string | undefined;
      if (args["plan-id"] !== undefined) {
        const resolveResult = await app.corpusService.resolve(args["plan-id"]);
        if (!resolveResult.ok) {
          process.stderr.write(formatError(resolveResult.error) + "\n");
          process.exitCode = exitCode(resolveResult.error);
          return;
        }
        planMemberId = resolveResult.value;
      }
      // reason: extra.plan_id exists only on `task` docs (createDocInputSchema's
      // task branch) — `isPlanMember` itself does not check `type` (its own
      // JSDoc: callers are expected to have already narrowed to type ===
      // "task"), so this guard is drawn HERE rather than trusting a non-task
      // doc's `extra.plan_id` (which should never be set, but extra is an
      // unvalidated Record<string, unknown> at the type level) to compare false
      // on its own.
      function passesPlanMembership(doc: DocRecord): boolean {
        // reason: aliased to a local const so the `undefined` narrowing below
        // is sound regardless of how TS treats the outer `let` capture.
        const requiredPlanId = planMemberId;
        if (requiredPlanId === undefined) return true;
        return doc.type === "task" && isPlanMember(doc, requiredPlanId);
      }
      const planFilterDesc = (): string => (planMemberId !== undefined ? ` --plan-id ${args["plan-id"]}` : "");

      // reason: three branches below (--type task, --include-invalid, and the
      // plan-membership-only fallback) all need "full DocRecords matching
      // `filters`, membership-narrowed and paged" — this is the ONE place that
      // decides (a) store-level paging via `withPaging` (no client-side
      // narrowing active) vs (b) client-side narrow-then-slice via
      // `pageInMemory` (planMemberId active), so the (a)/(b) split this file's
      // header documents can never diverge between call sites.
      async function fetchFullDocsForListing(): Promise<Result<{ docs: DocRecord[]; total: number }, LoreError>> {
        if (planMemberId === undefined) {
          return app.corpusService.listFull(withPaging(filters));
        }
        const fullResult = await app.corpusService.listFull(filters);
        if (!fullResult.ok) return fullResult;
        const narrowed = pageInMemory(fullResult.value.docs.filter((doc) => passesPlanMembership(doc)));
        return ok({ docs: narrowed, total: narrowed.length });
      }

      // When --phase filter is active, we need full DocRecord rows (extra.phase is not in DocSummary).
      // reason: StoreFilters has no extra-field index; client-side filter is applied after fetch.
      // Source: SPEC-023 §4 AC-PHASE-7
      const phaseFilter = args.phase;
      if (phaseFilter !== undefined) {
        const fullResult = await app.corpusService.listFull(filters);
        if (!fullResult.ok) {
          process.stderr.write(formatError(fullResult.error) + "\n");
          process.exitCode = exitCode(fullResult.error);
          return;
        }
        // reason: extra.phase AND --plan-id's membership filter (see file header) are
        // both client-side — paging must apply AFTER both narrow the set, never
        // before (header comment's (b) stance).
        const filtered = pageInMemory(
          fullResult.value.docs.filter(
            (doc) => doc.extra["phase"] === phaseFilter && passesPlanMembership(doc),
          ),
        );
        const total = filtered.length;

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { docs: filtered, total } }, null, 2));
          return;
        }
        if (total === 0) {
          console.log(`No documents found with phase "${phaseFilter}".`);
          return;
        }
        // reason: workflow badge (claim/evidence, AC-WF-9) is only meaningful for task
        // rows; --phase filtering only applies to tasks in practice (SPEC-023), so we
        // always compute it here rather than branching on d.type.
        const nowIso = new Date().toISOString();
        const ttlMinutes = app.taskWorkflowService.claimTtlMinutes;
        const headers = ["ID", "Type", "Title", "Status", "Phase", "Updated"];
        const rows = filtered.map((d) => [
          d.id.slice(0, 10),
          d.type,
          `${d.title.slice(0, 30)}${formatWorkflowBadge(d, nowIso, ttlMinutes)}`,
          d.status,
          String(d.extra["phase"] ?? ""),
          relativeTime(d.updated_at),
        ]);
        console.log(formatTable(headers, rows));
        console.log(`\n${total} document${total === 1 ? "" : "s"} (filter: --phase ${phaseFilter}${planFilterDesc()})`);
        return;
      }

      // Task-type listings render a claim/evidence workflow badge on each row
      // (AC-WF-9). This requires the full DocRecord (extra.claim / extra.verification_evidence
      // are not in DocSummary) — mirrors the --phase branch's listFull usage above.
      if (filters["type"] === "task") {
        const fullResult = await fetchFullDocsForListing();
        if (!fullResult.ok) {
          process.stderr.write(formatError(fullResult.error) + "\n");
          process.exitCode = exitCode(fullResult.error);
          return;
        }
        const { docs: fullDocs, total: fullTotal } = fullResult.value;

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { docs: fullDocs, total: fullTotal } }, null, 2));
          return;
        }
        if (fullTotal === 0) {
          console.log("No documents found.");
          return;
        }

        const nowIso = new Date().toISOString();
        const ttlMinutes = app.taskWorkflowService.claimTtlMinutes;
        const headers = ["ID", "Type", "Title", "Status", "Updated"];
        const rows = fullDocs.map((d) => [
          d.id.slice(0, 10),
          d.type,
          `${d.title.slice(0, 35)}${formatWorkflowBadge(d, nowIso, ttlMinutes)}`,
          d.status,
          relativeTime(d.updated_at),
        ]);
        console.log(formatTable(headers, rows));
        console.log(`\n${fullTotal} document${fullTotal === 1 ? "" : "s"} (filter: --type task${planFilterDesc()})`);
        return;
      }

      // reason: DocSummary (list()'s return shape) carries no validity signal — when
      // --include-invalid is passed we need full DocRecords to compute the [invalid]
      // badge, mirroring the --phase/--type task branches' listFull usage above.
      // Source: SPEC-043 D3/D4.
      if (includeInvalid) {
        const fullResult = await fetchFullDocsForListing();
        if (!fullResult.ok) {
          process.stderr.write(formatError(fullResult.error) + "\n");
          process.exitCode = exitCode(fullResult.error);
          return;
        }
        const { docs: fullDocs, total: fullTotal } = fullResult.value;

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { docs: fullDocs, total: fullTotal } }, null, 2));
          return;
        }
        if (fullTotal === 0) {
          console.log("No documents found.");
          return;
        }

        const nowIso = new Date().toISOString();
        const headers = ["ID", "Type", "Title", "Status", "Updated"];
        const rows = fullDocs.map((d) => [
          d.id.slice(0, 10),
          d.type,
          `${d.title.slice(0, 35)}${formatValidityBadge(d, nowIso)}`,
          d.status,
          relativeTime(d.updated_at),
        ]);
        console.log(formatTable(headers, rows));
        console.log(
          `\n${fullTotal} document${fullTotal === 1 ? "" : "s"} (filter: --include-invalid${planFilterDesc()})`,
        );
        return;
      }

      // reason: --plan-id is a membership filter with no StoreFilters column
      // (see file header) — when it is the ONLY reason a full-record fetch is
      // needed (no --phase / --type task / --include-invalid triggered one of
      // the branches above), this is the fallback that still narrows via
      // isPlanMember instead of falling through to the DocSummary-based
      // `list()` call below, which cannot see `extra.plan_id` at all.
      if (planMemberId !== undefined) {
        const fullResult = await fetchFullDocsForListing();
        if (!fullResult.ok) {
          process.stderr.write(formatError(fullResult.error) + "\n");
          process.exitCode = exitCode(fullResult.error);
          return;
        }
        const { docs: fullDocs, total: fullTotal } = fullResult.value;

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { docs: fullDocs, total: fullTotal } }, null, 2));
          return;
        }
        if (fullTotal === 0) {
          console.log(`No documents found with plan membership "${args["plan-id"]}".`);
          return;
        }

        const headers = ["ID", "Type", "Title", "Status", "Updated"];
        const rows = fullDocs.map((d) => [
          d.id.slice(0, 10),
          d.type,
          d.title.slice(0, 35),
          d.status,
          relativeTime(d.updated_at),
        ]);
        console.log(formatTable(headers, rows));
        const otherFilterDesc = Object.entries(filters)
          .map(([k, v]) => `--${k} ${Array.isArray(v) ? v.join(",") : String(v)}`)
          .join(" ");
        console.log(
          `\n${fullTotal} document${fullTotal === 1 ? "" : "s"} (filter:${planFilterDesc()}` +
            `${otherFilterDesc ? ` ${otherFilterDesc}` : ""})`,
        );
        return;
      }

      const result = await app.corpusService.list(withPaging(filters));

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const { docs, total } = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { docs, total } }, null, 2));
        return;
      }

      if (total === 0) {
        console.log("No documents found.");
        return;
      }

      const headers = ["ID", "Type", "Title", "Status", "Updated"];
      const rows = docs.map((d) => [
        d.id.slice(0, 10),
        d.type,
        d.title.slice(0, 35),
        d.status,
        relativeTime(d.updated_at),
      ]);

      console.log(formatTable(headers, rows));

      const filterDesc = Object.entries(filters)
        .map(([k, v]) => `--${k} ${Array.isArray(v) ? v.join(",") : String(v)}`)
        .join(" ");
      console.log(`\n${total} document${total === 1 ? "" : "s"}${filterDesc ? ` (filter: ${filterDesc})` : ""}`);
    } finally {
      app.close();
    }
  },
});
