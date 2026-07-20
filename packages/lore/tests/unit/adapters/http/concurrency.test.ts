/**
 * @spec_ref AC-DASH-WRITE-3
 *
 * Unit tests for checkConcurrency — optimistic-concurrency helper.
 * Source: SPEC-022 §9.4, concurrency.ts public surface.
 *
 * Spec expectations (written before reading implementation):
 *   - X-Force-Overwrite: 1 header bypasses ALL concurrency checks → null
 *   - Absent If-Match header → null (no enforcement, legacy path)
 *   - If-Match matches server version → null (safe to write)
 *   - If-Match stale (mismatches server version) → ConflictPayload
 *   - ConflictPayload must contain: current (DocRecord), mine (string), diff (string)
 *   - diff must be a non-empty unified-diff string when versions differ
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { describe, it, expect } from "vitest";
import { checkConcurrency, resolveExpectedVersion, buildConflictPayload } from "../../../../src/adapters/http/concurrency.js";
import type { DocRecord } from "@lore/core";
import type { ConflictPayload } from "../../../../src/adapters/http/concurrency.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeReq(headers: Record<string, string>): Request {
  return new Request("https://x/api/dashboard/doc-001", { headers });
}

/**
 * Minimal DocRecord for concurrency tests.
 * Spec (SPEC-022 §9.4) only reads .version and .content from currentDoc.
 */
function makeDoc(version: number, content = "server content"): DocRecord {
  return {
    id: "01HT",
    slug: "spec-test",
    title: "T",
    type: "spec",
    role: "spec",
    status: "draft",
    priority: "medium",
    content,
    version,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    deleted_at: null,
    created_by: "system",
    parent_id: null,
    tags: [],
    extra: {},
  };
}

// ─── HAPPY paths ──────────────────────────────────────────────────────────────

describe("checkConcurrency — HAPPY", () => {
  it("returns null when no If-Match header is present (legacy path, no enforcement)", () => {
    // Spec §9.4: absent If-Match → skip check (legacy client or explicit opt-out)
    const req = makeReq({});
    const doc = makeDoc(5);
    const result = checkConcurrency(req, doc, "client content");
    expect(result).toBeNull();
  });

  it("returns null when If-Match matches the current server version exactly", () => {
    // Spec §9.4: versions match → safe to write
    const req = makeReq({ "If-Match": "3" });
    const doc = makeDoc(3);
    const result = checkConcurrency(req, doc, "client content");
    expect(result).toBeNull();
  });

  it("returns null when X-Force-Overwrite: 1 is sent regardless of If-Match mismatch", () => {
    // Spec §9.4 step 5: X-Force-Overwrite bypasses check unconditionally
    const req = makeReq({ "X-Force-Overwrite": "1", "If-Match": "1" });
    const doc = makeDoc(99); // version 99 vs If-Match: 1 — would be stale without force
    const result = checkConcurrency(req, doc, "client content");
    expect(result).toBeNull();
  });
});

// ─── NEGATIVE paths ───────────────────────────────────────────────────────────

describe("checkConcurrency — NEGATIVE", () => {
  it("returns ConflictPayload when If-Match version is stale (client behind server)", () => {
    // Spec §9.4: stale version → ConflictPayload (caller returns 409)
    const req = makeReq({ "If-Match": "1" });
    const doc = makeDoc(2, "current server content");
    const result = checkConcurrency(req, doc, "my edit");
    expect(result).not.toBeNull();
    const conflict = result as ConflictPayload;
    expect(conflict.current).toBe(doc);
    expect(conflict.mine).toBe("my edit");
  });

  it("ConflictPayload.mine is the exact client content string passed in", () => {
    // Spec §9.4: "mine" = what the client tried to write (should not be modified)
    const req = makeReq({ "If-Match": "1" });
    const doc = makeDoc(2);
    const clientContent = "client wrote this content — must be preserved verbatim";
    const result = checkConcurrency(req, doc, clientContent) as ConflictPayload;
    expect(result.mine).toBe(clientContent);
  });

  it("ConflictPayload.current is the server's current DocRecord (unchanged reference)", () => {
    // Spec: current must carry the server-side document so UI can show it
    const req = makeReq({ "If-Match": "3" });
    const doc = makeDoc(7, "server has this");
    const result = checkConcurrency(req, doc, "client had this") as ConflictPayload;
    expect(result.current).toStrictEqual(doc);
    expect(result.current.content).toBe("server has this");
    expect(result.current.version).toBe(7);
  });

  it("returns ConflictPayload when If-Match version is ahead of server version", () => {
    // Adversarial: client sends If-Match: 99 but server is at version 3 — still stale
    const req = makeReq({ "If-Match": "99" });
    const doc = makeDoc(3);
    const result = checkConcurrency(req, doc, "client content");
    // Spec is silent on version-ahead case, but §9.4 says mismatch = conflict
    expect(result).not.toBeNull();
  });
});

