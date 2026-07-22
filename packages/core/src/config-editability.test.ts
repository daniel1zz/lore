/**
 * Tests for `@lore/core` config write-safety tables (`config-editability.ts`,
 * SPEC-062 §Scope D2 + task T4 "deny-check ancestor-subtree coverage").
 * Colocated per this package's `packages/core/src/*.test.ts` convention — this
 * module previously had NO dedicated test file, only indirect coverage via
 * `packages/lore/tests/unit/service/config-service.test.ts` (still asserted
 * green by this task's oracle list, kept as a regression backstop).
 *
 * Six-dimension coverage across all four exports:
 *   HAPPY:      exact-leaf denials still fire for every CONFIG_DENY_KEYS entry;
 *               classifyConfigEffect / flattenConfigLeafPaths / redactConfigValues
 *               happy paths.
 *   NEGATIVE:   benign sibling patches yield exactly 0 denied keys — including a
 *               deliberately over-broad naive-`startsWith` matcher shown FIRST to
 *               fail this exact assertion, proving segment-wise (not string-prefix)
 *               comparison is load-bearing for the ancestor rule.
 *   BOUNDARY:   MAX_WALK_DEPTH cap, empty object as leaf, array as leaf, non-object
 *               top level, `{}` patch.
 *   ERROR:      malformed/untrusted input (null, undefined, primitives, deeply
 *               nested) never throws.
 *   STATE:      redactConfigValues never mutates its input.
 *   REGRESSION: the pre-existing whole-ancestor-WITH-leaves case still denies the
 *               deep leaf; classifyConfigEffect's prefix table is unchanged.
 *
 * @spec_ref SPEC-062 (config write layer) — AC-062-12
 */

import { describe, it, expect } from "vitest";
import {
  CONFIG_DENY_KEYS,
  CONFIG_REDACT_KEYS,
  CONFIG_REDACTION_MARKER,
  classifyConfigEffect,
  findDeniedConfigKeys,
  flattenConfigLeafPaths,
  redactConfigValues,
} from "./config-editability.js";

// ─── findDeniedConfigKeys — HAPPY: exact-leaf denial (unchanged behaviour) ───

describe("findDeniedConfigKeys — HAPPY: exact-leaf denial for every CONFIG_DENY_KEYS entry", () => {
  it("denies ai.providers.<name>.command", () => {
    expect(findDeniedConfigKeys({ ai: { providers: { foo: { command: "evil" } } } })).toEqual([
      "ai.providers.foo.command",
    ]);
  });

  it("denies ai.providers.<name>.args", () => {
    expect(findDeniedConfigKeys({ ai: { providers: { foo: { args: ["x"] } } } })).toEqual([
      "ai.providers.foo.args",
    ]);
  });

  it("denies ai.http.headers.<name>", () => {
    expect(findDeniedConfigKeys({ ai: { http: { headers: { "x-api-key": "sk-live" } } } })).toEqual([
      "ai.http.headers.x-api-key",
    ]);
  });

  it("denies verify.env.passthrough_all", () => {
    expect(findDeniedConfigKeys({ verify: { env: { passthrough_all: true } } })).toEqual([
      "verify.env.passthrough_all",
    ]);
  });

  it("denies defaults.editor", () => {
    expect(findDeniedConfigKeys({ defaults: { editor: "/tmp/evil.sh" } })).toEqual(["defaults.editor"]);
  });

  it("CONFIG_DENY_KEYS declares exactly the 5 documented patterns", () => {
    expect([...CONFIG_DENY_KEYS].sort()).toEqual(
      [
        "ai.http.headers.*",
        "ai.providers.*.args",
        "ai.providers.*.command",
        "verify.env.passthrough_all",
        "defaults.editor",
      ].sort(),
    );
  });
});

// ─── findDeniedConfigKeys — AC-062-13: defaults.editor (deferred-execution RCE) ──

