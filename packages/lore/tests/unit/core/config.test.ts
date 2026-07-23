/**
 * @spec_ref AC-CORE-CONFIG (SPEC-009 §6)
 *
 * RED test suite for src/core/config.ts (LoreConfig Zod schema + YAML config loading).
 * The implementation does NOT exist yet. All tests in this file MUST FAIL with
 * "Cannot find module '@core/config'" until the implementation is provided.
 *
 * Spec behaviors under test (derived from SPEC-009 §6, NOT from implementation):
 * - LoreConfigSchema: strict Zod schema; unknown top-level keys are rejected
 * - project section is required; sync section is optional (local-only mode)
 * - sync section: when enabled=true, remote_url MUST be present (D-007)
 * - auth_token_env is a string (env var NAME); plaintext tokens NEVER allowed (D-004)
 * - sync.interval MUST be a positive integer (> 0, no floats)
 * - parseConfig(raw): Result<LoreConfig, LoreError> — schema validation via Zod
 * - loadConfigFromString(yaml): Result<LoreConfig, LoreError> — YAML parse + schema
 *   - malformed YAML → {ok:false, error.code === 'VALIDATION_ERROR'} (no throw)
 *
 * Test plan:
 * HAPPY: local-only config, full sync config, sync disabled with no remote_url
 * NEGATIVE: missing remote_url when enabled, interval=0, interval=-1, unknown keys
 * BOUNDARY: interval as float, missing auth_token_env in sync section
 * ERROR: malformed YAML input to loadConfigFromString
 * STATE: N/A — stateless pure functions
 * REGRESSION: N/A — no known regressions pre-implementation
 */

import { describe, it, expect } from "vitest";
// These imports will fail until src/core/config.ts is created.
// That failure is the intended RED state.
import {
  LoreConfigSchema,
  parseConfig,
  loadConfigFromString,
  isAiConfigValidationError,
  type LoreConfig,
} from "@lore/core";
import type { LoreError } from "@lore/core";

// ---------------------------------------------------------------------------
// HAPPY PATH
// ---------------------------------------------------------------------------

