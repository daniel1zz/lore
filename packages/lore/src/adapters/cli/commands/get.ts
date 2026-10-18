/**
 * lore get <id-or-slug> — display a document with navigation footer.
 *
 * MDX placeholder splicing (SPEC-032 §3.3): unless --raw, this command calls
 * OutlineService.resolve(doc) itself (kept for `resolved_components` on the JSON
 * path) — the same adapter-level thin-pipe pattern already used by the HTTP
 * (`?resolveMdx=true`) and MCP (`lore_get`) surfaces. CorpusService.get() does NOT
 * perform this resolution (see its GetOpts.resolve_mdx JSDoc) — services never
 * cross-import, so the splice must happen here, not inside CorpusService.
 *
 * Invalidation banner (SPEC-043 D4): the displayed body itself is produced by
 * `renderDocBodyWithoutLossNotice` (`../../../flows/feed-flow.js`) — the SAME shared
 * render pass `lore feed`'s pack uses — rather than a second `renderResolvedToMarkdown`
 * call here, so the banner format (and its wiring) can never drift between the two
 * sites. `--raw` skips this branch entirely — raw output is always the stored
 * bytes, banner never included (REGRESSION).
 *
 * Non-whitelisted component warnings (spec-prd-as-living-root §4, audit T2): the
 * SAME `resolveResult` already fetched for `resolved_components` also carries
 * `warnings` (unknown-component-stripped notices) — printed to stderr here, one line
 * per warning, in addition to the JSON path's existing `resolved_components` array.
 * Human-readable AND `--json` output both get this stderr surface (the JSON body
 * itself is unchanged — warnings are a diagnostic side-channel, not response data).
 * `--raw` skips this entirely (no resolution attempted, REGRESSION).
 *
 * Structured-`extra` loss notice
 * (task-lore-get-s-default-render-silently-omits-structured-extra): this render is a
 * PROJECTION of the record, and until now a lossy one with no loss marker — `content`
 * + Navigation printed, every structured `extra` value (`issue_report`'s
 * `expected`/`actual`/`repro_command`, `file_anchors`, `verification_evidence`, …)
 * dropped with NOTHING indicating a field was withheld, so a doc with no `extra` was
 * indistinguishable from a doc whose `extra` was not shown. `formatStructuredExtraNotice`
 * (`../get-render.js`) now announces every withheld field's key, shape and child key
 * NAMES plus the exact `--json` command that shows the values. Design fork: Option B
 * (announce the loss) over Option A (render the values) — full reasoning in that
 * module's header; it is key-agnostic, so a future `extra` key needs no edit here.
 * ⛔ Three placement rules, each pinned by a test in
 * `tests/unit/adapters/get-structured-extra-notice.test.ts`:
 *   1. AFTER the `args.json` early return — so the `--json` payload gains no byte
 *      (REGRESSION), the notice being a human-view affordance only.
 *   2. NOT gated on `args.raw` — a `--raw` reader is equally blind, and under `--raw`
 *      MORE is withheld (no banner, no MDX projections), which is why the exclusion set
 *      is computed from the resolution facts rather than a static key list.
 *   3. BEFORE `formatNavigation` — the notice is about the body just printed, so it sits
 *      adjacent to it, and Navigation stays the footer.
 *
 * ⛔ WHY THIS COMMAND WELDS THE NOTICE ITSELF, off the announcing seam
 * (task-the-shared-renderdocmarkdown-seam-still-drops-structured): the loss notice now
 * lives ON the shared seam (`flows/feed-flow.ts::renderDocMarkdown`), so `lore feed` and
 * a `lore gate` DENIAL pack inherit it and a future fourth consumer inherits it with no
 * edit. This command deliberately calls the seam's NON-announcing entry point and welds
 * the notice via the SAME `../get-render.js` joiner, because two of its concerns cannot
 * be served from inside the seam:
 *   a. `(no content)` must be substituted for an empty body BEFORE the notice is welded,
 *      or an empty-bodied doc carrying structured `extra` would lose the placeholder;
 *   b. `--raw` never enters the resolved branch at all, yet must still announce.
 * Calling `renderDocMarkdown` here instead would print the notice TWICE. A wiring
 * REGRESSION test asserts this file contains no `renderDocMarkdown(` call at all.
 *
 * Machine-readable validity (task-validity-landed-on-lore-list-only-the-dispatch-surface,
 * Required #4): the `--json` payload carries a top-level `validity_status` — the SAME key
 * `lore list --json` records carry, from the SAME SSOT projection
 * (`../../../service/validity-service.js`). Before this, a `--json` consumer of `lore get`
 * had to parse the rendered banner out of `data.doc.content`'s neighbourhood, or re-derive
 * validity from `extra` itself.
 * ⛔ TWO placement rules, deliberately the mirror image of the loss notice's:
 *   1. The DEFAULT HUMAN render is UNCHANGED — not one byte. SPEC-043's asymmetry (list
 *      hides, direct address SHOWS) is deliberate and already satisfied for humans by
 *      `renderDocMarkdown`'s banner; this key is purely the machine half. A test asserts
 *      the human stdout never contains the literal `validity_status`.
 *   2. It is stamped INSIDE the `args.json` branch, on the payload — never gated on
 *      `--raw`, which only controls MDX/banner projection of the BODY and has nothing to
 *      say about whether a machine may know the doc is retracted.
 */

