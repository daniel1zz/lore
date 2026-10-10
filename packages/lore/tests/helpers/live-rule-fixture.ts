/**
 * Test fixture: one LIVE business rule in an in-memory store, so a spec fixture can cite it and be
 * approved (BR-1007: a spec is approved only when a criterion cites a live BR or AS rule).
 *
 * Purpose: shared setup for tests that approve a spec but are not about citations themselves.
 * Public surface: {@link LIVE_RULE_ID}, {@link seedLiveRule}, {@link approveCitedSpec}.
 * Invariants: inserts exactly one baseline leaf holding one `live` rule; idempotent per store
 *   (a second call finds the leaf by slug and inserts nothing).
 * Side-effect class: store write (test-only; never used against a real corpus).
 */

import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocId, DocRecord, Slug } from "@lore/core";
import type { StoreInterface } from "../../src/store/store-interface.js";
import type { CorpusService } from "../../src/service/corpus-service.js";

/** The rule id the seeded leaf holds; put it in a criterion's `cites`. */
export const LIVE_RULE_ID = "BR-1";
const LIVE_RULE_SLUG = "baseline-live-rule-fixture" as Slug;

/**
 * Inserts a business leaf holding one live rule, {@link LIVE_RULE_ID}.
 *
 * @param store - the store the spec fixture lives in
 * @returns the rule id to cite
 * @throws Error when the leaf cannot be inserted (a fixture fault, surfaced loudly)
 * @example
 * const ruleId = await seedLiveRule(store);
 * const ac = { id: "AC-1", statement: "...", verify: {...}, cites: [ruleId] };
 */
export async function seedLiveRule(store: StoreInterface): Promise<string> {
  const existing = await store.findBySlug(LIVE_RULE_SLUG);
  if (existing.ok && existing.value !== null) return LIVE_RULE_ID;
  const now = new Date().toISOString();
  const doc: DocRecord = {
    id: ulid() as DocId,
    slug: LIVE_RULE_SLUG,
    type: "baseline",
    role: DOC_TYPE_ROLE_MAP.baseline,
    title: "Live rule fixture",
    status: "draft",
    priority: "medium",
    content: "Live rule fixture",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {
      node: "leaf",
      label: "fixture",
      rules: [
        {
          id: LIVE_RULE_ID,
          statement: "a live rule the fixture specs cite",
          confidence: "established",
          enforced_by: "both",
          examples: ["example"],
          lifecycle: "live",
        },
      ],
    },
  };
  const inserted = await store.insert(doc);
  if (!inserted.ok) throw new Error(`live-rule fixture insert failed: ${JSON.stringify(inserted.error)}`);
  return LIVE_RULE_ID;
}

/**
 * Promotes `specId` to `approved` the way a user does (`CorpusService.set`), after making sure it
 * has a criterion citing the live rule — for a test where the approval is a preparation step, not
 * the behaviour under test. A spec with no criteria gets one (a human-mode criterion); otherwise
 * its first criterion gains the cite.
 *
 * @param store - the store behind `corpusService`
 * @param corpusService - the service whose `set` performs the promotion
 * @param specId - id or slug of a draft spec
 * @returns the promotion's Result, so a test can assert a refusal from another gate
 * @throws Error when the fixture's own preparation fails (a fixture fault, surfaced loudly)
 */
export async function approveCitedSpec(
  store: StoreInterface,
  corpusService: CorpusService,
  specId: string,
): ReturnType<CorpusService["set"]> {
  await seedLiveRule(store);
  const got = await corpusService.get(specId);
  if (!got.ok) throw new Error(`approveCitedSpec: spec not found: ${JSON.stringify(got.error)}`);
  const doc = got.value.doc;
  const raw = doc.extra["acceptance_criteria"];
  const criteria = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  const next =
    criteria.length === 0
      ? [
          {
            id: "AC-FIXTURE-1",
            statement: "the fixture behaviour responds in < 200ms",
            verify: { mode: "human" },
            cites: [LIVE_RULE_ID],
          },
        ]
      : criteria.map((criterion, index) => {
          if (index !== 0) return criterion;
          const cites = Array.isArray(criterion["cites"]) ? (criterion["cites"] as string[]) : [];
          return cites.includes(LIVE_RULE_ID) ? criterion : { ...criterion, cites: [...cites, LIVE_RULE_ID] };
        });
  const updated = await store.update(doc.id, { extra: { ...doc.extra, acceptance_criteria: next } });
  if (!updated.ok) throw new Error(`approveCitedSpec: criteria write failed: ${JSON.stringify(updated.error)}`);
  return corpusService.set(specId, { status: "approved" });
}