describe("LoreConfigSchema — happy path", () => {
  it("accepts config with project only (no sync) — local-only mode", () => {
    const raw = {
      project: {
        name: "lore",
        author: "owner",
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sync).toBeUndefined();
    }
  });

  it("accepts config with full sync section — all fields typed", () => {
    const raw = {
      project: {
        name: "lore",
        author: "owner",
      },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 60,
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      const data: LoreConfig = result.data;
      expect(data.project.name).toBe("lore");
      expect(data.project.author).toBe("owner");
      expect(data.sync?.enabled).toBe(true);
      expect(data.sync?.remote_url).toBe("libsql://lore-db-xxx.turso.io");
      expect(data.sync?.auth_token_env).toBe("LORE_SYNC_TOKEN");
      expect(data.sync?.interval).toBe(60);
    }
  });

  it("accepts sync with enabled=false and no remote_url (disabled remote)", () => {
    // When sync is present but disabled, remote_url absence should be allowed
    // per D-007: enabled=true + remote_url present → TursoStore; disabled means local
    const raw = {
      project: {
        name: "lore",
        author: "owner",
      },
      sync: {
        enabled: false,
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 30,
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it("accepts sync.interval at minimum valid boundary (1)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 1,
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });
});

describe("parseConfig() — happy path", () => {
  it("returns {ok:true, value} for valid local-only raw config", () => {
    const raw = {
      project: { name: "my-project", author: "alice" },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.project.name).toBe("my-project");
      expect(result.value.project.author).toBe("alice");
      expect(result.value.sync).toBeUndefined();
    }
  });

  it("returns {ok:true, value} for valid full config — two different inputs produce different outputs", () => {
    const raw = {
      project: { name: "project-b", author: "bob" },
      sync: {
        enabled: true,
        remote_url: "libsql://project-b.turso.io",
        auth_token_env: "PROJECT_B_TOKEN",
        interval: 120,
      },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.project.name).toBe("project-b");
      expect(result.value.sync?.interval).toBe(120);
    }
  });
});

describe("loadConfigFromString() — happy path", () => {
  it("parses valid YAML and returns {ok:true, value}", () => {
    const yamlText = `
project:
  name: "lore"
  author: "owner"
sync:
  remote_url: "libsql://lore-db-xxx.turso.io"
  auth_token_env: "LORE_SYNC_TOKEN"
  interval: 60
  enabled: true
`.trim();

    const result = loadConfigFromString(yamlText);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.project.name).toBe("lore");
      expect(result.value.sync?.remote_url).toBe(
        "libsql://lore-db-xxx.turso.io"
      );
    }
  });

  it("parses local-only YAML (no sync key) and returns valid config", () => {
    const yamlText = `
project:
  name: "local-only"
  author: "tester"
`.trim();

    const result = loadConfigFromString(yamlText);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.project.name).toBe("local-only");
      expect(result.value.sync).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE CASES
// ---------------------------------------------------------------------------

describe("LoreConfigSchema — negative cases (SPEC-009 §6, D-004, D-007)", () => {
  it("rejects sync.enabled=true with missing remote_url (D-007 invariant)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        // remote_url intentionally missing
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 60,
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects sync.interval=0 (must be positive integer)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 0,
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects sync.interval=-1 (must be positive integer)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: -1,
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects config with unknown top-level key (strict schema)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      unknown_key: "should-not-be-here",
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects config missing project section", () => {
    const raw = {
      sync: {
        enabled: false,
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 60,
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects config with missing project.name", () => {
    const raw = {
      project: { author: "owner" },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects config with missing project.author", () => {
    const raw = {
      project: { name: "lore" },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });
});

describe("parseConfig() — negative cases", () => {
  it("returns {ok:false, error} for raw config with enabled=true and no remote_url", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 60,
      },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Must fail loud — not a silent null/undefined return
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns {ok:false, error} for invalid interval=0", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 0,
      },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns {ok:false, error} for unknown top-level keys", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      extra_field: "forbidden",
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY VALUES
// ---------------------------------------------------------------------------

describe("LoreConfigSchema — boundary values", () => {
  it("rejects sync.interval as float (non-integer)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 60.5,
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("accepts sync.interval=1 (positive integer minimum boundary)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 1,
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it("rejects sync.interval=0.9 (below 1, non-integer)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 0.9,
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects sync section with unknown keys (strict nested schema)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: false,
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 30,
        unexpected_field: "bad",
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ERROR HANDLING — loadConfigFromString with malformed YAML
// ---------------------------------------------------------------------------

describe("loadConfigFromString() — error handling (SPEC-009 §6)", () => {
  it("returns {ok:false, error} with code VALIDATION_ERROR for malformed YAML — does NOT throw", () => {
    const malformedYaml = `
project:
  name: "lore"
  author: [unclosed bracket
  bad: : : colon
`.trim();

    let result: ReturnType<typeof loadConfigFromString>;
    expect(() => {
      result = loadConfigFromString(malformedYaml);
    }).not.toThrow();

    result = loadConfigFromString(malformedYaml);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns {ok:false, error} with code VALIDATION_ERROR for empty string input", () => {
    const result = loadConfigFromString("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns {ok:false, error} for YAML that parses but fails schema validation", () => {
    const yamlWithUnknownKey = `
project:
  name: "lore"
  author: "owner"
not_a_real_key: "surprise"
`.trim();

    const result = loadConfigFromString(yamlWithUnknownKey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("does NOT throw for YAML with tab characters (common YAML mistake)", () => {
    const tabYaml = "project:\n\tname: lore\n\tauthor: owner";
    expect(() => loadConfigFromString(tabYaml)).not.toThrow();
    const result = loadConfigFromString(tabYaml);
    // tabs in YAML are invalid — should return error, not crash
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION — Default value locks (phase-0 gate fix, SPEC-009 §6)
// ---------------------------------------------------------------------------

describe("LoreConfigSchema — default value regression (SPEC-009 §6)", () => {
  it("defaults sync.interval to 60 when interval is omitted (SPEC-009 §6)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        // interval intentionally omitted — must default to 60
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sync?.interval).toBe(60);
    }
  });

  it("parseConfig defaults sync.interval to 60 when interval is omitted", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        // interval intentionally omitted — must default to 60
      },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sync?.interval).toBe(60);
    }
  });

  it("defaults sync.auth_token_env to 'LORE_SYNC_TOKEN' when auth_token_env is omitted (D-004)", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        interval: 30,
        // auth_token_env intentionally omitted — must default to 'LORE_SYNC_TOKEN'
      },
    };
    const result = LoreConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sync?.auth_token_env).toBe("LORE_SYNC_TOKEN");
    }
  });
});

// ---------------------------------------------------------------------------
// SPEC-030 AC-HJ-3 — `ai` block fail-loud classification
//
// Spec-first note: the observed real-world regression was a typo'd `ai.cli` key
// silently reverting `ai.assess.max_diff_chars` (80000 -> 24000) and every provider
// `timeout_ms` (180000 -> 60000) to schema defaults with ZERO warning, because the
// whole LoreConfigSchema.strict() parse failed and callers fell back to `undefined`.
// The fix must (1) still allow an absent `ai:` key entirely (that is NOT the bug —
// the bug is a malformed-but-present `ai:` block), (2) name the exact offending
// dotted path plus a "did you mean ai.providers.<name>?" hint for unrecognized keys,
// and (3) classify `ai`-scoped violations via isAiConfigValidationError so callers
// (loadLoreApp) can choose to fail loud instead of silently falling back.
// ---------------------------------------------------------------------------

describe("SPEC-030 AC-HJ-3 — ai config fail-loud — HAPPY", () => {
  it("a config with no `ai:` key at all still parses ok:true (absence must remain valid)", () => {
    const raw = { project: { name: "lore", author: "owner" } };
    const result = parseConfig(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ai).toBeUndefined();
    }
  });

  it("a config with `ai: {}` (empty object) parses ok:true with schema defaults filled in", () => {
    const raw = { project: { name: "lore", author: "owner" }, ai: {} };
    const result = parseConfig(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // AiConfigSchema.parse({}) default provider is "claude-cli" (packages/core/src/ai.ts)
      expect(result.value.ai?.provider).toBe("claude-cli");
      expect(result.value.ai?.providers).toEqual({});
    }
  });

  it("a fully-valid non-trivial `ai` block (provider + a providers override) parses ok:true", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      ai: {
        provider: "claude-cli",
        providers: { "claude-cli": { command: "claude", args: ["-p"] } },
      },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ai?.provider).toBe("claude-cli");
      expect(result.value.ai?.providers["claude-cli"]?.command).toBe("claude");
      // timeout_ms is not supplied — schema default must still apply. SPEC-067 D1
      // raised this default 60_000 -> 180_000 (a real `lore assess` judge round
      // measures ~73s under normal load).
      expect(result.value.ai?.providers["claude-cli"]?.timeout_ms).toBe(180_000);
    }
  });
});

describe("SPEC-030 AC-HJ-3 — ai config fail-loud — NEGATIVE", () => {
  it("an unknown top-level key directly under `ai:` (the real observed bug) → ok:false with field/message/hint", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      ai: { cli: "bogus" },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ai.cli");
    expect(result.error.message).toContain("ai.cli");
    expect(result.error.message).toContain("unrecognized key");
    expect(result.error.message).toContain("ai.providers.<name>");
    expect(isAiConfigValidationError(result.error)).toBe(true);
  });
});

describe("SPEC-030 AC-HJ-3 — ai config fail-loud — BOUNDARY", () => {
  it("a type error nested inside ai.providers.<name> → ok:false, field starts with 'ai.providers.'", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      ai: {
        providers: { "claude-cli": { command: "claude", timeout_ms: "not-a-number" } },
      },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field.startsWith("ai.providers.")).toBe(true);
    expect(isAiConfigValidationError(result.error)).toBe(true);
  });

  it("the ai.http cross-field superRefine constraint (provider:'http' with no http block) is classified ai-scoped too — proves the classifier isn't narrowly tied to unrecognized_keys issues", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      ai: { provider: "http" },
      // ai.http intentionally omitted — triggers the ZodIssueCode.custom superRefine, NOT unrecognized_keys
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ai.http");
    expect(isAiConfigValidationError(result.error)).toBe(true);
  });
});

