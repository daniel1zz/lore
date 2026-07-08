/**
 * lore gate — corpus-governed creation-time interception commands (IoC vertical-slice
 * tech-spec §4.1/§11). One "deterministic zone" gate per governed doc-creation flow;
 * `spec-create` is the first (a future `spec-promote` gate is expected to join this
 * command group, hence the group/subcommand shape rather than a flat `gate-spec-create`
 * command name).
 *
 * `lore gate spec-create --input-json '<json>'` runs the three pure predicates from
 * `../../../service/gate-predicates.js` against a CANDIDATE spec-creation payload
 * (never an already-created doc — this gate runs BEFORE `lore create` / `lore_create`,
 * as a pre-flight check an AI agent or CI hook shells out to) and either:
 *   - all three pass → prints "gate: pass", exit 0.
 *   - any fail → prints a `gate-feeding.js::renderFeedingPack` block (rule doc slice +
 *     parent doc slice + machine-readable `missing` reasons) to stdout, exit 4.
 *
 * `LORE_GATE_BYPASS=1` short-circuits to exit 0 before ANY parsing or checking — an
 * escape hatch for callers that must not be blocked (documented, not silent: every
 * invocation under bypass still goes through the CLI, so it is audit-log-visible at
 * the shell/process level even though this command itself performs no corpus writes).
 *
 * Exit codes:
 *   0 = all predicates passed, OR LORE_GATE_BYPASS=1
 *   2 = --input-json missing / malformed JSON / does not match the expected shape
 *       (CLI-usage error, not a `LoreError` — mirrors evidence.ts's mutually-exclusive-
 *       flags convention, not utils.ts::exitCode's LoreError-only mapping)
 *   4 = at least one gate predicate failed (VALIDATION_ERROR family, utils.ts::exitCode)
 *   1 = corpus read failure while resolving the parent doc or the rule doc (STORE_ERROR)
 *
 * Source: IoC vertical-slice tech-spec §4.1/§11 ("deterministic zone" + "active feeding")
 */

import { defineCommand } from "citty";
import { z } from "zod";
import { loadLoreApp } from "../loader.js";
import { renderResolvedToMarkdown } from "../../../service/outline-service.js";
import { parentLegal, specKindValid, hasSkeleton } from "../../../service/gate-predicates.js";
import { buildFeedingPack, renderFeedingPack } from "../../../service/gate-feeding.js";
import type { App } from "../../../app.js";
import type { DocRecord } from "@lore/core";

/**
 * Mirrors `scripts/seed-write-spec-rule.ts::WRITE_SPEC_RULE_TITLE` exactly.
 *
 * reason: cannot import it directly — `scripts/` lives outside this package's
 * `tsconfig.tests.json` `rootDir` (documented in that script's own test file,
 * `packages/lore/tests/unit/service/seed-write-spec-rule.bun.test.ts`), so a static
 * import here would fail `tsc --noEmit` with TS6059. If the seed title ever changes,
 * update both literals together.
 */
const WRITE_SPEC_RULE_TITLE = "Write-spec rules (gate feeding source)";

/** Fallback rule slice used when no approved doc titled `WRITE_SPEC_RULE_TITLE` exists yet. */
const RULE_DOC_MISSING_PLACEHOLDER =
  `(No approved rule doc found — run \`bun scripts/seed-write-spec-rule.ts\` to seed it. ` +
  `Expected: type=knowledge, status=approved, title="${WRITE_SPEC_RULE_TITLE}".)`;

/**
 * Candidate spec-creation payload, shaped after MCP `lore_create`'s input schema
 * (`../../mcp/tools.js::LoreCreateSchema`) but scoped to only the fields the three
 * gate predicates consume. `.passthrough()` so callers may pass the FULL `lore_create`
 * payload (e.g. `tags`, `ai`) without this schema rejecting the extra keys — this gate
 * only reads a subset, it does not re-validate the whole create contract (that is
 * `createDocInputSchema`'s job, at actual creation time).
 */
const gateSpecCreateInputSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    parent_id: z.string().optional(),
    content: z.string().optional(),
    extra: z.object({ spec_kind: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

type GateSpecCreateInput = z.infer<typeof gateSpecCreateInputSchema>;

export default defineCommand({
  meta: {
    name: "gate",
    description: "Corpus-governed creation-time interception gates (deterministic zone)",
  },
  subCommands: {
    "spec-create": defineCommand({
      meta: {
        name: "spec-create",
        description:
          "Deterministic pre-flight gate for spec creation: legal parent, valid spec_kind, required skeleton",
      },
      args: {
        "input-json": {
          type: "string",
          description:
            'JSON matching lore_create\'s input shape: {type, title, parent_id?, content, extra?: {spec_kind?}}',
          required: true,
        },
      },
      async run({ args }) {
        // LORE_GATE_BYPASS=1: exit 0 before ANY parsing or checking (module header).
        if (process.env["LORE_GATE_BYPASS"] === "1") {
          process.exitCode = 0;
          return;
        }

        const rawInputJson = args["input-json"];
        let candidate: unknown;
        try {
          candidate = JSON.parse(rawInputJson as string);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          process.stderr.write(`Error: --input-json is not valid JSON: ${message}\n`);
          process.exitCode = 2;
          return;
        }

        const parsed = gateSpecCreateInputSchema.safeParse(candidate);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          process.stderr.write(
            `Error: --input-json does not match the expected shape: ${issue?.message ?? "invalid input"}\n`,
          );
          process.exitCode = 2;
          return;
        }

        const { app } = loadLoreApp();
        try {
          await runSpecCreateGate(app, parsed.data);
        } finally {
          app.close();
        }
      },
    }),
  },
});

/**
 * Runs the three `gate-predicates.js` checks against `input`, printing either a pass
 * marker (exit 0) or a `renderFeedingPack` violation block (exit 4) to stdout.
 *
 * @param app - Wired `App` (from `loadLoreApp()`), used to resolve the candidate's
 *   parent doc and the approved rule doc — read-only, no corpus writes.
 * @param input - Validated candidate spec-creation payload.
 */
async function runSpecCreateGate(app: App, input: GateSpecCreateInput): Promise<void> {
  const parentDoc = await resolveParentDoc(app, input.parent_id);

  const checks = [
    parentLegal(parentDoc !== null ? { type: parentDoc.type } : null),
    specKindValid(input.extra?.spec_kind),
    hasSkeleton(input.content ?? ""),
  ];
  const missing = checks
    .filter((c): c is { ok: false; reason: string } => !c.ok)
    .map((c) => c.reason);

  if (missing.length === 0) {
    console.log("gate: pass");
    process.exitCode = 0;
    return;
  }

  const rule = await findApprovedRuleDoc(app);
  const parentMarkdown =
    parentDoc !== null ? await renderDocMarkdown(app, parentDoc) : undefined;

  const pack = buildFeedingPack({
    ruleSource: rule.source,
    ruleMarkdown: rule.markdown,
    ...(parentMarkdown !== undefined ? { parentMarkdown } : {}),
    missing,
  });

  console.log(renderFeedingPack(pack));
  process.exitCode = 4;
}

/**
 * Resolves `parentIdOrSlug` to a full `DocRecord` via `corpusService.get`.
 *
 * @returns `null` when `parentIdOrSlug` is absent/blank OR fails to resolve (unknown
 *   id/slug, store error) — the gate's `parentLegal` predicate treats "could not
 *   resolve a parent" the same as "no parent supplied" (both fail with
 *   `PARENT_REQUIRED`), matching the bundle contract: "缺失或解析失败 → parentDoc=null".
 */
async function resolveParentDoc(
  app: App,
  parentIdOrSlug: string | undefined,
): Promise<DocRecord | null> {
  if (parentIdOrSlug === undefined || parentIdOrSlug.trim() === "") {
    return null;
  }
  const result = await app.corpusService.get(parentIdOrSlug);
  if (!result.ok) {
    return null;
  }
  return result.value.doc;
}

/**
 * Renders `doc.content` with MDX placeholders spliced in, mirroring `get.ts`'s
 * `--raw`-off pattern (`outlineService.resolve` → `renderResolvedToMarkdown`). A
 * resolution failure degrades to the raw, unspliced body rather than aborting the
 * gate — the feeding pack is advisory context, not a hard dependency on placeholder
 * resolution succeeding.
 */
async function renderDocMarkdown(app: App, doc: DocRecord): Promise<string> {
  const resolveResult = await app.outlineService.resolve(doc);
  if (!resolveResult.ok) {
    return doc.content;
  }
  return renderResolvedToMarkdown(resolveResult.value);
}

/** One rule-doc lookup outcome: where the slice came from, and the slice itself. */
interface RuleDocLookup {
  /** Slug of the rule doc (or `WRITE_SPEC_RULE_TITLE` itself when no doc was found — see caller). */
  source: string;
  /** Markdown slice fed to `buildFeedingPack`; `RULE_DOC_MISSING_PLACEHOLDER` when absent. */
  markdown: string;
}

/**
 * Finds the APPROVED `knowledge` doc titled exactly `WRITE_SPEC_RULE_TITLE` and
 * returns its markdown (MDX-resolved, mirroring `renderDocMarkdown`).
 *
 * @invariant Only ever considers `status=approved` docs (module contract: "只用
 *   status=approved 的") — a draft/in-review doc with a matching title is invisible
 *   to this lookup, same as if it didn't exist.
 * @returns A `RuleDocLookup` with `markdown = RULE_DOC_MISSING_PLACEHOLDER` when no
 *   matching approved doc exists, or the list/get/resolve calls fail — the gate still
 *   surfaces `missing` reasons even when the rule doc itself is unavailable.
 */
async function findApprovedRuleDoc(app: App): Promise<RuleDocLookup> {
  const listResult = await app.corpusService.list({ type: "knowledge", status: "approved" });
  if (!listResult.ok) {
    return { source: WRITE_SPEC_RULE_TITLE, markdown: RULE_DOC_MISSING_PLACEHOLDER };
  }

  const match = listResult.value.docs.find((d) => d.title === WRITE_SPEC_RULE_TITLE);
  if (match === undefined) {
    return { source: WRITE_SPEC_RULE_TITLE, markdown: RULE_DOC_MISSING_PLACEHOLDER };
  }

  const getResult = await app.corpusService.get(match.id);
  if (!getResult.ok) {
    return { source: match.slug, markdown: RULE_DOC_MISSING_PLACEHOLDER };
  }

  return { source: match.slug, markdown: await renderDocMarkdown(app, getResult.value.doc) };
}
