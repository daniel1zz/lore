// @vitest-environment jsdom
/**
 * Tests for TaskEvidencePanel — Evidence-tab rendering for a `task` doc's
 * projection (SPEC-075 §Module Boundary D7).
 * @spec_ref AC-075-1, AC-075-3
 *
 * Test plan (six-dimension coverage):
 *   HAPPY (AC-075-1):
 *     - renders oracle badge, result badge, and command for each entry
 *     - a runner-attested entry (attestation present) shows the "attested" label
 *     - a self-reported entry (no attestation) shows the "self-reported" label
 *     - output_tail renders in a monospace panel
 *   NEGATIVE:
 *     - an entry with no output_tail renders no output panel (never a blank <pre>)
 *   BOUNDARY (AC-075-3):
 *     - zero evidence entries renders an explicit empty state, never a blank section
 *   ERROR:
 *     - n/a (pure render of an already-typed projection; no fallible IO here)
 *   STATE:
 *     - n/a (pure render, no internal state)
 *   REGRESSION:
 *     - entries render newest-first (append-only storage is oldest-first)
 *     - a "fail" result renders the destructive badge variant
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EvidenceEntry } from "@lore/core";
import { TaskEvidencePanel } from "../../src/components/evidence/TaskEvidencePanel";

function makeEntry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    oracle: "test",
    command: "bunx vitest run packages/core",
    result: "pass",
    recorded_at: "2026-01-01T00:00:00.000Z",
    recorded_by: "alice",
    ...overrides,
  };
}

describe("TaskEvidencePanel", () => {
  describe("happy path (AC-075-1)", () => {
    it("renders oracle, result, and command for an evidence entry", () => {
      render(
        <TaskEvidencePanel
          panel={{ doc_type: "task", evidence: [makeEntry({ oracle: "tsc", command: "bun run typecheck" })], ac_refs: [] }}
        />,
      );
      expect(screen.getByText("tsc")).toBeInTheDocument();
      expect(screen.getByText("pass")).toBeInTheDocument();
      expect(screen.getByText("bun run typecheck")).toBeInTheDocument();
    });

    it("labels a runner-attested entry as 'attested'", () => {
      const entry = makeEntry({
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 500, timed_out: false },
      });
      render(<TaskEvidencePanel panel={{ doc_type: "task", evidence: [entry], ac_refs: [] }} />);
      expect(screen.getByText("attested")).toBeInTheDocument();
      expect(screen.queryByText("self-reported")).not.toBeInTheDocument();
    });

    it("labels a self-reported entry (no attestation) as 'self-reported'", () => {
      render(<TaskEvidencePanel panel={{ doc_type: "task", evidence: [makeEntry()], ac_refs: [] }} />);
      expect(screen.getByText("self-reported")).toBeInTheDocument();
      expect(screen.queryByText("attested")).not.toBeInTheDocument();
    });

    it("renders output_tail in a monospace panel", () => {
      render(
        <TaskEvidencePanel
          panel={{ doc_type: "task", evidence: [makeEntry({ output_tail: "PASS 12 tests" })], ac_refs: [] }}
        />,
      );
      const pre = screen.getByText("PASS 12 tests");
      expect(pre.tagName).toBe("PRE");
      expect(pre).toHaveClass("font-mono");
    });
  });

  describe("negative", () => {
    it("renders no output panel when output_tail is absent", () => {
      const { container } = render(
        <TaskEvidencePanel panel={{ doc_type: "task", evidence: [makeEntry()], ac_refs: [] }} />,
      );
      expect(container.querySelector("pre")).toBeNull();
    });
  });

  describe("boundary (AC-075-3)", () => {
    it("renders an explicit empty state for zero evidence entries", () => {
      render(<TaskEvidencePanel panel={{ doc_type: "task", evidence: [], ac_refs: [] }} />);
      expect(screen.getByText("No verification evidence recorded yet.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Evidence timeline")).not.toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders entries newest-first", () => {
      const older = makeEntry({ command: "older-command", recorded_at: "2026-01-01T00:00:00.000Z" });
      const newer = makeEntry({ command: "newer-command", recorded_at: "2026-01-02T00:00:00.000Z" });
      render(<TaskEvidencePanel panel={{ doc_type: "task", evidence: [older, newer], ac_refs: [] }} />);
      const commands = screen.getAllByText(/-command$/).map((el) => el.textContent);
      expect(commands).toEqual(["newer-command", "older-command"]);
    });

    it("renders the destructive badge variant for a fail result", () => {
      render(<TaskEvidencePanel panel={{ doc_type: "task", evidence: [makeEntry({ result: "fail" })], ac_refs: [] }} />);
      const badge = screen.getByText("fail");
      expect(badge.className).toMatch(/destructive/);
    });
  });
});
