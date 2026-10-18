/**
 * Tests for CorpusService.findFeedingSkill (IoC vertical-slice tech-spec §4.1/§11,
 * P1 slice-2 — applies_to-based feeding skill discovery, generalizing `lore gate`'s
 * former hardcoded-title rule-doc lookup).
 * Uses InMemoryStore — no file I/O, no SQLite dependency.
 *
 * Spec-first expectations:
 *   - an approved knowledge/skill doc with a matching extra.skill.applies_to is found
 *   - a DRAFT (not approved) skill doc with a matching applies_to is invisible
 *   - a skill doc with a DIFFERENT applies_to is invisible
 *   - a non-skill knowledge doc (e.g. sub_type "reference") is invisible even if it
 *     somehow carries an extra.skill.applies_to value (sub_type gate is authoritative)
 *   - two matching approved skill docs → the most-recently-updated one is returned
 *   - zero matches → ok(null), never an error (a fact, not a failure)
 *
 * Six-dimension coverage:
 *   HAPPY:      single approved matching skill doc is found
 *   NEGATIVE:   wrong applies_to and non-skill sub_type are both invisible
 *   BOUNDARY:   two matches → latest updated_at wins
 *   ERROR:      n/a beyond BOUNDARY for this method — store.findMany failure path is
 *               exercised indirectly via the "no matches" ok(null) contract (findMany
 *               itself cannot fail against InMemoryStore for a plain type/status filter)
 *   STATE:      a draft skill doc becomes visible only after being approved
 *   REGRESSION: ok(null) is the exact returned value (not a thrown error, not `ok(undefined)`)
 *
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11 P1 slice-2
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

function makeService() {
  const store = actedStore(new InMemoryStore());
  return { service: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))), store };
}

async function createApprovedSkillDoc(
  service: CorpusService,
  opts: { title: string; appliesTo: string; content?: string },
): Promise<{ id: string; slug: string }> {
  const created = await service.create({
    type: "knowledge",
    title: opts.title,
    content: opts.content ?? "## Rule\n\nBody.",
    extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
  } as CreateDocInput);
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  const approved = await service.set(created.value.id, { status: "approved" });
  if (!approved.ok) throw new Error(`approve failed: ${JSON.stringify(approved.error)}`);
  return { id: created.value.id, slug: approved.value.slug };
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────

describe("findFeedingSkill — HAPPY", () => {
  it("finds the single approved knowledge/skill doc matching applies_to", async () => {
    const { service } = makeService();
    const skill = await createApprovedSkillDoc(service, {
      title: "Write-spec rules",
      appliesTo: "spec",
      content: "## Rule\n\nMust have a legal parent.",
    });

    const result = await service.findFeedingSkill("spec");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.id).toBe(skill.id);
    expect(result.value?.slug).toBe(skill.slug);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("findFeedingSkill — NEGATIVE", () => {
  it("does not match a skill doc scoped to a different applies_to", async () => {
    const { service } = makeService();
    await createApprovedSkillDoc(service, { title: "Task rules", appliesTo: "task" });

    const result = await service.findFeedingSkill("spec");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it("does not match an approved knowledge doc that is not sub_type 'skill'", async () => {
    const { service } = makeService();
    const created = await service.create({
      type: "knowledge",
      title: "Reference doc pretending to have skill fields",
      content: "x",
      extra: { sub_type: "reference", skill: { applies_to: "spec" } },
    } as CreateDocInput);
    if (!created.ok) throw new Error("create failed");
    const approved = await service.set(created.value.id, { status: "approved" });
    if (!approved.ok) throw new Error("approve failed");

    const result = await service.findFeedingSkill("spec");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("findFeedingSkill — BOUNDARY", () => {
  it("returns the most-recently-updated doc when two approved skill docs both match", async () => {
    const { service } = makeService();
    const older = await createApprovedSkillDoc(service, { title: "Older rules", appliesTo: "spec" });
    // reason: guarantee a strictly-later `updated_at` millisecond tick on `newer` — two
    // sequential in-process writes can otherwise land within the same JS-clock
    // millisecond, making the "latest wins" assertion below flaky.
    await new Promise((r) => setTimeout(r, 5));
    const newer = await createApprovedSkillDoc(service, { title: "Newer rules", appliesTo: "spec" });
    // Re-approve `newer` too, so the assertion covers "latest by updated_at", not merely
    // "latest by created_at" (both fields are set identically at create time).
    const touched = await service.set(newer.id, { status: "approved" });
    if (!touched.ok) throw new Error("touch failed");

    const result = await service.findFeedingSkill("spec");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.id).toBe(newer.id);
    expect(result.value?.id).not.toBe(older.id);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("findFeedingSkill — STATE", () => {
  it("a draft skill doc is invisible until approved, then becomes discoverable", async () => {
    const { service } = makeService();
    const created = await service.create({
      type: "knowledge",
      title: "Not yet approved rules",
      content: "## Rule\n\nDraft body.",
      extra: { sub_type: "skill", skill: { applies_to: "spec" } },
    } as CreateDocInput);
    if (!created.ok) throw new Error("create failed");

    const beforeApprove = await service.findFeedingSkill("spec");
    expect(beforeApprove.ok).toBe(true);
    if (beforeApprove.ok) expect(beforeApprove.value).toBeNull();

    const approved = await service.set(created.value.id, { status: "approved" });
    if (!approved.ok) throw new Error("approve failed");

    const afterApprove = await service.findFeedingSkill("spec");
    expect(afterApprove.ok).toBe(true);
    if (afterApprove.ok) expect(afterApprove.value?.id).toBe(created.value.id);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("findFeedingSkill — REGRESSION", () => {
  it("returns ok(null), not a thrown error or ok(undefined), when nothing matches", async () => {
    const { service } = makeService();

    const result = await service.findFeedingSkill("spec");
    expect(result).toEqual({ ok: true, value: null });
  });
});