describe("findDeniedConfigKeys — AC-062-13: defaults.editor deny-key", () => {
  it("HAPPY: {defaults:{editor:'/tmp/evil.sh'}} denies exactly ['defaults.editor']", () => {
    expect(findDeniedConfigKeys({ defaults: { editor: "/tmp/evil.sh" } })).toEqual(["defaults.editor"]);
  });

  it("NEGATIVE: {defaults:{format:'json'}} — inert sibling key, exactly 0 denied", () => {
    expect(findDeniedConfigKeys({ defaults: { format: "json" } })).toEqual([]);
  });

  it("NEGATIVE: {defaults:{color:false}} — inert sibling key, exactly 0 denied", () => {
    expect(findDeniedConfigKeys({ defaults: { color: false } })).toEqual([]);
  });

  it("NEGATIVE: a patch touching both inert siblings together still denies 0", () => {
    expect(findDeniedConfigKeys({ defaults: { format: "json", color: true } })).toEqual([]);
  });

  it("BOUNDARY (ancestor): {defaults:null} — proper ancestor of defaults.editor, denied", () => {
    const denied = findDeniedConfigKeys({ defaults: null });
    expect(denied).toContain("defaults");
  });

  it("BOUNDARY (ancestor): {defaults:{}} — empty-object-is-a-leaf branch, denied", () => {
    const denied = findDeniedConfigKeys({ defaults: {} });
    expect(denied).toContain("defaults");
  });
});

// ─── findDeniedConfigKeys — AC-062-12: proper-ancestor subtree-root denial ──

describe("findDeniedConfigKeys — AC-062-12: proper-ancestor subtree-root denial", () => {
  it("denies {ai: {providers: null}} — leaf shorter than ai.providers.*.command/.args", () => {
    const denied = findDeniedConfigKeys({ ai: { providers: null } });
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(denied).toContain("ai.providers");
  });

  it("denies {ai: {providers: {}}} — empty-object-is-a-leaf branch", () => {
    const denied = findDeniedConfigKeys({ ai: { providers: {} } });
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(denied).toContain("ai.providers");
  });

  it("denies {ai: {providers: []}} — arrays are leaves by invariant", () => {
    const denied = findDeniedConfigKeys({ ai: { providers: [] } });
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(denied).toContain("ai.providers");
  });

  it("denies {verify: {env: null}} — leaf shorter than verify.env.passthrough_all", () => {
    const denied = findDeniedConfigKeys({ verify: { env: null } });
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(denied).toContain("verify.env");
  });

  it("denies {ai: null} — wholesale subtree replacement, the documented deliberate widening", () => {
    const denied = findDeniedConfigKeys({ ai: null });
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(denied).toContain("ai");
  });
});

// ─── findDeniedConfigKeys — NEGATIVE: scope guard, benign siblings stay 0 ───

describe("findDeniedConfigKeys — NEGATIVE: benign sibling patches yield exactly 0", () => {
  it("{ai: {provider: 'cli'}} — sibling scalar field, not ai.providers", () => {
    expect(findDeniedConfigKeys({ ai: { provider: "cli" } })).toEqual([]);
  });

  it("{ai: {http: {timeout_ms: 1000}}} — sibling leaf under ai.http, not ai.http.headers.*", () => {
    expect(findDeniedConfigKeys({ ai: { http: { timeout_ms: 1000 } } })).toEqual([]);
  });

  it("{workflow: {claim_ttl_minutes: 30}} — unrelated top-level key", () => {
    expect(findDeniedConfigKeys({ workflow: { claim_ttl_minutes: 30 } })).toEqual([]);
  });

  it("{sync: {enabled: true}} — unrelated top-level key", () => {
    expect(findDeniedConfigKeys({ sync: { enabled: true } })).toEqual([]);
  });

  it("proves segment-wise comparison is load-bearing: a naive dotted-string startsWith matcher WOULD wrongly deny ai.provider", () => {
    // A too-greedy ancestor rule implemented as a plain RAW-STRING
    // `pattern.startsWith(path)` (no segment-boundary awareness) treats
    // "ai.provider" as a character-level prefix of "ai.providers.*.command"
    // — the characters "ai.provider" ARE the first 11 characters of
    // "ai.providers.*.command", with no `.` separator enforced between them
    // — and would wrongly deny it. This is exactly the failure mode the task
    // doc warns against. Assert the naive matcher gets this case WRONG first
    // (red), then assert the real segment-wise implementation gets it right.
    const naiveOverBroadDenied = (path: string): boolean =>
      CONFIG_DENY_KEYS.some((pattern) => pattern.startsWith(path));
    expect(naiveOverBroadDenied("ai.provider")).toBe(true); // the naive matcher gets this WRONG
    expect(findDeniedConfigKeys({ ai: { provider: "cli" } })).toEqual([]); // the real implementation gets it right
  });
});

// ─── findDeniedConfigKeys — REGRESSION: whole-ancestor-WITH-leaves case ─────

