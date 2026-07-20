/**
 * Tests for resolveEditBaseVersion (ASYNC2D-001 If-Match version freeze).
 * Source: src/lib/edit-session.ts
 *
 * Test plan:
 *   HAPPY:
 *     - Not editing -> adopts the latest server version.
 *   NEGATIVE / STATE:
 *     - Editing -> pins the current base version even when the server
 *       version has moved ahead (the exact scenario a background refetch
 *       produces mid-edit-session).
 *   BOUNDARY:
 *     - Not editing, server version unchanged -> returns the same value
 *       (idempotent, no spurious identity churn implied).
 *     - Editing, server version identical to current base -> still returns
 *       currentBaseVersion (pinned path taken regardless of whether it would
 *       have matched anyway).
 *   REGRESSION:
 *     - Transitioning from editing -> not-editing on the same call picks up
 *       the fresh server version immediately (no one-render lag baked into
 *       the pure function itself — DocDetail's effect re-invokes per render).
 */
import { describe, it, expect } from "vitest";
import { resolveEditBaseVersion } from "../../../src/lib/edit-session";

describe("resolveEditBaseVersion", () => {
  describe("happy path", () => {
    it("adopts the latest server version when not editing", () => {
      const result = resolveEditBaseVersion({
        isEditing: false,
        latestServerVersion: 6,
        currentBaseVersion: 5,
      });
      expect(result).toBe(6);
    });
  });

  describe("negative / state", () => {
    it("pins the current base version while editing, ignoring a fresher server version", () => {
      const result = resolveEditBaseVersion({
        isEditing: true,
        latestServerVersion: 6,
        currentBaseVersion: 5,
      });
      expect(result).toBe(5);
    });
  });

  describe("boundary", () => {
    it("is a no-op when not editing and the server version has not moved", () => {
      const result = resolveEditBaseVersion({
        isEditing: false,
        latestServerVersion: 5,
        currentBaseVersion: 5,
      });
      expect(result).toBe(5);
    });

    it("still takes the pinned path while editing even if versions already match", () => {
      const result = resolveEditBaseVersion({
        isEditing: true,
        latestServerVersion: 5,
        currentBaseVersion: 5,
      });
      expect(result).toBe(5);
    });
  });

  describe("regression", () => {
    it("picks up the fresh server version the moment isEditing flips false", () => {
      // Simulates: editing pinned base at 5 while server moved to 6, then the
      // edit session ends (Save/Cancel) -> the very next resolve call must
      // reconcile to the live value, not carry the stale pin forward.
      const pinned = resolveEditBaseVersion({
        isEditing: true,
        latestServerVersion: 6,
        currentBaseVersion: 5,
      });
      expect(pinned).toBe(5);

      const reconciled = resolveEditBaseVersion({
        isEditing: false,
        latestServerVersion: 6,
        currentBaseVersion: pinned,
      });
      expect(reconciled).toBe(6);
    });
  });
});