describe("SPEC-030 AC-HJ-3 — ai config fail-loud — ERROR (never-throws robustness)", () => {
  it("multiple simultaneous ai-block violations never throw", () => {
    expect(() =>
      parseConfig({
        project: { name: "x", author: "y" },
        ai: { cli: "bogus", provider: 123, providers: "not-an-object" },
      }),
    ).not.toThrow();
  });

  it("isAiConfigValidationError on a non-VALIDATION_ERROR LoreError never throws and returns false", () => {
    const storeError: LoreError = { code: "STORE_ERROR", message: "disk full" };
    expect(() => isAiConfigValidationError(storeError)).not.toThrow();
    expect(isAiConfigValidationError(storeError)).toBe(false);
  });

  it("isAiConfigValidationError on a VALIDATION_ERROR with an unrelated field returns false without throwing", () => {
    const unrelated: LoreError = {
      code: "VALIDATION_ERROR",
      field: "sync.enabled",
      message: "Sync is not enabled",
    };
    expect(() => isAiConfigValidationError(unrelated)).not.toThrow();
    expect(isAiConfigValidationError(unrelated)).toBe(false);
  });
});

describe("SPEC-030 AC-HJ-3 — ai config fail-loud — STATE (issue-selection priority)", () => {
  it("when project AND ai both have violations, parseConfig picks the ai-scoped issue, not the project one (which sorts first in Zod's issues array)", () => {
    const raw = {
      // project.author missing — Zod lists this issue first (project is declared
      // before ai in LoreConfigSchema's key order).
      project: { name: "x" },
      ai: { cli: "bogus" },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field.startsWith("ai")).toBe(true);
    expect(result.error.field.startsWith("project")).toBe(false);
  });
});

