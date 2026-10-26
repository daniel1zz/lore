/**
 * AC-HC-2 — working-state classifier: isContentChange fails safe (unknown key = content),
 * WORKING_STATE_KEYS is the single list; buildStateChange delta shape (spec Scope 3).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { WORKING_STATE_KEYS, isContentChange, buildStateChange } from "@lore/core";
import type { DocType } from "@lore/core";

const ALL_TYPES: DocType[] = ["prd", "spec", "adr", "plan", "knowledge", "task", "phase", "baseline"];

const row = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  slug: "task-x", title: "T", content: "body", status: "draft", priority: "medium",
  parent_id: "P1", tags: ["a"], ordinal: 1, deleted_at: null as string | null,
  version: 3, updated_at: "2026-01-01T00:00:00Z", extra, ...over,
});

describe("WORKING_STATE_KEYS", () => {
  it("has an entry for every DocType", () => {
    for (const t of ALL_TYPES) expect(Array.isArray(WORKING_STATE_KEYS[t])).toBe(true);
  });
  it("matches spec Scope 1 exactly", () => {
    expect([...WORKING_STATE_KEYS.task]).toEqual(["claim", "verification_evidence", "red_first", "landing", "landing_history", "commit_range", "assignee", "milestone_findings"]);
    expect([...WORKING_STATE_KEYS.phase]).toEqual(["claim", "verification_evidence", "checklist", "track", "migrated_from", "migrated_to"]);
    expect([...WORKING_STATE_KEYS.plan]).toEqual(["progress", "known_defects", "integration_branch"]);
    expect([...WORKING_STATE_KEYS.spec]).toEqual(["code_anchors"]);
    expect([...WORKING_STATE_KEYS.knowledge]).toEqual(["code_anchors"]);
    expect([...WORKING_STATE_KEYS.prd]).toEqual(["outline_budget"]);
    expect([...WORKING_STATE_KEYS.adr]).toEqual([]);
    expect([...WORKING_STATE_KEYS.baseline]).toEqual([]);
  });
  it("deliberately-content keys are not listed", () => {
    expect(WORKING_STATE_KEYS.task).not.toContain("file_anchors");
    expect(WORKING_STATE_KEYS.task).not.toContain("issues");
    expect(WORKING_STATE_KEYS.plan).not.toContain("issues");
    expect(WORKING_STATE_KEYS.spec).not.toContain("allow_missing_path_declarations");
  });
  it("is declared in exactly one file under packages/", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        if (n === "node_modules" || n === "dist" || n.startsWith(".")) continue;
        const p = join(dir, n);
        const s = statSync(p);
        if (s.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n) && !/\.test\.|\.bun\.test\./.test(n)) {
          const t = readFileSync(p, "utf8");
          if (/["']verification_evidence["']\s*,[^\]]*["']landing["']/.test(t)) hits.push(p);
        }
      }
    };
    walk(resolve(__dirname, "../../../.."));
    expect(hits.map((h) => h.split("packages/")[1])).toEqual(["core/src/working-state.ts"]);
  });
});

describe("isContentChange", () => {
  const base = row({}, { claim: { by: "a" }, foo: 1 });
  it("false when nothing differs", () => {
    expect(isContentChange("task", base, row({}, { claim: { by: "a" }, foo: 1 }))).toBe(false);
  });
  it.each([
    ["content", { content: "x" }], ["title", { title: "U" }], ["status", { status: "approved" }],
    ["slug", { slug: "y" }], ["parent_id", { parent_id: "P2" }], ["priority", { priority: "high" }],
    ["tags", { tags: ["b"] }], ["ordinal", { ordinal: 2 }], ["deleted_at", { deleted_at: "now" }],
  ])("true when %s differs", (_n, over) => {
    expect(isContentChange("task", base, { ...base, ...over })).toBe(true);
  });
  it("ignores version, updated_at and fts_* columns", () => {
    expect(isContentChange("task", { ...base, fts_title: "a" }, { ...base, version: 9, updated_at: "later", fts_title: "b" })).toBe(false);
  });
  it("true when an unknown extra key differs (fails safe)", () => {
    expect(isContentChange("task", base, row({}, { claim: { by: "a" }, foo: 2 }))).toBe(true);
    expect(isContentChange("task", base, row({}, { claim: { by: "a" } }))).toBe(true);
    expect(isContentChange("task", base, row({}, { claim: { by: "a" }, foo: 1, bar: 1 }))).toBe(true);
  });
  it("false when only listed working-state keys differ", () => {
    const after = row({}, { claim: { by: "b" }, foo: 1, verification_evidence: [1], landing: {} });
    expect(isContentChange("task", base, after)).toBe(false);
  });
  it("working-state key removed is not content", () => {
    expect(isContentChange("task", base, row({}, { foo: 1 }))).toBe(false);
  });
  it("is type-specific: a task key is content on an adr", () => {
    expect(isContentChange("adr", row({}, {}), row({}, { claim: 1 }))).toBe(true);
    expect(isContentChange("spec", row({}, {}), row({}, { code_anchors: ["a"] }))).toBe(false);
  });
  it("ignores key order, deep", () => {
    const a = row({}, { foo: { x: 1, y: [{ p: 1, q: 2 }] } });
    const b = row({}, { foo: { y: [{ q: 2, p: 1 }], x: 1 } });
    expect(isContentChange("task", a, b)).toBe(false);
    const c = row({}, { foo: { y: [{ q: 3, p: 1 }], x: 1 } });
    expect(isContentChange("task", a, c)).toBe(true);
  });
  it("array order matters", () => {
    expect(isContentChange("task", row({}, { foo: [1, 2] }), row({}, { foo: [2, 1] }))).toBe(true);
  });
  it("null vs set parent_id differ", () => {
    expect(isContentChange("task", base, { ...base, parent_id: null })).toBe(true);
  });
});

describe("buildStateChange", () => {
  it("evidence append -> appended only", () => {
    const r = buildStateChange("task", { verification_evidence: [{ n: 1 }] }, { verification_evidence: [{ n: 1 }, { n: 2 }] });
    expect(r).toEqual({ keys: ["verification_evidence"], values: {}, previous: {}, appended: { verification_evidence: [{ n: 2 }] }, removed: [] });
  });
  it("landing replaced -> values + previous", () => {
    const r = buildStateChange("task", { landing: { sha: "a" } }, { landing: { sha: "b" } });
    expect(r).toEqual({ keys: ["landing"], values: { landing: { sha: "b" } }, previous: { landing: { sha: "a" } }, appended: {}, removed: [] });
  });
  it("claim deleted -> removed + previous", () => {
    const r = buildStateChange("task", { claim: { by: "a" } }, {});
    expect(r).toEqual({ keys: ["claim"], values: {}, previous: { claim: { by: "a" } }, appended: {}, removed: ["claim"] });
  });
  it("new key -> values, no previous", () => {
    const r = buildStateChange("task", {}, { claim: { by: "a" } });
    expect(r.values).toEqual({ claim: { by: "a" } });
    expect("claim" in r.previous).toBe(false);
    expect(r.keys).toEqual(["claim"]);
  });
  it("steal -> values.claim new, previous.claim old", () => {
    const r = buildStateChange("task", { claim: { by: "A" } }, { claim: { by: "B" } });
    expect(r.values.claim).toEqual({ by: "B" });
    expect(r.previous.claim).toEqual({ by: "A" });
  });
  it("nothing changed -> keys []", () => {
    const r = buildStateChange("task", { claim: { by: "a" }, foo: 1 }, { claim: { by: "a" }, foo: 2 });
    expect(r).toEqual({ keys: [], values: {}, previous: {}, appended: {}, removed: [] });
  });
  it("non-prefix array change -> values + previous", () => {
    const r = buildStateChange("task", { verification_evidence: [1, 2] }, { verification_evidence: [1, 3] });
    expect(r.values.verification_evidence).toEqual([1, 3]);
    expect(r.previous.verification_evidence).toEqual([1, 2]);
    expect(r.appended).toEqual({});
  });
  it("shrinking array -> values + previous", () => {
    const r = buildStateChange("task", { verification_evidence: [1, 2] }, { verification_evidence: [1] });
    expect(r.values.verification_evidence).toEqual([1]);
  });
  it("ignores non-working-state keys", () => {
    const r = buildStateChange("adr", { claim: 1 }, { claim: 2 });
    expect(r.keys).toEqual([]);
  });
  it("key order insensitive equality yields no change", () => {
    const r = buildStateChange("task", { landing: { a: 1, b: 2 } }, { landing: { b: 2, a: 1 } });
    expect(r.keys).toEqual([]);
  });
});
