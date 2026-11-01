/**
 * spec-governance-visibility-an-armed-gate-that-vacuously-passes §B3 — "a fresh
 * consumer install receives an empty feeding pack".
 *
 * `CorpusService._createImpl`'s spec-create gate enrichment (SPEC-049 §Design
 * Decisions D3) pre-fetches an approved `knowledge/skill` doc
 * (`findFeedingSkill("spec")`) and threads its slug/content into the denial's
 * feeding pack as `ruleSource`/`ruleMarkdown`; when that lookup misses or fails it falls
 * back to a compiled-in `FALLBACK_SPEC_CREATE_RULE_SOURCE`/`_MARKDOWN` pair. This file
 * proves each of those branches at the service layer (InMemoryStore, no subprocess).
 *
 * ⛔ SUPERSEDED IN PART by spec-every-document-is-stored-as-structured-fields-validated-by ("One
 * source"): the spec-rules document, the compiled-in fallback text and the rule file shipped with
 * the binary are retired in favour of the approved template. `lore gate spec-create` and
 * `lore feed spec-create` already quote the template (their suites assert it). The SERVICE-LAYER
 * enrichment in `corpus-service.ts` still carries the old branches until the task that holds
 * `CorpusService` lands its change; this file pins today's behaviour and is to be rewritten (to
 * assert the template slice) in the same change that removes the fallback constants. The former
 * "both-ends" CLI probe is gone: it drove the denial with a heading-less body, which the retired
 * `hasSkeleton` predicate used to refuse and nothing does any more.
 *
 * The denial here is driven by the one content-level predicate a service-layer create can still
 * trip: an unquantified acceptance criterion (`acQuantifiable`).
 *
 * Coverage:
 *   HAPPY:      corpus HAS an approved knowledge/skill doc -> ruleSource/ruleMarkdown come from THAT doc
 *   NEGATIVE:   corpus has ZERO knowledge docs -> falls back to the compiled-in constant, never `[source: unknown]`
 *   ERROR:      `findFeedingSkill`'s underlying `store.findMany` fails (STORE_ERROR) -> STILL falls back
 *   STATE:      `workflow.gates.spec-create.enabled: false` -> the create simply passes
 *
 * @spec_ref spec-governance-visibility-an-armed-gate-that-vacuously-passes §B3, AC-GV-5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { StoreFilters } from "../../../src/store/store-interface.js";
import { err } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreConfig, LoreError, Result } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";

const BODY = "a body with no headings anywhere";
/** An abstract-quality criterion with no threshold: the predicate that denies a service-layer spec create. */
const UNQUANTIFIED_AC = { id: "AC-VAGUE-1", statement: "the dashboard loads fast", verify: { mode: "human" as const } };

/** Extracts the `[source: X, trust: Y]` header's `X` from a rendered feeding-pack message. */
function extractSource(message: string): string | null {
  const m = /\[source: ([^,]+), trust: [^\]]+\]/.exec(message);
  return m ? m[1] ?? null : null;
}

function makeGatedService(store: InMemoryStore = actedStore(new InMemoryStore())) {
  const gateEnforcer = new GateEnforcer(undefined);
  return { service: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, gateEnforcer), store };
}

async function createPrd(service: CorpusService, title: string): Promise<DocRecord> {
  const created = await service.create({ type: "prd", title, content: "PRD body" } as CreateDocInput);
  if (!created.ok) throw new Error(`prd create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

function badSpec(title: string): CreateDocInput {
  return { type: "spec", title, content: BODY, extra: { acceptance_criteria: [UNQUANTIFIED_AC] } } as CreateDocInput;
}

describe("CorpusService spec-create fallback — HAPPY", () => {
  it("a corpus WITH an approved knowledge/skill doc uses its slug/content, never the fallback", async () => {
    const { service } = makeGatedService();
    await createPrd(service, "Root PRD");

    const skillCreate = await service.create({
      parent_id: await ensureRequirementsDocId(service), type: "knowledge",
      title: "Team write-spec rules",
      content: "## Rule\n\nDistinctive team-authored rule text.",
      extra: { sub_type: "skill", skill: { applies_to: "spec" } },
    } as CreateDocInput);
    if (!skillCreate.ok) throw new Error(`skill create failed: ${JSON.stringify(skillCreate.error)}`);
    const skillApprove = await service.set(skillCreate.value.id, { status: "approved" });
    if (!skillApprove.ok) throw new Error(`skill approve failed: ${JSON.stringify(skillApprove.error)}`);

    const spec = await service.create(badSpec("Bad Spec"));

    expect(spec.ok).toBe(false);
    if (spec.ok) return;
    const message = (spec.error as { message?: string }).message ?? "";
    expect(message).toContain(`[source: ${skillApprove.value.slug}, trust: team-authored]`);
    expect(message).toContain("Distinctive team-authored rule text.");
    expect(message).not.toContain("built-in fallback");
  });
});

describe("CorpusService spec-create fallback — NEGATIVE", () => {
  it("an EMPTY corpus (zero knowledge docs) falls back to the compiled-in rule slice, never [source: unknown]", async () => {
    const { service } = makeGatedService();
    await createPrd(service, "Root PRD");

    const spec = await service.create(badSpec("Bad Spec"));

    expect(spec.ok).toBe(false);
    if (spec.ok) return;
    const message = (spec.error as { message?: string }).message ?? "";
    expect(message).not.toContain("[source: unknown");
    const source = extractSource(message);
    expect(source).not.toBeNull();
    expect(source).toBe("built-in fallback (no seeded rule doc)");
    // The rule slice itself must be genuinely present, not just a named, still-empty label.
    expect(message).toContain("## Rules a candidate spec must satisfy");
    expect(message).toContain("No parent.");
  });
});

describe("CorpusService spec-create fallback — ERROR", () => {
  it("a failing findFeedingSkill lookup (store.findMany errors) ALSO falls back, never throws or degrades to [source: unknown]", async () => {
    class FindManyFailingStore extends InMemoryStore {
      override async findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>> {
        if (filters.type === "knowledge") {
          return err({ code: "STORE_ERROR", message: "simulated findMany failure" });
        }
        return super.findMany(filters);
      }
    }

    const { service } = makeGatedService(actedStore(new FindManyFailingStore()));
    await createPrd(service, "Root PRD");

    const spec = await service.create(badSpec("Bad Spec"));

    expect(spec.ok).toBe(false);
    if (spec.ok) return;
    const message = (spec.error as { message?: string }).message ?? "";
    expect(message).not.toContain("[source: unknown");
    expect(extractSource(message)).toBe("built-in fallback (no seeded rule doc)");
    expect(message).toContain("## Rules a candidate spec must satisfy");
  });
});

describe("CorpusService spec-create fallback — STATE", () => {
  it("a DISABLED spec-create gate never consults the fallback — the create simply passes", async () => {
    const gateEnforcer = new GateEnforcer({
      project: { name: "x", author: "owner" },
      workflow: { gates: { "spec-create": { enabled: false } } },
    } as unknown as LoreConfig);
    const store = actedStore(new InMemoryStore());
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, gateEnforcer);
    await createPrd(service, "Root PRD");

    const spec = await service.create(badSpec("Ungated Spec"));

    expect(spec.ok).toBe(true);
  });
});
