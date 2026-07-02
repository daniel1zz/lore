/**
 * Unit tests for resolveEnvInHeaders (SPEC-020 §2.1, §8 Q3, §9.2).
 *
 * Spec-first expectations (from SPEC-020 and env-resolve.ts invariants):
 *   - Literal header values pass through unchanged
 *   - Values matching `^\$\{([A-Z_][A-Z0-9_]*)\}$` are substituted from env
 *   - Missing env var → VALIDATION_ERROR (fail loud, AC-HTTP-3)
 *   - Empty env var → VALIDATION_ERROR (treated as unset — D-004 guard)
 *   - Partial match (e.g. "prefix_${VAR}") is treated as literal (no resolution)
 *   - Lowercase variable name (e.g. `${foo}`) is NOT matched — pattern requires uppercase
 *   - error.field contains the header key path for diagnosis
 *   - error.message names the env var (NOT its value — D-004)
 *
 * Adversarial focus:
 *   - Empty string env var must be rejected (not silently treated as "set")
 *   - Partial pattern must NOT trigger substitution
 *   - Lowercase pattern must NOT trigger substitution
 *   - Error must name the VAR, not leak any value
 *
 * @spec_ref AC-HTTP-3
 */

import { describe, it, expect } from "vitest";
import { resolveEnvInHeaders } from "../../../src/ai/env-resolve.js";

// ─── Literal values pass through unchanged ────────────────────────────────────

describe("resolveEnvInHeaders — literal values", () => {
  it("passes through a single literal header value unchanged", () => {
    const result = resolveEnvInHeaders({ "content-type": "application/json" }, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value["content-type"]).toBe("application/json");
  });

  it("passes through multiple literal header values unchanged", () => {
    const result = resolveEnvInHeaders(
      {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        accept: "application/json",
      },
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value["content-type"]).toBe("application/json");
    expect(result.value["anthropic-version"]).toBe("2023-06-01");
    expect(result.value["accept"]).toBe("application/json");
  });

  it("returns ok for empty headers map", () => {
    const result = resolveEnvInHeaders({}, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value).toEqual({});
  });
});

// ─── Env-var substitution ─────────────────────────────────────────────────────