import { defineCommand } from "citty";
import { ok, ruleIdPrefixOfNode } from "@lore/core";
import type { DocRecord, LoreError, Result } from "@lore/core";
import {
  computeImplementedBy,
  computeImplements,
  formatImplementedByLines,
  formatImplementsLines,
} from "../../../service/spec-relations.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, formatNavigation, formatShortId } from "../utils.js";
import { projectValidityStatus } from "../../../service/validity-service.js";
import type { ResolvedComponent } from "../../../service/outline-service.js";
import { renderDocBodyWithoutLossNotice } from "../../../flows/feed-flow.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import {
  UNATTESTED,
  formatAttributionLabels,
  loadVersionAttributions,
  type WriteAttribution,
} from "../../../service/attribution-report.js";
import { composeWithStructuredExtraNotice, type RenderedBodyFacts } from "../get-render.js";
import type { LockState } from "@lore/core";
import type { StoreInterface } from "../../../store/store-interface.js";
import { invocationOf } from "../command-invocation.js";

/**
 * BR-1008 relation view for `doc`: `implements` for a spec, `implemented_by` for a baseline node
 * carrying rules; any other doc yields nothing (no `--json` key, no human section). Reads through
 * `corpusService.listFull` — no new service wiring.
 */
async function loadSpecRelations(
  app: ReturnType<typeof loadLoreApp>["app"],
  doc: DocRecord,
): Promise<Result<{ json: Record<string, unknown>; lines: string[] }, LoreError>> {
  if (doc.type === "spec") {
    const baseline = await app.corpusService.listFull({ type: "baseline" });
    if (!baseline.ok) return baseline;
    const view = computeImplements(doc, baseline.value.docs);
    return ok({ json: { implements: view }, lines: formatImplementsLines(view) });
  }
  if (doc.type === "baseline" && ruleIdPrefixOfNode(doc.extra) !== undefined) {
    const specs = await app.corpusService.listFull({ type: "spec" });
    if (!specs.ok) return specs;
    const view = computeImplementedBy(doc, specs.value.docs);
    return ok({ json: { implemented_by: view }, lines: formatImplementedByLines(view) });
  }
  return ok({ json: {}, lines: [] });
}

/** Link types through which a newer document changes the meaning of an older one (read-time `Later changed by`). */
const LATER_CHANGE_LINK_TYPES: ReadonlySet<string> = new Set(["relates-to", "supersedes", "implements"]);

/** One newer document pointing INTO the displayed one. */
interface LaterChange {
  readonly slug: string;
  readonly linkType: string;
}

/** `Standing:` line (spec documents-are-living-or-records D7): living, or record with its lock verdict. */
function formatStandingLine(lock: LockState): string {
  if (lock.standing === "living") return "Standing: living";
  return lock.locked ? `Standing: record · locked (${lock.reason})` : "Standing: record · not locked";
}

/**
 * Number of correction versions of `doc`: audit `update` rows whose `details.correction` is present.
 * Structural marker written by `CorpusService.set` on a correction (not the `Correction:` change_summary prefix).
 */
