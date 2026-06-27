// @vitest-environment jsdom
/**
 * Tests for bootstrapAuthIfNeeded — SPA cookie-bootstrap helper.
 * Source: SPEC-016 §3.7, §3.8 (AC-A-S1..S4)
 *
 * Test plan (6-dimension):
 *   HAPPY (AC-A-S1, AC-A-S3):
 *     - window.__LORE_BOOTSTRAP_TOKEN__ set → POST /api/auth/local-bootstrap called
 *     - successful POST → window.__LORE_BOOTSTRAP_TOKEN__ is deleted (even on success)
 *
 *   NEGATIVE (AC-A-S2):
 *     - window.__LORE_BOOTSTRAP_TOKEN__ absent (undefined) → fetch not called, resolves cleanly
 *
 *   BOUNDARY:
 *     - POST returns non-ok status (e.g. 401) → throws, window token still deleted
 *     - POST returns 403 (wrong origin) → throws, window token still deleted
 *
 *   ERROR (AC-A-S4):
 *     - fetch throws network error → function throws, window token still deleted in finally
 *
 *   STATE:
 *     - window.__LORE_BOOTSTRAP_TOKEN__ is deleted in the finally block even on error
 *
 *   REGRESSION:
 *     - After calling bootstrapAuthIfNeeded, window object has no __LORE_BOOTSTRAP_TOKEN__ key
 *     - Second call with no token is safe no-op (idempotent)
 *
 * @spec_ref AC-A-S1, AC-A-S2, AC-A-S3, AC-A-S4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapAuthIfNeeded } from "../../../src/lib/bootstrap.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BOOTSTRAP_TOKEN = "lore_ak_" + "a".repeat(64);

type BootstrapWindow = Window & { __LORE_BOOTSTRAP_TOKEN__?: string };

function setWindowToken(token?: string): void {
  const w = window as BootstrapWindow;
  if (token !== undefined) {
    w.__LORE_BOOTSTRAP_TOKEN__ = token;
  } else {
    delete w.__LORE_BOOTSTRAP_TOKEN__;
  }
}

function getWindowToken(): string | undefined {
  return (window as BootstrapWindow).__LORE_BOOTSTRAP_TOKEN__;
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("bootstrapAuthIfNeeded — happy path", () => {
  beforeEach(() => {
    setWindowToken(BOOTSTRAP_TOKEN);
  });

  afterEach(() => {
    delete (window as BootstrapWindow).__LORE_BOOTSTRAP_TOKEN__;
    vi.restoreAllMocks();
  });

  it("calls POST /api/auth/local-bootstrap with X-Lore-Token + credentials:include (AC-A-S1)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", mockFetch);

    await bootstrapAuthIfNeeded();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/local-bootstrap");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Lore-Token"]).toBe(BOOTSTRAP_TOKEN);
    expect(init.credentials).toBe("include");
  });

  it("deletes window.__LORE_BOOTSTRAP_TOKEN__ after successful POST (AC-A-S3)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    await bootstrapAuthIfNeeded();

    expect(getWindowToken()).toBeUndefined();
    expect("__LORE_BOOTSTRAP_TOKEN__" in window).toBe(false);
  });
});

// ─── NEGATIVE (AC-A-S2) ───────────────────────────────────────────────────────

describe("bootstrapAuthIfNeeded — negative cases", () => {
  afterEach(() => {
    delete (window as BootstrapWindow).__LORE_BOOTSTRAP_TOKEN__;
    vi.restoreAllMocks();
  });

  it("does nothing when window.__LORE_BOOTSTRAP_TOKEN__ is undefined (AC-A-S2)", async () => {
    setWindowToken(undefined);
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await bootstrapAuthIfNeeded();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resolves cleanly (no throw) when token is absent", async () => {
    setWindowToken(undefined);
    vi.stubGlobal("fetch", vi.fn());

    await expect(bootstrapAuthIfNeeded()).resolves.toBeUndefined();
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("bootstrapAuthIfNeeded — boundary values", () => {
  beforeEach(() => {
    setWindowToken(BOOTSTRAP_TOKEN);
  });

  afterEach(() => {
    delete (window as BootstrapWindow).__LORE_BOOTSTRAP_TOKEN__;
    vi.restoreAllMocks();
  });

  it("throws when POST returns 401 (invalid token)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    await expect(bootstrapAuthIfNeeded()).rejects.toThrow("bootstrap failed: 401");
  });

  it("deletes window token even when POST returns 401 (finally block)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    try {
      await bootstrapAuthIfNeeded();
    } catch {
      // expected to throw
    }

    expect(getWindowToken()).toBeUndefined();
  });

  it("throws when POST returns 403 (wrong origin)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(bootstrapAuthIfNeeded()).rejects.toThrow("bootstrap failed: 403");
  });
});

// ─── ERROR (AC-A-S4) ─────────────────────────────────────────────────────────

describe("bootstrapAuthIfNeeded — error / network failure", () => {
  beforeEach(() => {
    setWindowToken(BOOTSTRAP_TOKEN);
  });

  afterEach(() => {
    delete (window as BootstrapWindow).__LORE_BOOTSTRAP_TOKEN__;
    vi.restoreAllMocks();
  });

  it("throws when fetch rejects with a network error (AC-A-S4)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(bootstrapAuthIfNeeded()).rejects.toThrow("Failed to fetch");
  });

  it("deletes window token even when fetch throws a network error (AC-A-S4)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    try {
      await bootstrapAuthIfNeeded();
    } catch {
      // expected
    }

    expect(getWindowToken()).toBeUndefined();
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("bootstrapAuthIfNeeded — state transitions", () => {
  afterEach(() => {
    delete (window as BootstrapWindow).__LORE_BOOTSTRAP_TOKEN__;
    vi.restoreAllMocks();
  });

  it("window.__LORE_BOOTSTRAP_TOKEN__ is deleted in the finally block regardless of outcome", async () => {
    // Test with successful response
    setWindowToken(BOOTSTRAP_TOKEN);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    await bootstrapAuthIfNeeded();
    expect(getWindowToken()).toBeUndefined();

    // Test with failure response
    setWindowToken(BOOTSTRAP_TOKEN);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    try { await bootstrapAuthIfNeeded(); } catch { /* ignore */ }
    expect(getWindowToken()).toBeUndefined();

    // Test with network error
    setWindowToken(BOOTSTRAP_TOKEN);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net::ERR_FAILED")));
    try { await bootstrapAuthIfNeeded(); } catch { /* ignore */ }
    expect(getWindowToken()).toBeUndefined();
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("bootstrapAuthIfNeeded — regression", () => {
  afterEach(() => {
    delete (window as BootstrapWindow).__LORE_BOOTSTRAP_TOKEN__;
    vi.restoreAllMocks();
  });

  it("after successful bootstrap, window has no __LORE_BOOTSTRAP_TOKEN__ key", async () => {
    setWindowToken(BOOTSTRAP_TOKEN);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    await bootstrapAuthIfNeeded();

    expect("__LORE_BOOTSTRAP_TOKEN__" in window).toBe(false);
  });

  it("second call with no token is safe no-op (idempotent)", async () => {
    setWindowToken(undefined);
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await bootstrapAuthIfNeeded();
    await bootstrapAuthIfNeeded();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