describe("findDeniedConfigKeys — REGRESSION: whole-ancestor patch with nested leaves", () => {
  it("still denies the deep leaf when the patch replaces a whole ancestor object with content", () => {
    expect(findDeniedConfigKeys({ ai: { providers: { foo: { command: "evil" } } } })).toEqual([
      "ai.providers.foo.command",
    ]);
  });

  it("multiple denied leaves are sorted and deduplicated", () => {
    const denied = findDeniedConfigKeys({
      ai: {
        providers: { foo: { command: "evil", args: ["x"] } },
        http: { headers: { "x-api-key": "v" } },
      },
      verify: { env: { passthrough_all: true } },
    });
    expect(denied).toEqual([...denied].sort());
    expect(new Set(denied).size).toBe(denied.length);
    expect(denied).toEqual(
      [
        "ai.http.headers.x-api-key",
        "ai.providers.foo.args",
        "ai.providers.foo.command",
        "verify.env.passthrough_all",
      ].sort(),
    );
  });
});

// ─── flattenConfigLeafPaths ──────────────────────────────────────────────────

describe("flattenConfigLeafPaths", () => {
  it("HAPPY: collects sorted, deduplicated leaf paths from a nested plain object", () => {
    expect(
      flattenConfigLeafPaths({ sync: { enabled: true }, workflow: { claim_ttl_minutes: 30 } }),
    ).toEqual(["sync.enabled", "workflow.claim_ttl_minutes"]);
  });

  it("BOUNDARY: an empty object at the top level yields no leaves", () => {
    expect(flattenConfigLeafPaths({})).toEqual([]);
  });

  it("BOUNDARY: an empty object NESTED under a key is itself a leaf", () => {
    expect(flattenConfigLeafPaths({ ai: { providers: {} } })).toEqual(["ai.providers"]);
  });

  it("BOUNDARY: an array is a leaf, never descended into", () => {
    expect(flattenConfigLeafPaths({ ai: { providers: { foo: { args: ["a", "b"] } } } })).toEqual([
      "ai.providers.foo.args",
    ]);
  });

  it("BOUNDARY: a non-object top-level value yields no leaves", () => {
    expect(flattenConfigLeafPaths("just a string")).toEqual([]);
    expect(flattenConfigLeafPaths(42)).toEqual([]);
    expect(flattenConfigLeafPaths(true)).toEqual([]);
  });

  it("BOUNDARY: recursion is capped at MAX_WALK_DEPTH (32) — a maliciously deep object is treated as an opaque leaf, never throws/hangs", () => {
    // Build an object nested 40 levels deep (past the 32 cap).
    type Nested = { child?: Nested; value?: string };
    let deep: Nested = { value: "bottom" };
    for (let i = 0; i < 40; i++) {
      deep = { child: deep };
    }
    const leaves = flattenConfigLeafPaths({ deep });
    expect(leaves.length).toBe(1);
    const [onlyLeaf] = leaves;
    expect(onlyLeaf).toBeDefined();
    expect(onlyLeaf?.startsWith("deep.")).toBe(true);
    expect((onlyLeaf ?? "").split(".").length).toBeLessThanOrEqual(33); // capped, not 41 segments deep
  });

  it("ERROR: null and undefined never throw and yield no leaves at the top level", () => {
    expect(() => flattenConfigLeafPaths(null)).not.toThrow();
    expect(flattenConfigLeafPaths(null)).toEqual([]);
    expect(() => flattenConfigLeafPaths(undefined)).not.toThrow();
    expect(flattenConfigLeafPaths(undefined)).toEqual([]);
  });

  it("ERROR: null/undefined nested under a key are leaves, never throw", () => {
    expect(() => flattenConfigLeafPaths({ ai: null })).not.toThrow();
    expect(flattenConfigLeafPaths({ ai: null })).toEqual(["ai"]);
    expect(flattenConfigLeafPaths({ ai: { providers: undefined } })).toEqual(["ai.providers"]);
  });
});

// ─── findDeniedConfigKeys / flattenConfigLeafPaths — ERROR: malformed input ─

