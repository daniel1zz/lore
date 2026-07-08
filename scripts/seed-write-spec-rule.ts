#!/usr/bin/env bun
/**
 * Seed script: ensures the corpus carries exactly one "write-spec rules" reference
 * document — the source `lore gate spec-create` feeds (via
 * `packages/lore/src/service/gate-feeding.ts::buildFeedingPack`) back to the AI when
 * a candidate spec fails a deterministic gate predicate. Idempotent: safe to run on
 * every deploy / CI boot — a second run finds the existing doc by title and skips
 * creation rather than duplicating it.
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

import { join } from "node:path";
import { createApp, type App } from "../packages/lore/src/app.js";
import type { LoreError } from "@lore/core";

/**
 * Typed error for seed failures — carries which operation failed and the underlying
 * `LoreError`, so a caller can distinguish "corpus unreadable" from "create rejected"
 * from "approve transition rejected" without string-matching a message.
 */
export class SeedWriteSpecRuleError extends Error {
  public readonly operation: "list" | "create" | "approve";
  public readonly loreError: LoreError;

  constructor(operation: "list" | "create" | "approve", loreError: LoreError) {
    super(`seed-write-spec-rule: ${operation} failed — ${JSON.stringify(loreError)}`);
    this.name = "SeedWriteSpecRuleError";
    this.operation = operation;
    this.loreError = loreError;
  }
}

/** Title uniquely identifying the seeded doc — idempotency lookup key (see `seedWriteSpecRule`). */
export const WRITE_SPEC_RULE_TITLE = "Write-spec rules (gate feeding source)";

/**
 * Markdown body of the seeded doc. Drafted from the five write-spec rules the gate
 * enforces (IoC vertical-slice tech-spec §4.1/§11) — kept short and skeleton-shaped
 * on purpose: this is exactly what `buildFeedingPack` will slice down further, so a
 * dense, front-loaded body maximises what survives an 800-char truncation.
 */
export const WRITE_SPEC_RULE_CONTENT = `## Overview

Rules a candidate \`spec\` document must satisfy before \`lore gate spec-create\` will
let it through. This document is the feeding source the gate quotes back (via a
minimal, truncated slice — never the full text) when a candidate violates one of
these rules.

## Rules

1. **Legal parent.** A spec must be parented to a legal upstream document type — a
   \`prd\`. Creating a spec with no parent, or a parent of the wrong type, is rejected.
2. **Declared spec_kind.** A spec must declare \`extra.spec_kind\` as one of
   \`feature\`, \`tech\`, or \`design\`. An absent value defaults to \`feature\` at create
   time; an explicit unrecognised value is rejected.
3. **Required skeleton sections.** A spec's content must include, at minimum, these
   level-2 headings: \`## Overview/Goal\`, \`## Scope\`, \`## Acceptance Criteria\`.
4. **Deterministic, oracle-verifiable acceptance criteria.** Every AC must be
   checkable by a deterministic oracle — an exit code, a test assertion, a concrete
   observable outcome. Vague verbs (\"works\", \"support\", \"跑通\") are not acceptable
   AC language; they cannot be mechanically verified.
5. **Structured AC via \`lore ac add\`.** Once the skeleton exists, add machine-checkable
   acceptance criteria with \`lore ac add <spec> <id> --statement <s> --mode <script|ai|human>\`
   rather than only prose under \`## Acceptance Criteria\` — structured ACs are what
   \`lore verify\` / \`lore assess\` can actually execute and score against.

## Scope

Applies to every \`spec\` document created through \`lore create spec\` or
programmatically via \`CorpusService.create\`. Does not apply to \`prd\`, \`adr\`,
\`plan\`, \`knowledge\`, or \`task\` documents.

## Acceptance Criteria

- A spec with no \`parent_id\`, or a \`parent_id\` pointing to a non-\`prd\` doc, is
  rejected by \`gate-predicates.ts::parentLegal\`.
- A spec with an \`extra.spec_kind\` outside \`feature|tech|design\` is rejected by
  \`gate-predicates.ts::specKindValid\`.
- A spec whose content contains no \`## \` heading line is rejected by
  \`gate-predicates.ts::hasSkeleton\`.
`;

/** Result of one `seedWriteSpecRule` invocation. */
export interface SeedResult {
  /** Slug of the write-spec-rule doc — existing or newly created. */
  slug: string;
  /** `true` when this call created the doc; `false` when it already existed (idempotent skip). */
  created: boolean;
}

/**
 * Ensures the write-spec-rule reference doc exists and is `approved`, creating it
 * only when no doc with `WRITE_SPEC_RULE_TITLE` already exists.
 *
 * @param app - A wired `App` (from `createApp`) pointed at the target corpus.
 * @returns `{slug, created: false}` when a matching doc already exists (idempotent
 *   no-op); `{slug, created: true}` when this call created and approved a new one.
 * @throws {SeedWriteSpecRuleError} when the list/create/approve service call fails.
 * @example
 * const app = createApp(dbPath);
 * const result = await seedWriteSpecRule(app);
 * // result.created === false on a second call against the same corpus
 */
export async function seedWriteSpecRule(app: App): Promise<SeedResult> {
  const listResult = await app.corpusService.list({ type: "knowledge" });
  if (!listResult.ok) {
    throw new SeedWriteSpecRuleError("list", listResult.error);
  }

  const existing = listResult.value.docs.find((doc) => doc.title === WRITE_SPEC_RULE_TITLE);
  if (existing !== undefined) {
    return { slug: existing.slug, created: false };
  }

  const createResult = await app.corpusService.create({
    type: "knowledge",
    title: WRITE_SPEC_RULE_TITLE,
    content: WRITE_SPEC_RULE_CONTENT,
    extra: { sub_type: "reference" },
  });
  if (!createResult.ok) {
    throw new SeedWriteSpecRuleError("create", createResult.error);
  }

  // draft -> approved is a valid direct (fast-track) transition (SPEC-002 §3).
  const approveResult = await app.corpusService.set(createResult.value.id, { status: "approved" });
  if (!approveResult.ok) {
    throw new SeedWriteSpecRuleError("approve", approveResult.error);
  }

  return { slug: approveResult.value.slug, created: true };
}

// CLI surface — direct invocation seeds the corpus at the resolved dbPath and exits.
if (import.meta.main) {
  const dbPath =
    process.argv[2] ?? process.env["LORE_DB_PATH"] ?? join(process.cwd(), ".lore", "lore.db");
  const app = createApp(dbPath);
  try {
    const result = await seedWriteSpecRule(app);
    console.log(JSON.stringify(result));
  } finally {
    app.close();
  }
}
