#!/usr/bin/env bun
/**
 * Seed script: ensures the corpus carries exactly one "write-spec rules" `knowledge`
 * document — the source `lore gate spec-create` feeds (via
 * `packages/lore/src/service/gate-feeding.ts::buildFeedingPack`) back to the AI when
 * a candidate spec fails a deterministic gate predicate. The doc is a reusable
 * `sub_type: "skill"` artifact (`extra.skill.applies_to = "spec"`), not a passive
 * `sub_type: "reference"` — it's the rule set an agent actively applies when writing a
 * spec, matching the "skill" upstream-asset semantics (`skillExtraSchema`, `@lore/core`).
 *
 * Idempotent AND self-upgrading: safe to run on every deploy / CI boot.
 *   - No doc titled `WRITE_SPEC_RULE_TITLE` exists yet -> creates it as `sub_type:
 *     "skill"` and fast-tracks it to `approved`.
 *   - A doc with that title exists but is NOT yet `sub_type: "skill"` (e.g. a doc
 *     seeded by a pre-migration version of this script, `sub_type: "reference"`) ->
 *     upgraded IN PLACE: `extra` is rewritten to the skill shape and `status` is
 *     (re-)confirmed `approved` in the same patch, without touching `title`/`content`
 *     (which would otherwise reset an already-`approved` doc back to `draft` — see
 *     `CorpusService.set`'s approved-edit-resets-to-draft invariant, SPEC-002 §3).
 *   - A doc with that title already carries `sub_type: "skill"` -> no-op.
 *
 * Usage:
 *   bun scripts/seed-write-spec-rule.ts [dbPath]
 *   LORE_DB_PATH=/path/to/.lore/lore.db bun scripts/seed-write-spec-rule.ts
 *
 * Precedence for the target corpus path: CLI positional arg > $LORE_DB_PATH env var >
 * "<cwd>/.lore/lore.db" default. Tests call `seedWriteSpecRule(app)` directly against
 * an App wired to a throwaway corpus — never against the repo's own `.lore/` corpus
 * (see project CLAUDE.md's "Never write to the repo's own .lore/ corpus from tests").
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ambientOfInvocation, createApp, type App } from "../packages/lore/src/app.js";
import { resolveEntryInvocation } from "../packages/lore/src/adapters/cli/run-cli.js";
import type { LoreError } from "@lore/core";

/** Operations `seedWriteSpecRule` may fail at — see {@link SeedWriteSpecRuleError}. */
type SeedOperation = "list" | "create" | "approve" | "upgrade";

/**
 * Typed error for seed failures — carries which operation failed and the underlying
 * `LoreError`, so a caller can distinguish "corpus unreadable" from "create rejected"
 * from "approve transition rejected" from "in-place upgrade rejected" without
 * string-matching a message.
 */
export class SeedWriteSpecRuleError extends Error {
  public readonly operation: SeedOperation;
  public readonly loreError: LoreError;

  constructor(operation: SeedOperation, loreError: LoreError) {
    super(`seed-write-spec-rule: ${operation} failed — ${JSON.stringify(loreError)}`);
    this.name = "SeedWriteSpecRuleError";
    this.operation = operation;
    this.loreError = loreError;
  }
}

/** Title uniquely identifying the seeded doc — idempotency lookup key (see `seedWriteSpecRule`). */
export const WRITE_SPEC_RULE_TITLE = "Write-spec rules (gate feeding source)";

/**
 * Markdown body of the seeded doc — read from the shipped asset `assets/governance/write-spec-rule.md`, the SSOT the
 * binary's gate feeds from when a corpus has no rule doc of its own (BR-1359), so this repo's own corpus doc and the
 * shipped fallback never carry two diverging rule texts.
 */
export const WRITE_SPEC_RULE_CONTENT = readFileSync(
  join(import.meta.dirname, "..", "assets", "governance", "write-spec-rule.md"),
  "utf-8",
);

/**
 * The three-state outcome of one `seedWriteSpecRule` call — a discriminated result
 * instead of a boolean, since the in-place upgrade path (see module header) added a
 * third state that a `created: boolean` flag cannot represent without an ambiguous
 * "false means either upgraded or skipped" reading.
 */
