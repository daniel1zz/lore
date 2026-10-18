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
 * --since/--tag/--plan-id/--phase/--sub-type): combining them fails loud (exit 2,
 * naming the conflicting flags) rather than silently running --governed-by alone and
 * dropping the rest. --json is a rendering mode, not a filter, and may combine freely.
 *
 * ## `--sub-type` is a STORE-level predicate, unlike --phase/--plan-id
 * (spec-a-write-side-fact-with-no-read-side-address-counts-with-no §Scope M3, AC-RR-5/6)
 *
 * `--phase` and `--plan-id` read `extra` fields with no SQL predicate, so they are
 * client-side filters and their branches page in-memory (stance (b) below).
 * `--sub-type` is deliberately NOT one of those: it joins the `filters` object and
 * is pushed all the way into `StoreInterface.findMany`, where it becomes a bound
 * `json_extract(extra, '$.sub_type') = ?` clause. That placement is the whole point
 * — a post-fetch sub-type filter would return fewer rows than `--limit` asked for
 * while more matches sat past `--offset`, which is exactly what AC-RR-5's
 * `--limit 1 --offset 1` oracle is constructed to catch. ⛔ Never "simplify" it into
 * a `.filter()` beside the --phase predicate.
 *
 * Because a knowledge listing takes the DocSummary fallback branch (it is not
 * `--type task`, and carries no --phase/--plan-id), `--sub-type` composes with
 * `withPaging()` and the DB bounds the page directly.
 *
 * The USAGE half (`--sub-type` requires `--type knowledge`; an unrecognised value is
 * refused by name) is NOT implemented here — it is one shared seam,
 * `CorpusService::resolveSubTypeFilter`, consumed identically by `lore search` and
 * both MCP read tools. This file only maps its refusal to exit 2.
 *
 * --limit <n> / --offset <n> — optional paging (pagination hardening, unbounded-payload
 * review). BOTH omitted → current unbounded behavior, byte-identical (backward-compatible
 * default for human CLI usage). Every branch below sources its own list from ONE of two
 * stances: (a) the DocSummary fallback branch — whose result set is exactly what the
 * store returned AND no --plan-id filter is active — pushes `limit`/`offset` straight
 * into the `StoreFilters` object via `withPaging()`, so the DB itself bounds the row
 * count; (b) EVERY full-record branch (--type task / --phase / --plan-id /
 * --include-invalid) applies `limit`/`offset` via `.slice()` AFTER its client-side
 * narrowing — pushing paging into the store call there would apply the page boundary
 * BEFORE the narrowing filter runs, silently truncating or misaligning pages (same
 * class of bug `StoreInterface.findMany`'s own `tags`-filter-vs-paging guard avoids).
 * Since the SPEC-043 D3 validity exclusion below is ITSELF a client-side narrowing that
 * every full-record branch now applies, stance (b) is unconditional there — there is no
 * longer a "store-paged full-record branch" case to keep in sync.
 *
 * ## Validity is DATA here, not decoration — SPEC-043 D3
 * (task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in)
 *
 * MEASURED before this fix, on a throwaway corpus with one retracted doc per eligible
 * type: `lore list --type task` SHOWED the retracted task, `--include-invalid` changed
 * NOTHING (identical row count, identical slug set, no badge), and no `--json` record on
 * any type carried a validity-bearing key. Only knowledge/adr got the D3 exclusion, and
 * only because those two fall through to the `CorpusService.list()` (DocSummary) branch,
 * which applies the exclusion internally. `CorpusService.listFull()` — the fetch every
 * OTHER branch uses, by documented design — strips `include_invalid` and applies no
 * exclusion at all, so the `--type task`, `--phase` and `--plan-id` branches were all
 * validity-blind, and the flag documented to control that visibility was inert.
 *
 * Fix, in the order the defect requires: (1) DATA — `fetchGatedFullDocs()` attaches an
 * explicit `validity_status` (`../../../service/validity-service.js`) to every full
 * record, so a `--json` consumer can decide without a second call per doc; (2) FILTER —
 * the same function applies `selectLiveDocs` unless `--include-invalid`, making the
 * default exclusion real and the flag's effect measurable as a row-count DIFFERENCE;
 * (3) BADGE — every full-record branch renders `formatValidityBadge` unconditionally
 * (not only the --include-invalid branch, the pre-fix arrangement that let the
 * --type task branch render a workflow badge and no validity badge), plus a dedicated
 * `Validity` column under `--include-invalid` so presence never reads as validity.
 *
 * ⛔ `fetchGatedFullDocs()` is the ONE gate. A new branch that calls
 * `app.corpusService.listFull()` directly re-opens exactly this defect: `listFull`
 * ignores `include_invalid` on purpose (its JSDoc pins that), so the exclusion has to be
 * applied by the reader.
 *
 * ⛔ RESIDUAL CLOSED (task-validity-landed-on-lore-list-only-the-dispatch-surface,
 * Required #6) — `--governed-by` IS validity-gated now, but NOT by this file.
 * `CorpusService.listGovernedBy` used to return `DocSummary` rows (no `extra`), so neither
 * the exclusion nor the projection was computable here; it now returns FULL records
 * carrying `validity_status` and applies the exclusion ITSELF, behind an `include_invalid`
 * opt this branch forwards from `--include-invalid`.
 * ⛔ The gate deliberately lives in the SERVICE method, not here: `lore list` and MCP
 * `lore_list` are two consumers of one link traversal, and gating only this one would
 * leave the shared seam carrying the old behaviour. Do NOT "simplify" it back by applying
 * `selectLiveDocs` in this branch — that would make the exclusion run twice on the CLI
 * path and zero times on the MCP path if the service call were ever reverted.
 *
 * ## ⛔ ONE `--json` row contract across all SIX emit branches
 * (spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by, AC-MOS-1/AC-MOS-2)
 *
 * This command has SIX `--json` emit sites — `--governed-by`, `--phase`, `--type task`,
 * `--include-invalid`, `--plan-id`, and the default fall-through. FIVE of them print
 * gated FULL records; only the default prints the store's summary. Until 2026-08-25 the
 * five printed those records VERBATIM, so one command answered `--json` with two row
 * contracts (18 keys with `content`/`extra` and no `meta`, vs. the default's ten).
 * Every one of them now emits `ListJsonRow` via `toListJsonRows` — see that function's
 * header for the measurement, the live consumer it broke, and what must not be
 * "optimised" in response. ⛔ A NEW `--json` branch that prints its fetched rows
 * directly re-splits the contract; route it through `toListJsonRows` like the rest.
 */

import { defineCommand } from "citty";
import { setExitCode } from "../run-scope.js";
import { loadLoreApp } from "../loader.js";
import {
  exitCode,
  formatErrorFor,
  formatTable,
  formatValidityBadge,
  formatWorkflowBadge,
  parsePositiveIntArg,
  relativeTime,
} from "../utils.js";
import { LIST_GOVERNED_BY_CONFLICT } from "../cli-refusal-messages.js";
import { isPlanMember } from "../../../service/plan-membership.js";
import { resolveSubTypeFilter } from "../../../service/corpus-service.js";
import {
  selectLiveDocs,
  withPreGatedLiveStatus,
  withValidityStatus,
  type WithValidityStatus,
} from "../../../service/validity-service.js";
import { deriveTypeMeta, KNOWLEDGE_SUB_TYPES, ok } from "@lore/core";
import type { DocRecord, DocSummary, DocType, DocStatus, LoreError, Result } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/** A full corpus row as this command FETCHES it — every full record carries its
 *  evaluated validity verdict (SPEC-043 D3's data half; see this file's header).
 *  ⛔ NOT the `--json` emit shape: that is {@link ListJsonRow}, which this projects
 *  down to at the emit site (see {@link toListJsonRows}). */
type ListedDoc = WithValidityStatus<DocRecord>;

/**
 * THE `lore list --json` ROW CONTRACT — the ONE shape every `--json` emit branch of
 * this command prints, whatever fetch shape produced it.
 *
 * A CLOSED set of ten keys: `id slug type title status priority tags updated_at
 * validity_status meta` — `DocSummary`'s nine plus the `validity_status` stamp this
 * command adds. Typed as `WithValidityStatus<DocSummary>` rather than spelled out so
 * a NEW REQUIRED field on `DocSummary` breaks {@link toListJsonRows} at `tsc` instead
 * of silently splitting the contract again.
 *
 * ⛔ `meta` is OPTIONAL and is absent exactly when `deriveTypeMeta` cannot derive one
 * (`prd`, whose type has no variant; or a legacy/corrupt `extra`). That absence is the
 * documented degrade-by-omission invariant of `doc-type-meta.ts`, and it holds on EVERY
 * branch identically — a `prd` row is a nine-key row here and a nine-key row on the
 * default branch. ⛔ Do NOT "fix" it to `meta: null` to force ten keys: that fabricates
 * a value the derivation deliberately refused.
 */
type ListJsonRow = WithValidityStatus<DocSummary>;

/**
 * Projects the FULL records the wide branches fetch down to {@link ListJsonRow}.
 *
 * ## Why this exists (spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by,
 * AC-MOS-1 / AC-MOS-2)
 *
 * Five of this command's six `--json` emit branches used to print their fetched rows
 * VERBATIM. Three fetch shapes met three emit sites, so one command answered `--json`
 * with two different row contracts: the default branch's ten-key summary, and an
 * 18-key full `DocRecord` carrying `content` and `extra`. MEASURED 2026-08-25 @
 * 3331a98e: `lore list --type knowledge --json` = 313,281 bytes / 10 keys, while
 * `--include-invalid` on the same corpus = 23,180,068 bytes / 18 keys and NO `meta`.
 * The live consumer `scripts/tests/spec-mirror-export.test.ts` reads `{id, slug}` and
 * declares `maxBuffer: 20 * 1024 * 1024`; the wide payload crossed it, and `spawnSync`
 * reports that as `status: null` + `error.code: "ENOBUFS"` — never a nonzero exit —
 * so the consumer read it as "the command exited 1" with empty stderr.
 * Full diagnosis: `knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in`
 * (its ENOBUFS half; its timeout half is superseded by that doc's own child).
 *
 * ⛔ The FETCH is NOT the defect and must not be "optimised" into a `list()` summary
 * call. Those branches need full records because the validity gate and the
 * `--plan-id` / `--phase` narrowing all read `extra`, which `DocSummary` does not
 * carry — see `fetchGatedFullDocs`'s own header for why one fetch shape across all
 * branches is what keeps the exclusion from being skipped on one of them again.
 * The projection belongs HERE, at the emit site, and nowhere earlier.
 *
 * ⛔ `meta` comes from `deriveTypeMeta` (`@lore/core`, SPEC-036 §2 D3's single
 * derivation point) — never hand-rolled here. Dropping `meta` instead would also make
 * the key sets match and is the cheap wrong answer AC-MOS-1(b) exists to refuse.
 *
 * ## Known duplication, deliberately not collapsed
 * `CorpusService.toSummary` (`service/corpus-service.ts`) builds the same eight scalar
 * fields and is documented there as this repo's sole `DocSummary` projection site. It
 * is `private`, and `corpus-service.ts` is outside this change's declared file anchors,
 * so it cannot be reused from here today. The `WithValidityStatus<DocSummary>` return
 * type is the mechanism standing in for that reuse: it makes `tsc` — not a reader —
 * responsible for catching a required-field divergence. ⛔ An OPTIONAL new field on
 * `DocSummary` still slips past it; collapsing both sites onto one exported projector
 * is the standing fix.
 *
 * Side-effect class: pure, EXCEPT the `Date.now()` read `deriveTypeMeta` performs to
 * compute `task.claim_stale` when `claimTtlMinutes` is supplied (its own documented,
 * narrow deviation).
 *
 * @param docs - Gated full records, already validity-stamped by `fetchGatedFullDocs`
 *   (or by `CorpusService.listGovernedBy`, which applies its own gate)
 * @param claimTtlMinutes - Task claim lease TTL forwarded verbatim to `deriveTypeMeta`
 *   so `task.claim_stale` is computed against the SAME resolved config value
 *   `CorpusService` uses for the default branch's `meta`. Both come from `app.ts`'s
 *   single `resolveClaimTtlMinutes(config)` — passing a different one here would make
 *   two branches disagree about staleness on the same doc.
 * @returns One {@link ListJsonRow} per input, in input order
 */
function toListJsonRows(docs: readonly ListedDoc[], claimTtlMinutes: number): ListJsonRow[] {
  return docs.map((doc) => {
    const meta = deriveTypeMeta(doc, { claimTtlMinutes });
    return {
      id: doc.id,
      slug: doc.slug,
      type: doc.type,
      title: doc.title,
      status: doc.status,
      updated_at: doc.updated_at,
      tags: doc.tags,
      priority: doc.priority,
      // reason: present-iff-derivable, mirroring `CorpusService.toSummary` exactly —
      // `...(meta !== undefined ? { meta } : {})`, never `meta: meta ?? null`. See
      // ListJsonRow's own note on why a fabricated null is the wrong repair.
      ...(meta !== undefined ? { meta } : {}),
      validity_status: doc.validity_status,
    };
  });
}

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
    "sub-type": {
      type: "string",
      // reason: the value list is INTERPOLATED from KNOWLEDGE_SUB_TYPES, never
      // retyped — a tenth sub-type must show up in --help without an edit here.
      description:
        `[requires --type knowledge] Filter knowledge docs by extra.sub_type: ${KNOWLEDGE_SUB_TYPES.join(" | ")}. ` +
        "Applied as a STORE-LEVEL predicate, so --limit/--offset page the FILTERED set. Any other --type " +
        "(or none) is a usage error, never a silently empty result. " +
        "Source: spec-a-write-side-fact-with-no-read-side-address-counts-with-no M3.",
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
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      // reason: ONE wall-clock read for the whole command — every validity verdict,
      // badge and `checked_at` stamp below must agree on the same instant, and the
      // pre-fix code took a fresh `new Date().toISOString()` per branch. A
      // bi-temporal verdict evaluated at two different "now"s inside one listing is
      // not reproducible from its own output.
      const nowIso = new Date().toISOString();
      // reason: ONE read of the resolved claim TTL for the whole command, for the same
      // reason `nowIso` is read once — it feeds BOTH the human workflow badge and the
      // `--json` row's `meta.claim_stale` (via `toListJsonRows`), and those two must
      // not be able to disagree about the same doc within one listing.
      const claimTtlMinutes = app.taskWorkflowService.claimTtlMinutes;
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
          inv.io.stderr.write(limitResult.message + "\n");
          setExitCode(2);
          return;
        }
        limit = limitResult.value;
      }

      let offset: number | undefined;
      if (args.offset !== undefined) {
        const offsetResult = parsePositiveIntArg(args.offset, "--offset", { min: 0 });
        if (!offsetResult.ok) {
          inv.io.stderr.write(offsetResult.message + "\n");
          setExitCode(2);
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
      const includeInvalid = args["include-invalid"] === true;

      // reason: the Validity column exists ONLY under --include-invalid — the one
      // mode where a retracted row can appear at all. Its purpose is AC-4's
      // "presence never reads as validity": the row is in the table because the
      // caller asked for retracted docs, and this cell is the independent fact
      // saying which ones they are. `superseded_by`'s ULID prefix is carried
      // because "what do I read instead" is the next question, and `resolveDoc`
      // accepts a unique short prefix verbatim.
      // ⛔ Declared HERE, above the --governed-by short-circuit, so that branch renders
      // the SAME badge and the SAME cell as every other full-record branch — before
      // Required #6 it rendered neither, which under --include-invalid meant a retracted
      // row appeared in the table with no marker at all.
      const validityHeaders = (): string[] => (includeInvalid ? ["Validity"] : []);
      const validityCells = (d: ListedDoc): string[] => {
        if (!includeInvalid) return [];
        if (!d.validity_status.invalidated) return ["valid"];
        const successor = d.validity_status.superseded_by;
        return [successor !== undefined ? `invalid→${successor.slice(0, 10)}` : "invalid"];
      };

      // --governed-by is a link-table reverse query (skill --governs--> artifact),
      // not a StoreFilters column predicate — it short-circuits to its own dedicated
      // service method (CorpusService.listGovernedBy) rather than joining the
      // filters object below. Source: IoC vertical-slice tech-spec §4.1 P4.
      if (args["governed-by"] !== undefined) {
        // Fail loud instead of silently dropping the other filters: --governed-by
        // short-circuits to listGovernedBy above and never reaches the filters
        // block below, so any other filter flag passed alongside it would
        // otherwise be silently ignored. Source: no-silent-fallback project norm.
        const otherFilterKeys = ["type", "status", "author", "since", "tag", "plan-id", "phase", "sub-type"] as const;
        const conflicting = otherFilterKeys.filter((k) => args[k] !== undefined);
        if (conflicting.length > 0) {
          inv.io.stderr.write(
            `Error: ${LIST_GOVERNED_BY_CONFLICT} ${conflicting.map((k) => `--${k}`).join(", ")}.\n`,
          );
          setExitCode(2);
          return;
        }

        // reason: `include_invalid` is FORWARDED, never applied here — the service method
        // owns the exclusion so MCP `lore_list --governed-by` inherits it (Required #6).
        // ⛔ Forwarding it is what keeps `--include-invalid` from being SILENTLY INERT on
        // this branch, which is this repo's named fifth false-oracle vector.
        const governedResult = await app.corpusService.listGovernedBy(args["governed-by"], {
          include_invalid: includeInvalid,
        });
        if (!governedResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, governedResult.error) + "\n");
          setExitCode(exitCode(governedResult.error));
          return;
        }
        // reason: listGovernedBy has no store-level limit/offset param — page the
        // already-fetched result in-memory (see header comment's (b) stance).
        const docs = pageInMemory(governedResult.value.docs);
        const total = docs.length;

        if (args.json) {
          printLine(inv.io.stdout, 
            JSON.stringify({ ok: true, data: { docs: toListJsonRows(docs, claimTtlMinutes), total } }, null, 2),
          );
          return;
        }
        if (total === 0) {
          printLine(inv.io.stdout, `No documents governed by "${args["governed-by"]}".`);
          return;
        }
        const headers = ["ID", "Type", "Title", "Status", ...validityHeaders(), "Updated"];
        const rows = docs.map((d) => [
          d.id.slice(0, 10),
          d.type,
          `${d.title.slice(0, 35)}${formatValidityBadge(d, nowIso)}`,
          d.status,
          ...validityCells(d),
          relativeTime(d.updated_at),
        ]);
        printLine(inv.io.stdout, formatTable(headers, rows));
        printLine(inv.io.stdout, `\n${total} document${total === 1 ? "" : "s"} (filter: --governed-by ${args["governed-by"]})`);
        return;
      }

      // reason: resolved AFTER the --governed-by short-circuit above (which owns
      // its own exclusivity refusal, and now names --sub-type among the flags it
      // forbids) so each shape gets the message that actually explains it. The
      // rule itself lives in ONE place shared with `lore search` and both MCP
      // read tools — see resolveSubTypeFilter's JSDoc for why it must not be
      // re-derived here. Exit 2 = CLI usage error (utils.ts::exitCode).
      const subTypeResolution = resolveSubTypeFilter(args["sub-type"], args.type);
      if (!subTypeResolution.ok) {
        inv.io.stderr.write(subTypeResolution.message + "\n");
        setExitCode(2);
        return;
      }

      const filters: Record<string, unknown> = {};
      if (args.type !== undefined) filters["type"] = args.type as DocType;
      if (subTypeResolution.sub_type !== undefined) filters["sub_type"] = subTypeResolution.sub_type;
      if (args.status !== undefined) filters["status"] = args.status as DocStatus;
      if (args.author !== undefined) filters["created_by"] = args.author;
      if (args.since !== undefined) filters["since"] = args.since;
      if (args.tag !== undefined) filters["tags"] = [args.tag];
      // reason: `includeInvalid` itself is declared ABOVE the --governed-by short-circuit
      // (see its comment there) so that branch shares the same validity renderers.
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
          inv.io.stderr.write(formatErrorFor(inv, resolveResult.error) + "\n");
          setExitCode(exitCode(resolveResult.error));
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

      // reason: THE single validity gate for every full-record branch (see this
      // file's header). Order is load-bearing and must stay: fetch UNPAGED →
      // exclude invalidated unless --include-invalid → attach the explicit
      // `validity_status`. Paging is deliberately NOT applied here — each caller
      // narrows further (plan membership, extra.phase) and pages LAST, because a
      // page taken before a narrowing filter is a short or misaligned page.
      // ⛔ Do not "optimise" this back into `listFull(withPaging(filters))` when
      // --include-invalid is set: one fetch shape for all four branches is what
      // keeps the exclusion from being silently skipped on one of them again.
      // F4 (AC-CRIT-6): rows the validity filter removed, counted at that one step.
      let omittedInvalid = 0;
      const hiddenNote = (): string =>
        omittedInvalid > 0 ? ` (+${omittedInvalid} invalidated hidden; --include-invalid)` : "";
      async function fetchGatedFullDocs(): Promise<Result<ListedDoc[], LoreError>> {
        const fullResult = await app.corpusService.listFull(filters);
        if (!fullResult.ok) return fullResult;
        const live = includeInvalid ? fullResult.value.docs : selectLiveDocs(fullResult.value.docs, nowIso);
        omittedInvalid = fullResult.value.docs.length - live.length;
        return ok(withValidityStatus(live, nowIso));
      }

      /** Gated full records, narrowed by plan membership and paged — the shape the
       *  --type task / --include-invalid / --plan-id branches all render. */
      async function fetchListing(): Promise<Result<{ docs: ListedDoc[]; total: number }, LoreError>> {
        const gatedResult = await fetchGatedFullDocs();
        if (!gatedResult.ok) return gatedResult;
        const narrowed = pageInMemory(gatedResult.value.filter((doc) => passesPlanMembership(doc)));
        return ok({ docs: narrowed, total: narrowed.length });
      }

      // When --phase filter is active, we need full DocRecord rows (extra.phase is not in DocSummary).
      // reason: StoreFilters has no extra-field index; client-side filter is applied after fetch.
      // Source: SPEC-023 §4 AC-PHASE-7
      const phaseFilter = args.phase;
      if (phaseFilter !== undefined) {
        const gatedResult = await fetchGatedFullDocs();
        if (!gatedResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, gatedResult.error) + "\n");
          setExitCode(exitCode(gatedResult.error));
          return;
        }
        // reason: extra.phase AND --plan-id's membership filter (see file header) are
        // both client-side, as is the validity exclusion already applied above —
        // paging must apply AFTER all of them, never before (header (b) stance).
        const filtered = pageInMemory(
          gatedResult.value.filter(
            (doc) => doc.extra["phase"] === phaseFilter && passesPlanMembership(doc),
          ),
        );
        const total = filtered.length;

        if (args.json) {
          printLine(inv.io.stdout, 
            JSON.stringify({ ok: true, data: { docs: toListJsonRows(filtered, claimTtlMinutes), total, omitted_invalid: omittedInvalid } }, null, 2),
          );
          return;
        }
        if (total === 0) {
          printLine(inv.io.stdout, `No documents found with phase "${phaseFilter}".`);
          return;
        }
        // reason: workflow badge (claim/evidence, AC-WF-9) is only meaningful for task
        // rows; --phase filtering only applies to tasks in practice (SPEC-023), so we
        // always compute it here rather than branching on d.type.
        const ttlMinutes = claimTtlMinutes;
        const headers = ["ID", "Type", "Title", "Status", ...validityHeaders(), "Phase", "Updated"];
        const rows = filtered.map((d) => [
          d.id.slice(0, 10),
          d.type,
          `${d.title.slice(0, 30)}${formatValidityBadge(d, nowIso)}${formatWorkflowBadge(d, nowIso, ttlMinutes)}`,
          d.status,
          ...validityCells(d),
          String(d.extra["phase"] ?? ""),
          relativeTime(d.updated_at),
        ]);
        printLine(inv.io.stdout, formatTable(headers, rows));
        printLine(inv.io.stdout, `\n${total} document${total === 1 ? "" : "s"} (filter: --phase ${phaseFilter}${planFilterDesc()})${hiddenNote()}`);
        return;
      }

      // Task-type listings render a claim/evidence workflow badge on each row
      // (AC-WF-9). This requires the full DocRecord (extra.claim / extra.verification_evidence
      // are not in DocSummary) — mirrors the --phase branch's listFull usage above.
      if (filters["type"] === "task") {
        const fullResult = await fetchListing();
        if (!fullResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, fullResult.error) + "\n");
          setExitCode(exitCode(fullResult.error));
          return;
        }
        const { docs: fullDocs, total: fullTotal } = fullResult.value;

        if (args.json) {
          printLine(inv.io.stdout, 
            JSON.stringify(
              { ok: true, data: { docs: toListJsonRows(fullDocs, claimTtlMinutes), total: fullTotal, omitted_invalid: omittedInvalid } },
              null,
              2,
            ),
          );
          return;
        }
        if (fullTotal === 0) {
          printLine(inv.io.stdout, "No documents found.");
          return;
        }

        const ttlMinutes = claimTtlMinutes;
        const headers = ["ID", "Type", "Title", "Status", ...validityHeaders(), "Updated"];
        // reason: the validity badge is rendered UNCONDITIONALLY, not only under
        // --include-invalid. Pre-fix, this branch rendered the workflow badge alone,
        // so a retracted task that leaked past the (then-missing) exclusion looked
        // exactly like live work. Keeping the badge here means a future exclusion
        // regression shows up as a visible `[invalid]` row instead of silence.
        const rows = fullDocs.map((d) => [
          d.id.slice(0, 10),
          d.type,
          `${d.title.slice(0, 35)}${formatValidityBadge(d, nowIso)}${formatWorkflowBadge(d, nowIso, ttlMinutes)}`,
          d.status,
          ...validityCells(d),
          relativeTime(d.updated_at),
        ]);
        printLine(inv.io.stdout, formatTable(headers, rows));
        const taskFilterDesc = includeInvalid ? " --include-invalid" : "";
        printLine(inv.io.stdout, 
          `\n${fullTotal} document${fullTotal === 1 ? "" : "s"} ` +
            `(filter: --type task${planFilterDesc()}${taskFilterDesc})${hiddenNote()}`,
        );
        return;
      }

      // reason: DocSummary (list()'s return shape) carries no validity signal — when
      // --include-invalid is passed we need full DocRecords to compute the [invalid]
      // badge AND the `validity_status` payload, mirroring the --phase/--type task
      // branches' gated fetch above. Source: SPEC-043 D3/D4.
      if (includeInvalid) {
        const fullResult = await fetchListing();
        if (!fullResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, fullResult.error) + "\n");
          setExitCode(exitCode(fullResult.error));
          return;
        }
        const { docs: fullDocs, total: fullTotal } = fullResult.value;

        if (args.json) {
          printLine(inv.io.stdout, 
            JSON.stringify(
              { ok: true, data: { docs: toListJsonRows(fullDocs, claimTtlMinutes), total: fullTotal, omitted_invalid: omittedInvalid } },
              null,
              2,
            ),
          );
          return;
        }
        if (fullTotal === 0) {
          printLine(inv.io.stdout, "No documents found.");
          return;
        }

        const headers = ["ID", "Type", "Title", "Status", ...validityHeaders(), "Updated"];
        const rows = fullDocs.map((d) => [
          d.id.slice(0, 10),
          d.type,
          `${d.title.slice(0, 35)}${formatValidityBadge(d, nowIso)}`,
          d.status,
          ...validityCells(d),
          relativeTime(d.updated_at),
        ]);
        printLine(inv.io.stdout, formatTable(headers, rows));
        printLine(inv.io.stdout, 
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
        const fullResult = await fetchListing();
        if (!fullResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, fullResult.error) + "\n");
          setExitCode(exitCode(fullResult.error));
          return;
        }
        const { docs: fullDocs, total: fullTotal } = fullResult.value;

        if (args.json) {
          printLine(inv.io.stdout, 
            JSON.stringify(
              { ok: true, data: { docs: toListJsonRows(fullDocs, claimTtlMinutes), total: fullTotal, omitted_invalid: omittedInvalid } },
              null,
              2,
            ),
          );
          return;
        }
        if (fullTotal === 0) {
          printLine(inv.io.stdout, `No documents found with plan membership "${args["plan-id"]}".`);
          return;
        }

        const headers = ["ID", "Type", "Title", "Status", ...validityHeaders(), "Updated"];
        const rows = fullDocs.map((d) => [
          d.id.slice(0, 10),
          d.type,
          `${d.title.slice(0, 35)}${formatValidityBadge(d, nowIso)}`,
          d.status,
          ...validityCells(d),
          relativeTime(d.updated_at),
        ]);
        printLine(inv.io.stdout, formatTable(headers, rows));
        const otherFilterDesc = Object.entries(filters)
          .map(([k, v]) => `--${k} ${Array.isArray(v) ? v.join(",") : String(v)}`)
          .join(" ");
        printLine(inv.io.stdout, 
          `\n${fullTotal} document${fullTotal === 1 ? "" : "s"} (filter:${planFilterDesc()}` +
            `${otherFilterDesc ? ` ${otherFilterDesc}` : ""})${hiddenNote()}`,
        );
        return;
      }

      // reason: the `now` seam is injected (rather than left to `list()`'s internal
      // default) so this command KNOWS the instant the D3 exclusion was evaluated at
      // — that is what makes the `validity_status` stamp below an entailment of the
      // query contract instead of an assumption. `includeInvalid` is false on every
      // path that reaches here (it short-circuits into the gated branch above), so
      // `list()` is guaranteed to have applied `!isInvalidated(doc, nowIso)` to every
      // returned row.
      const result = await app.corpusService.list(withPaging(filters), () => nowIso);

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        setExitCode(exitCode(result.error));
        return;
      }

      const { docs, total, omitted_invalid: omittedInvalidDefault } = result.value;

      if (args.json) {
        // reason: DocSummary has no `extra`, so validity is NOT re-derivable from
        // these rows — `withValidityStatus` would report every one of them as live on
        // absent-metadata grounds even if the exclusion above had regressed. The
        // pre-gated stamp names that dependency at the call site instead; see
        // `withPreGatedLiveStatus`'s JSDoc for the contract it rests on.
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { docs: withPreGatedLiveStatus(docs), total, omitted_invalid: omittedInvalidDefault } }, null, 2));
        return;
      }

      if (total === 0) {
        printLine(inv.io.stdout, "No documents found.");
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

      printLine(inv.io.stdout, formatTable(headers, rows));

      // reason: this echo is keyed on the STORE filter names, not the CLI flag
      // spellings, so `--author` renders as `--created_by`, `--tag` as `--tags`
      // and `--sub-type` as `--sub_type`. Pre-existing and deliberately left
      // alone here: normalising it would change `lore list`'s human output for
      // flags this change does not otherwise touch. Nothing in the suite asserts
      // on these strings (checked), and no oracle depends on them.
      const filterDesc = Object.entries(filters)
        .map(([k, v]) => `--${k} ${Array.isArray(v) ? v.join(",") : String(v)}`)
        .join(" ");
      const defaultHiddenNote =
        omittedInvalidDefault > 0 ? ` (+${omittedInvalidDefault} invalidated hidden; --include-invalid)` : "";
      printLine(inv.io.stdout, 
        `\n${total} document${total === 1 ? "" : "s"}${filterDesc ? ` (filter: ${filterDesc})` : ""}${defaultHiddenNote}`,
      );
    } finally {
      app.close();
    }
  },
});