async function countCorrections(store: StoreInterface, docId: DocRecord["id"]): Promise<Result<number, LoreError>> {
  const rows = await store.queryAudit({ doc_id: docId, action: "update" });
  if (!rows.ok) return rows;
  const count = rows.value.filter((row) => {
    const details = row.details as Record<string, unknown> | undefined;
    return details?.["correction"] !== undefined;
  }).length;
  return ok(count);
}

/**
 * Newer, live documents linked INTO `doc` by relates-to / supersedes / implements, derived at read time
 * (nothing is stored on the older document), oldest first.
 */
async function loadLaterChanges(store: StoreInterface, doc: DocRecord): Promise<Result<LaterChange[], LoreError>> {
  const links = await store.findLinks(doc.id, "in");
  if (!links.ok) return links;
  const out: Array<LaterChange & { createdAt: string }> = [];
  for (const link of links.value) {
    if (!LATER_CHANGE_LINK_TYPES.has(link.link_type)) continue;
    const from = await store.find(link.from_id);
    if (!from.ok) return from;
    if (from.value === null || (from.value.deleted_at ?? null) !== null) continue;
    if (from.value.created_at <= doc.created_at) continue;
    out.push({ slug: from.value.slug, linkType: link.link_type, createdAt: from.value.created_at });
  }
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.slug.localeCompare(b.slug));
  return ok(out.map(({ slug, linkType }) => ({ slug, linkType })));
}