export type SeedOutcome = "created" | "upgraded" | "skipped";

/** Result of one `seedWriteSpecRule` invocation. */
export interface SeedResult {
  /** Slug of the write-spec-rule doc — existing or newly created/upgraded. */
  slug: string;
  /** Which of the three idempotent branches this call took — see {@link SeedOutcome}. */
  outcome: SeedOutcome;
}

/** `extra` shape written on both the create path and the in-place upgrade path. */
const SKILL_EXTRA = { sub_type: "skill" as const, skill: { applies_to: "spec" } };

/**
 * Ensures the write-spec-rule `sub_type: "skill"` doc exists and is `approved`:
 * creates it when absent, upgrades a pre-migration `sub_type !== "skill"` doc of the
 * same title in place, or no-ops when it's already a skill doc.
 *
 * @param app - A wired `App` (from `createApp`) pointed at the target corpus.
 * @returns `{slug, outcome: "created"}` when no matching-titled doc existed yet;
 *   `{slug, outcome: "upgraded"}` when a matching-titled doc existed but wasn't yet
 *   `sub_type: "skill"` (its `extra` was rewritten and `status` re-confirmed
 *   `approved` in place); `{slug, outcome: "skipped"}` when it was already a skill doc.
 * @throws {SeedWriteSpecRuleError} when the list/create/approve/upgrade service call fails.
 * @example
 * const app = createApp(dbPath);
 * const result = await seedWriteSpecRule(app);
 * // result.outcome === "skipped" on a second call against the same corpus
 */
export async function seedWriteSpecRule(app: App): Promise<SeedResult> {
  const listResult = await app.corpusService.list({ type: "knowledge" });
  if (!listResult.ok) {
    throw new SeedWriteSpecRuleError("list", listResult.error);
  }

  const existing = listResult.value.docs.find((doc) => doc.title === WRITE_SPEC_RULE_TITLE);

  if (existing === undefined) {
    const createResult = await app.corpusService.create({
      type: "knowledge",
      title: WRITE_SPEC_RULE_TITLE,
      content: WRITE_SPEC_RULE_CONTENT,
      extra: SKILL_EXTRA,
    });
    if (!createResult.ok) {
      throw new SeedWriteSpecRuleError("create", createResult.error);
    }

    // draft -> approved is a valid direct (fast-track) transition (SPEC-002 §3).
    const approveResult = await app.corpusService.set(createResult.value.id, { status: "approved" });
    if (!approveResult.ok) {
      throw new SeedWriteSpecRuleError("approve", approveResult.error);
    }

    return { slug: approveResult.value.slug, outcome: "created" };
  }

  const existingSubType = existing.meta?.t === "knowledge" ? existing.meta.sub_type : undefined;
  if (existingSubType === "skill") {
    return { slug: existing.slug, outcome: "skipped" };
  }

  // reason: patch `extra` + `status` together, WITHOUT `title`/`content` — touching
  // either of those on an already-`approved` doc auto-resets it to `draft`
  // (`CorpusService.set`, SPEC-002 §3). Re-asserting `status: "approved"` here is safe
  // regardless of the doc's current status: `set()` applies a direct patch with no
  // `isValidTransition` gate (that check lives in ReviewService's approve/reject flow,
  // not here), so this also self-heals a stray non-approved legacy doc in one call.
  const upgradeResult = await app.corpusService.set(existing.id, {
    extra: SKILL_EXTRA,
    status: "approved",
  });
  if (!upgradeResult.ok) {
    throw new SeedWriteSpecRuleError("upgrade", upgradeResult.error);
  }

  return { slug: upgradeResult.value.slug, outcome: "upgraded" };
}

// CLI surface — direct invocation seeds the corpus at the resolved dbPath and exits.
if (import.meta.main) {
  const dbPath =
    process.argv[2] ?? process.env["LORE_DB_PATH"] ?? join(process.cwd(), ".lore", "lore.db");
  const inv = await resolveEntryInvocation(process.argv.slice(2));
  const app = createApp(dbPath, undefined, ambientOfInvocation(inv), { identity: inv.identity });
  try {
    const result = await seedWriteSpecRule(app);
    console.log(JSON.stringify(result));
  } finally {
    app.close();
  }
}