describe("resolveEnvInHeaders — env-var substitution", () => {
  it("resolves ${VAR} when env var is set", () => {
    const result = resolveEnvInHeaders(
      { "x-api-key": "${ANTHROPIC_API_KEY}" },
      { ANTHROPIC_API_KEY: "sk-ant-real-key" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value["x-api-key"]).toBe("sk-ant-real-key");
  });

  it("resolves mixed headers: literal stays literal, env-var gets substituted", () => {
    const result = resolveEnvInHeaders(
      {
        "x-api-key": "${ANTHROPIC_API_KEY}",
        "anthropic-version": "2023-06-01",
        "x-secret": "${MY_SECRET_TOKEN}",
      },
      { ANTHROPIC_API_KEY: "sk-ant-aaa", MY_SECRET_TOKEN: "tok-bbb" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value["x-api-key"]).toBe("sk-ant-aaa");
    expect(result.value["anthropic-version"]).toBe("2023-06-01");
    expect(result.value["x-secret"]).toBe("tok-bbb");
  });

  it("resolves different env-var values correctly for different headers", () => {
    // Anti-tautology: ensure different vars produce different resolved values
    const result = resolveEnvInHeaders(
      { "header-a": "${VAR_A}", "header-b": "${VAR_B}" },
      { VAR_A: "value-alpha", VAR_B: "value-beta" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value["header-a"]).toBe("value-alpha");
    expect(result.value["header-b"]).toBe("value-beta");
    expect(result.value["header-a"]).not.toBe(result.value["header-b"]);
  });

  it("resolves ${_UNDERSCORE_PREFIXED} variable (valid pattern starts with _)", () => {
    const result = resolveEnvInHeaders(
      { auth: "${_MY_PRIVATE_TOKEN}" },
      { _MY_PRIVATE_TOKEN: "underscore-value" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value["auth"]).toBe("underscore-value");
  });
});

// ─── Missing env var → VALIDATION_ERROR (AC-HTTP-3) ─────────────────────────

describe("resolveEnvInHeaders — missing env var (AC-HTTP-3)", () => {
  it("returns err when env var is not set", () => {
    const result = resolveEnvInHeaders({ "x-api-key": "${MISSING_VAR}" }, {});
    expect(result.ok).toBe(false);
  });

  it("error has code VALIDATION_ERROR (not AI_PROVIDER_ERROR or other code)", () => {
    const result = resolveEnvInHeaders({ "x-api-key": "${MISSING_VAR}" }, {});
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("error field contains the header key path (ai.http.headers.<key>)", () => {
    const result = resolveEnvInHeaders({ "x-api-key": "${MISSING_VAR}" }, {});
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "VALIDATION_ERROR") throw new Error("Expected VALIDATION_ERROR");
    expect(result.error.field).toBe("ai.http.headers.x-api-key");
  });

  it("error message names the missing env var (not some generic message)", () => {
    const result = resolveEnvInHeaders({ auth: "${MY_SPECIFIC_TOKEN}" }, {});
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "VALIDATION_ERROR") throw new Error("Expected VALIDATION_ERROR");
    expect(result.error.message).toContain("MY_SPECIFIC_TOKEN");
  });

  it("error field path matches the actual header key name", () => {
    // Different header key → different field path
    const result = resolveEnvInHeaders({ "authorization": "${BEARER_TOKEN}" }, {});
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "VALIDATION_ERROR") throw new Error("Expected VALIDATION_ERROR");
    expect(result.error.field).toBe("ai.http.headers.authorization");
  });

  it("fails on the first missing var even when other headers are valid", () => {
    // Fail-fast: returns the first VALIDATION_ERROR, does not collect all
    const result = resolveEnvInHeaders(
      {
        "anthropic-version": "2023-06-01", // literal — OK
        "x-api-key": "${MISSING_KEY}",    // missing → error
        "x-other": "${ALSO_MISSING}",     // not reached due to fail-fast
      },
      {},
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
    // Fail-fast means MISSING_KEY error is returned (first env-var header hit)
    if (result.error.code !== "VALIDATION_ERROR") throw new Error("Expected VALIDATION_ERROR");
    expect(result.error.field).toContain("x-api-key");
  });
});

// ─── Empty string env var treated as missing (D-004 guard) ───────────────────

describe("resolveEnvInHeaders — empty env var treated as unset", () => {
  it("returns VALIDATION_ERROR when env var is empty string", () => {
    // Empty string must NOT be silently accepted — avoids misconfigured env passing unnoticed
    const result = resolveEnvInHeaders(
      { "x-api-key": "${ANTHROPIC_API_KEY}" },
      { ANTHROPIC_API_KEY: "" },
    );
    expect(result.ok).toBe(false);
  });

  it("empty env var error has code VALIDATION_ERROR", () => {
    const result = resolveEnvInHeaders(
      { auth: "${EMPTY_VAR}" },
      { EMPTY_VAR: "" },
    );
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("empty env var error message names the var (not its empty value)", () => {
    const result = resolveEnvInHeaders(
      { auth: "${EMPTY_TOKEN}" },
      { EMPTY_TOKEN: "" },
    );
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "VALIDATION_ERROR") throw new Error("Expected VALIDATION_ERROR");
    expect(result.error.message).toContain("EMPTY_TOKEN");
  });
});

// ─── Partial pattern is treated as literal (not resolved) ────────────────────

describe("resolveEnvInHeaders — partial pattern treated as literal", () => {
  it("passes 'prefix_${VAR}' through unchanged (partial match is not substituted)", () => {
    // Pattern requires FULL-VALUE match — embedded ${} is not substituted
    const result = resolveEnvInHeaders(
      { auth: "Bearer ${TOKEN}" },
      { TOKEN: "actual-value" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    // Must NOT replace — the full value is "Bearer ${TOKEN}", not a pattern match
    expect(result.value["auth"]).toBe("Bearer ${TOKEN}");
  });

  it("passes '${VAR}_suffix' through unchanged", () => {
    const result = resolveEnvInHeaders(
      { "x-header": "${FOO}_suffix" },
      { FOO: "resolved" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value["x-header"]).toBe("${FOO}_suffix");
  });

  it("passes 'text${VAR}text' through unchanged (surrounded by text)", () => {
    const result = resolveEnvInHeaders(
      { key: "prefix${BAR}suffix" },
      { BAR: "middle" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value["key"]).toBe("prefix${BAR}suffix");
  });
});

// ─── Lowercase variable names are NOT matched ─────────────────────────────────

describe("resolveEnvInHeaders — lowercase variable names not matched", () => {
  it("passes '${lowercase}' through as literal (pattern requires uppercase)", () => {
    // Pattern: [A-Z_][A-Z0-9_]* — lowercase names do not match
    const result = resolveEnvInHeaders(
      { auth: "${lowercase_var}" },
      { lowercase_var: "should-not-resolve" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    // Treated as literal — env var NOT substituted
    expect(result.value["auth"]).toBe("${lowercase_var}");
  });

  it("passes '${MixedCase}' through as literal (mixed case is not matched)", () => {
    const result = resolveEnvInHeaders(
      { auth: "${ApiKey}" },
      { ApiKey: "should-not-resolve" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value["auth"]).toBe("${ApiKey}");
  });
});