describe("SPEC-030 AC-HJ-3 — ai config fail-loud — REGRESSION", () => {
  it("unknown top-level key OUTSIDE ai is unaffected — still ok:false, but NOT classified as an ai error", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      extra_field: "forbidden",
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).not.toBe("ai");
    expect(result.error.field.startsWith("ai.")).toBe(false);
    expect(isAiConfigValidationError(result.error)).toBe(false);
  });

  it("pre-existing sync-section violations (enabled=true, no remote_url) still return ok:false", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: { enabled: true, auth_token_env: "LORE_SYNC_TOKEN", interval: 60 },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
  });

  it("pre-existing sync-section violation (interval=0) still returns ok:false", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 0,
      },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(false);
  });

  it("a fully valid ai block combined with a fully valid sync/telemetry/workflow section still parses ok:true end-to-end", () => {
    const raw = {
      project: { name: "lore", author: "owner" },
      ai: { provider: "claude-cli", providers: { "claude-cli": { command: "claude", args: [] } } },
      sync: {
        enabled: true,
        remote_url: "libsql://lore-db-xxx.turso.io",
        auth_token_env: "LORE_SYNC_TOKEN",
        interval: 60,
      },
      telemetry: { enabled: true },
      workflow: { claim_ttl_minutes: 90 },
    };
    const result = parseConfig(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ai?.provider).toBe("claude-cli");
      expect(result.value.sync?.enabled).toBe(true);
      expect(result.value.workflow?.claim_ttl_minutes).toBe(90);
    }
  });
});

// ---------------------------------------------------------------------------
// STATE — N/A: stateless pure functions
// ---------------------------------------------------------------------------