describe("findDeniedConfigKeys — ERROR: malformed/untrusted input never throws", () => {
  it("primitives and null/undefined all resolve to zero denials without throwing", () => {
    for (const bad of [null, undefined, "string", 42, true, [1, 2, 3]]) {
      expect(() => findDeniedConfigKeys(bad)).not.toThrow();
      expect(findDeniedConfigKeys(bad)).toEqual([]);
    }
  });

  it("a deeply nested malicious patch never throws (capped by MAX_WALK_DEPTH)", () => {
    type Nested = { child?: Nested };
    let deep: Nested = {};
    for (let i = 0; i < 50; i++) {
      deep = { child: deep };
    }
    expect(() => findDeniedConfigKeys(deep)).not.toThrow();
  });
});

// ─── redactConfigValues ───────────────────────────────────────────────────────

describe("redactConfigValues", () => {
  it("HAPPY: replaces a CONFIG_REDACT_KEYS-matching leaf value with the fixed marker", () => {
    expect(redactConfigValues({ ai: { http: { headers: { "x-api-key": "sk-live-123" } } } })).toEqual(
      { ai: { http: { headers: { "x-api-key": CONFIG_REDACTION_MARKER } } } },
    );
  });

  it("HAPPY: leaves non-matching values untouched", () => {
    expect(redactConfigValues({ workflow: { claim_ttl_minutes: 30 } })).toEqual({
      workflow: { claim_ttl_minutes: 30 },
    });
  });

  it("CONFIG_REDACT_KEYS declares exactly the documented pattern", () => {
    expect([...CONFIG_REDACT_KEYS]).toEqual(["ai.http.headers.*"]);
  });

  it("BOUNDARY: a non-object top-level config is returned unchanged", () => {
    expect(redactConfigValues("not an object")).toBe("not an object");
    expect(redactConfigValues(42)).toBe(42);
    expect(redactConfigValues(null)).toBe(null);
  });

  it("ERROR: malformed/untrusted input never throws", () => {
    for (const bad of [null, undefined, "string", 42, true, [1, 2, 3]]) {
      expect(() => redactConfigValues(bad)).not.toThrow();
    }
  });

  it("STATE: never mutates its input — the original object is structurally unchanged after the call", () => {
    const original = { ai: { http: { headers: { "x-api-key": "sk-live-123" } } } };
    const snapshotBefore = JSON.parse(JSON.stringify(original));
    const redacted = redactConfigValues(original);
    expect(original).toEqual(snapshotBefore); // input untouched
    expect(redacted).not.toBe(original); // a distinct object was returned
    expect((redacted as typeof original).ai.http.headers["x-api-key"]).toBe(CONFIG_REDACTION_MARKER);
    expect(original.ai.http.headers["x-api-key"]).toBe("sk-live-123"); // original value survives
  });

  it("STATE: ancestor objects on the redaction path are cloned, not aliased", () => {
    const original = { ai: { http: { headers: { "x-api-key": "secret" } } } };
    const redacted = redactConfigValues(original) as typeof original;
    expect(redacted.ai).not.toBe(original.ai);
    expect(redacted.ai.http).not.toBe(original.ai.http);
    expect(redacted.ai.http.headers).not.toBe(original.ai.http.headers);
  });
});

// ─── classifyConfigEffect ─────────────────────────────────────────────────────

describe("classifyConfigEffect", () => {
  it("HAPPY: sync.* is restart_required", () => {
    expect(classifyConfigEffect("sync.enabled")).toBe("restart_required");
  });

  it("HAPPY: workflow.* is live", () => {
    expect(classifyConfigEffect("workflow.claim_ttl_minutes")).toBe("live");
  });

  it("REGRESSION: the declared prefix table is unchanged — ai.provider/ai.providers./ai.http./telemetry. all restart_required", () => {
    expect(classifyConfigEffect("ai.provider")).toBe("restart_required");
    expect(classifyConfigEffect("ai.providers.foo.model")).toBe("restart_required");
    expect(classifyConfigEffect("ai.http.timeout_ms")).toBe("restart_required");
    expect(classifyConfigEffect("telemetry.enabled")).toBe("restart_required");
  });

  it("REGRESSION: everything else — audit.*/verify.*/defaults.* — stays live", () => {
    expect(classifyConfigEffect("audit.verify_since")).toBe("live");
    expect(classifyConfigEffect("verify.default_timeout_ms")).toBe("live");
    expect(classifyConfigEffect("defaults.claim_ttl_minutes")).toBe("live");
  });

  it("BOUNDARY: an empty string key resolves to live (matches no prefix)", () => {
    expect(classifyConfigEffect("")).toBe("live");
  });
});