// ─── BOUNDARY conditions ──────────────────────────────────────────────────────

describe("checkConcurrency — BOUNDARY", () => {
  it("If-Match: 0 matches a version-0 document → null (not stale)", () => {
    // Spec AC requires this works for v0 docs (version 0 is a valid initial state)
    const req = makeReq({ "If-Match": "0" });
    const doc = makeDoc(0);
    const result = checkConcurrency(req, doc, "client content");
    expect(result).toBeNull();
  });

  it("X-Force-Overwrite: 0 is not treated as a force (only '1' bypasses)", () => {
    // Spec: only X-Force-Overwrite: 1 bypasses check (§9.4 step 5)
    const req = makeReq({ "X-Force-Overwrite": "0", "If-Match": "1" });
    const doc = makeDoc(5); // version 5 vs If-Match: 1 — stale
    const result = checkConcurrency(req, doc, "client content");
    // With force=0 (not bypass), the If-Match mismatch should trigger conflict
    expect(result).not.toBeNull();
  });

  it("empty clientContent still produces a ConflictPayload with diff", () => {
    // Edge case: client sends empty string as new content
    const req = makeReq({ "If-Match": "1" });
    const doc = makeDoc(2, "existing content on server");
    const result = checkConcurrency(req, doc, "") as ConflictPayload;
    expect(result).not.toBeNull();
    expect(result.mine).toBe("");
    expect(typeof result.diff).toBe("string");
  });
});

// ─── ERROR paths ──────────────────────────────────────────────────────────────