export default defineCommand({
  meta: {
    name: "get",
    description: "Get a document by ID or slug",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID or slug",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    raw: {
      type: "boolean",
      description: "Skip MDX resolution",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app, dbPath } = loadLoreApp({ inv });
    // reason: `App` does not expose its store; the attribution read (BR-1037) is a read-only projection over the
    // same file — the second-handle pattern `lore status` already uses.
    const attributionStore = new SQLiteStore(dbPath);
    try {
      const result = await app.corpusService.get(args.id);

      if (!result.ok) {
        process.stderr.write(formatErrorFor(inv, result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const { doc, navigation } = result.value;

      // Splice MDX placeholders unless --raw. A resolution failure (store error)
      // degrades to the raw body rather than aborting `get` — the doc + navigation
      // are still valuable output even if placeholder data couldn't be fetched.
      let displayBody = doc.content;
      let resolvedComponents: ResolvedComponent[] | undefined;
      let acceptanceCriteriaProjected = false;
      let codeAnchorsProjected = false;
      if (!args.raw) {
        const resolveResult = await app.outlineService.resolve(doc);
        if (resolveResult.ok) {
          resolvedComponents = resolveResult.value.resolvedComponents;
          // The projection's OWN verdict on whether it appended its block (SPEC-038
          // `## Acceptance Criteria (structured)` / SPEC-045 `## Code anchors`) — the
          // loss notice must never re-derive it from `doc.type` + a second schema parse,
          // or the two would drift and the notice would claim a loss that did not happen.
          acceptanceCriteriaProjected = resolveResult.value.acceptanceCriteria !== undefined;
          codeAnchorsProjected = resolveResult.value.codeAnchors !== undefined;
          for (const warning of resolveResult.value.warnings) {
            process.stderr.write(`Warning: ${warning.message}\n`);
          }
        }
        // SPEC-043 D4 — banner-prefixed, MDX-spliced body from the SAME shared seam
        // `lore feed`'s pack uses (T2 wiring site 1/3) — never a second banner-format
        // implementation. --raw NEVER carries the banner (raw = stored bytes,
        // REGRESSION). ⛔ Deliberately the loss-notice-FREE entry point: this command
        // welds the notice itself a few lines below, so `(no content)` can sit between
        // the body and the notice and so `--raw` (which never reaches here) is covered
        // too. Calling the announcing `renderDocMarkdown` here would double-announce.
        displayBody = await renderDocBodyWithoutLossNotice(app, doc);
      }

      // BR-1037 — the LATEST write's attested run and claimed name (source included), from the SAME
      // projection `lore log` renders, so one write reads identically on both surfaces. A doc with no version
      // row has no attested write: it reads `unattested` with its stored author.
      const latest = await loadVersionAttributions(attributionStore, doc.id, 1);
      if (!latest.ok) {
        process.stderr.write(formatErrorFor(inv, latest.error) + "\n");
        process.exitCode = exitCode(latest.error);
        return;
      }
      const attribution: WriteAttribution = latest.value[0]?.attribution ?? { attested: UNATTESTED, claimed: doc.created_by };

      // BR-1008 — Implements (spec) / Implemented by (baseline node), computed from citations on demand.
      const relations = await loadSpecRelations(app, doc);
      if (!relations.ok) {
        process.stderr.write(formatErrorFor(inv, relations.error) + "\n");
        process.exitCode = exitCode(relations.error);
        return;
      }

      // Standing / Corrections / Later changed by — human view only (the --json payload is unchanged). Standing
      // comes from the ONE lock resolver the write gate uses; the other two are read-time derivations.
      let humanStanding: string[] = [];
      if (!args.json) {
        if (app.recordLockService === undefined) {
          process.stderr.write("Error: RecordLockService is not wired on App; cannot resolve Standing.\n");
          process.exitCode = 1;
          return;
        }
        const lock = await app.recordLockService.resolve(doc);
        const corrections = await countCorrections(attributionStore, doc.id);
        const later = await loadLaterChanges(attributionStore, doc);
        const failure = [lock, corrections, later].find((r) => !r.ok);
        if (failure !== undefined && !failure.ok) {
          process.stderr.write(formatErrorFor(inv, failure.error) + "\n");
          process.exitCode = exitCode(failure.error);
          return;
        }
        if (lock.ok && corrections.ok && later.ok) {
          humanStanding = [formatStandingLine(lock.value)];
          if (corrections.value > 0) humanStanding.push(`Corrections: ${corrections.value}`);
          if (later.value.length > 0) {
            humanStanding.push(`Later changed by (${later.value.length}):`);
            for (const change of later.value) humanStanding.push(`  ${change.slug} (${change.linkType})`);
          }
        }
      }

      if (args.json) {
        // reason: ONE wall-clock read, taken here rather than reused from a wider scope —
        // this is the only validity evaluation in this command, and `--raw` must not
        // change it (see placement rule 2 in this file's header).
        const validityStatus = projectValidityStatus(doc, new Date().toISOString());
        const data = resolvedComponents !== undefined
          ? { ...result.value, validity_status: validityStatus, attribution, ...relations.value.json, resolved_components: resolvedComponents }
          : { ...result.value, validity_status: validityStatus, attribution, ...relations.value.json };
        console.log(JSON.stringify({ ok: true, data }, null, 2));
        return;
      }

      // Human-readable display
      const divider = "─".repeat(60);
      console.log(`── ${formatShortId(doc.id)} ${doc.title} ${divider.slice(0, 40)}`);
      console.log(
        `Type: ${doc.type} | Status: ${doc.status} | Priority: ${doc.priority} | v${doc.version}`,
      );
      console.log(
        `Created: ${doc.created_at.slice(0, 10)} by ${doc.created_by} | Updated: ${doc.updated_at.slice(0, 10)}`,
      );
      console.log(`Last write: ${formatAttributionLabels(attribution)}`);
      for (const line of humanStanding) console.log(line);
      if (doc.tags.length > 0) {
        console.log(`Tags: ${doc.tags.join(", ")}`);
      }
      console.log("");
      // Loss notice (placement rules 1-3 in the module header): reached only on the human
      // path, never gated on --raw, welded directly onto the body it describes via the
      // SHARED joiner. `(no content)` is substituted BEFORE the weld, so an empty-bodied
      // doc carrying structured `extra` still prints the placeholder above the notice.
      const renderedBodyFacts: RenderedBodyFacts = {
        mdxResolved: !args.raw,
        acceptanceCriteriaProjected,
        codeAnchorsProjected,
        nowIso: new Date().toISOString(),
      };
      console.log(
        composeWithStructuredExtraNotice(displayBody || "(no content)", doc, renderedBodyFacts, "below-body"),
      );
      console.log("");
      if (relations.value.lines.length > 0) {
        console.log(relations.value.lines.join("\n"));
        console.log("");
      }
      console.log(formatNavigation(navigation));
    } finally {
      attributionStore.close();
      app.close();
    }
  },
});