describe("checkConcurrency — ERROR", () => {
  it("non-numeric If-Match header is treated as a mismatch → ConflictPayload", () => {
    // Adversarial: If-Match: "garbage" → parseInt → NaN. Code checks !isNaN(clientVersion).
    // Per spec, If-Match must be an integer version. A non-numeric value is invalid.
    // The implementation falls through to conflict logic in this case.
    const req = makeReq({ "If-Match": "garbage" });
    const doc = makeDoc(1);
    const result = checkConcurrency(req, doc, "client content");
    // Either null (treated as missing) or ConflictPayload (treated as mismatch)
    // The implementation returns ConflictPayload. Documenting the observed behavior.
    // If spec intends "invalid header = skip check", this would be a defect.
    expect(result).not.toBeNull(); // currently returns ConflictPayload
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("checkConcurrency — REGRESSION", () => {
  it("ConflictPayload.diff is a non-empty string when client and server content differ", () => {
    // Regression: diff must not be empty — would render a useless ConflictModal
    const req = makeReq({ "If-Match": "1" });
    const doc = makeDoc(2, "server has this content that is different");
    const result = checkConcurrency(req, doc, "client wrote this different content") as ConflictPayload;
    expect(result).not.toBeNull();
    expect(typeof result.diff).toBe("string");
    expect(result.diff.length).toBeGreaterThan(0);
  });

  it("ConflictPayload.diff contains 'yours' and 'theirs' labels (unified diff format)", () => {
    // Spec §concurrency.ts: labels are 'yours' (client) and 'theirs' (server)
    // These labels must match the ConflictModal copy ("You wrote" vs "Now on server")
    const req = makeReq({ "If-Match": "1" });
    const doc = makeDoc(2, "server version of the content");
    const result = checkConcurrency(req, doc, "client draft of the content") as ConflictPayload;
    expect(result.diff).toContain("yours");
    expect(result.diff).toContain("theirs");
  });

  it("checkConcurrency with different stale versions produces different ConflictPayloads", () => {
    // Anti-hardcode: same function with different inputs must produce different results
    const req1 = makeReq({ "If-Match": "1" });
    const doc1 = makeDoc(3, "server v3 content");
    const result1 = checkConcurrency(req1, doc1, "client A") as ConflictPayload;

    const req2 = makeReq({ "If-Match": "2" });
    const doc2 = makeDoc(5, "server v5 content — different");
    const result2 = checkConcurrency(req2, doc2, "client B") as ConflictPayload;

    // The two payloads must differ (confirms function isn't hardcoding output)
    expect(result1.current.version).not.toBe(result2.current.version);
    expect(result1.mine).not.toBe(result2.mine);
  });

  it("null returned for matching version is not a hardcoded null — mismatched version returns payload", () => {
    // Anti-tautology: if the match path just returned null for all inputs, this would catch it
    const matchReq = makeReq({ "If-Match": "5" });
    const mismatchReq = makeReq({ "If-Match": "4" });
    const doc = makeDoc(5);

    expect(checkConcurrency(matchReq, doc, "content")).toBeNull();
    expect(checkConcurrency(mismatchReq, doc, "content")).not.toBeNull();
  });
});

// ─── resolveExpectedVersion (BUG-003 audit finding fix) ────────────────────────

describe("resolveExpectedVersion — BUG-003 CAS-guard derivation", () => {
  describe("HAPPY", () => {
    it("returns the parsed integer when If-Match is present and numeric", () => {
      const req = makeReq({ "If-Match": "7" });
      expect(resolveExpectedVersion(req)).toBe(7);
    });

    it("returns a different value for a different If-Match header (anti-hardcode)", () => {
      expect(resolveExpectedVersion(makeReq({ "If-Match": "1" }))).toBe(1);
      expect(resolveExpectedVersion(makeReq({ "If-Match": "42" }))).toBe(42);
    });
  });

  describe("NEGATIVE", () => {
    it("returns undefined when If-Match is absent (legacy unconditional-write path, unchanged)", () => {
      const req = makeReq({});
      expect(resolveExpectedVersion(req)).toBeUndefined();
    });

    it("returns undefined when If-Match is non-numeric", () => {
      const req = makeReq({ "If-Match": "garbage" });
      expect(resolveExpectedVersion(req)).toBeUndefined();
    });
  });

  describe("BOUNDARY", () => {
    it("If-Match: 0 returns 0, not undefined (0 is a valid version, not a falsy no-op)", () => {
      const req = makeReq({ "If-Match": "0" });
      expect(resolveExpectedVersion(req)).toBe(0);
    });
  });

  describe("STATE — X-Force-Overwrite interaction", () => {
    it("X-Force-Overwrite: 1 returns undefined even when If-Match is present and numeric (force bypasses the CAS guard entirely)", () => {
      const req = makeReq({ "If-Match": "5", "X-Force-Overwrite": "1" });
      expect(resolveExpectedVersion(req)).toBeUndefined();
    });

    it("X-Force-Overwrite: 0 (not '1') does NOT bypass — If-Match value is still returned", () => {
      const req = makeReq({ "If-Match": "5", "X-Force-Overwrite": "0" });
      expect(resolveExpectedVersion(req)).toBe(5);
    });
  });

  describe("REGRESSION — mirrors checkConcurrency's own header-reading contract", () => {
    it("the SAME request that checkConcurrency treats as a legacy no-op (no If-Match) also yields undefined here", () => {
      const req = makeReq({});
      const doc: DocRecord = makeDoc(3);
      expect(checkConcurrency(req, doc, "x")).toBeNull();
      expect(resolveExpectedVersion(req)).toBeUndefined();
    });

    it("the SAME request that checkConcurrency force-bypasses also yields undefined here", () => {
      const req = makeReq({ "If-Match": "1", "X-Force-Overwrite": "1" });
      const doc: DocRecord = makeDoc(99);
      expect(checkConcurrency(req, doc, "x")).toBeNull();
      expect(resolveExpectedVersion(req)).toBeUndefined();
    });
  });
});

// ─── buildConflictPayload (shared diff-rendering, BUG-003 fix) ─────────────────

describe("buildConflictPayload — shared ConflictPayload construction", () => {
  describe("HAPPY", () => {
    it("returns {current, mine, diff} with current/mine passed through verbatim", () => {
      const doc = makeDoc(4, "server content");
      const payload = buildConflictPayload(doc, "client content");
      expect(payload.current).toBe(doc);
      expect(payload.mine).toBe("client content");
      expect(typeof payload.diff).toBe("string");
    });
  });

  describe("BOUNDARY", () => {
    it("identical current/client content still produces a well-formed payload with a (possibly empty-diff) string", () => {
      const doc = makeDoc(1, "same content");
      const payload = buildConflictPayload(doc, "same content");
      expect(payload.current).toBe(doc);
      expect(payload.mine).toBe("same content");
      expect(typeof payload.diff).toBe("string");
    });
  });

  describe("REGRESSION — identical shape/labels to checkConcurrency's own stale-path output", () => {
    it("buildConflictPayload output for a given (doc, content) pair matches checkConcurrency's output for the equivalent stale request", () => {
      const doc = makeDoc(2, "server v2 content");
      const req = makeReq({ "If-Match": "1" }); // stale relative to doc.version=2
      const viaCheckConcurrency = checkConcurrency(req, doc, "my draft") as ConflictPayload;
      const viaBuildConflictPayload = buildConflictPayload(doc, "my draft");

      expect(viaBuildConflictPayload.current).toBe(viaCheckConcurrency.current);
      expect(viaBuildConflictPayload.mine).toBe(viaCheckConcurrency.mine);
      expect(viaBuildConflictPayload.diff).toBe(viaCheckConcurrency.diff);
    });

    it("diff contains 'yours'/'theirs' labels — the SAME contract checkConcurrency's diff carries", () => {
      const doc = makeDoc(2, "server version");
      const payload = buildConflictPayload(doc, "client draft");
      expect(payload.diff).toContain("yours");
      expect(payload.diff).toContain("theirs");
    });
  });
});
