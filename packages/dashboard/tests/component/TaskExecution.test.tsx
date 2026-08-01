// @vitest-environment jsdom
/**
 * Tests for TaskExecution — task-detail Execution section (SPEC-037 D3).
 * @spec_ref SPEC-037 §1 D3, AC-37-5, AC-37-6
 *
 * Test plan:
 *   HAPPY:
 *     - claim card renders holder, branch (mono), and a relative claimed-at time
 *     - evidence timeline renders oracle + result badges, command, recorded_by
 *
 *   NEGATIVE:
 *     - a malformed extra.claim (wrong shape) is omitted, no crash
 *
 *   BOUNDARY:
 *     - a task with neither claim nor evidence renders no Execution section (null)
 *
 *   ERROR:
 *     - a legacy task with malformed extra.verification_evidence renders no
 *       Execution section and no crash (AC-37-5)
 *
 *   STATE:
 *     - (n/a — pure render, no interaction)
 *
 *   REGRESSION:
 *     - evidence entries render newest-first
 *     - a "fail" result renders the destructive badge variant; "pass" renders secondary
 *     - output_tail is collapsed behind a <details> disclosure
 *     - an "expected-fail"/"inconclusive" result renders the neutral outline
 *       badge, never destructive (task-two-more-evidence-consumers-erase-an-
 *       expected-fail-row-doc)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DocRecord } from "@lore/core";
import { TaskExecution } from "../../src/components/TaskExecution";

function makeTaskDoc(extra: Record<string, unknown>): DocRecord {
  return {
    id: "01HTASK0000000000000000001",
    slug: "task-fixture",
    title: "Task Fixture",
    type: "task",
    status: "draft",
    priority: "medium",
    content: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: null,
    parent_id: "01HPLAN0000000000000000001",
    tags: [],
    extra,
    version: 1,
  };
}

describe("TaskExecution", () => {
  describe("happy path", () => {
    it("renders the claim card with holder, branch, and a relative time", () => {
      const doc = makeTaskDoc({ claim: { by: "alice", at: new Date(Date.now() - 60_000).toISOString(), branch: "feat/x" } });
      render(<TaskExecution task={doc} />);

      expect(screen.getByText("alice")).toBeInTheDocument();
      expect(screen.getByText("feat/x")).toBeInTheDocument();
      expect(screen.getByText("today")).toBeInTheDocument();
    });

    it("renders an evidence timeline entry with oracle, result, command, and recorded_by", () => {
      const doc = makeTaskDoc({
        verification_evidence: [
          {
            oracle: "tsc",
            command: "bun run typecheck",
            result: "pass",
            recorded_at: new Date().toISOString(),
            recorded_by: "bob",
          },
        ],
      });
      render(<TaskExecution task={doc} />);

      expect(screen.getByText("tsc")).toBeInTheDocument();
      expect(screen.getByText("pass")).toBeInTheDocument();
      expect(screen.getByText("bun run typecheck")).toBeInTheDocument();
      expect(screen.getByText("bob")).toBeInTheDocument();
    });
  });

  describe("negative: malformed claim", () => {
    it("omits the claim card when extra.claim is malformed (wrong shape), no crash", () => {
      const doc = makeTaskDoc({ claim: { by: 12345 } });
      expect(() => render(<TaskExecution task={doc} />)).not.toThrow();
      expect(screen.queryByText(/Claimed by/)).not.toBeInTheDocument();
    });
  });

  describe("boundary: nothing to show", () => {
    it("renders null when there is neither a claim nor any evidence", () => {
      const doc = makeTaskDoc({});
      const { container } = render(<TaskExecution task={doc} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("error: malformed evidence", () => {
    it("renders no Execution section for a legacy task with malformed verification_evidence", () => {
      const doc = makeTaskDoc({ verification_evidence: "not-an-array" });
      expect(() => render(<TaskExecution task={doc} />)).not.toThrow();
      expect(screen.queryByLabelText("Execution")).not.toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders evidence entries newest-first", () => {
      const doc = makeTaskDoc({
        verification_evidence: [
          { oracle: "tsc", command: "cmd-old", result: "pass", recorded_at: "2026-01-01T00:00:00.000Z", recorded_by: "alice" },
          { oracle: "test", command: "cmd-new", result: "fail", recorded_at: "2026-01-02T00:00:00.000Z", recorded_by: "bob" },
        ],
      });
      const { container } = render(<TaskExecution task={doc} />);

      const commands = Array.from(container.querySelectorAll("pre, .font-mono")).map((el) => el.textContent);
      const oldIdx = container.innerHTML.indexOf("cmd-old");
      const newIdx = container.innerHTML.indexOf("cmd-new");
      expect(newIdx).toBeLessThan(oldIdx);
      expect(commands.length).toBeGreaterThan(0);
    });

    it("renders a destructive badge for a 'fail' result and secondary for 'pass'", () => {
      const doc = makeTaskDoc({
        verification_evidence: [
          { oracle: "tsc", command: "cmd-pass", result: "pass", recorded_at: "2026-01-01T00:00:00.000Z", recorded_by: "alice" },
          { oracle: "test", command: "cmd-fail", result: "fail", recorded_at: "2026-01-02T00:00:00.000Z", recorded_by: "bob" },
        ],
      });
      render(<TaskExecution task={doc} />);

      const failBadge = screen.getByText("fail");
      const passBadge = screen.getByText("pass");
      expect(failBadge).toHaveClass("text-destructive-foreground");
      expect(passBadge).not.toHaveClass("text-destructive-foreground");
    });

    it("task-two-more-evidence-consumers-erase-an-expected-fail-row-doc: an 'expected-fail'/'inconclusive' result renders the neutral outline badge, NEVER the destructive one a real 'fail' gets", () => {
      const doc = makeTaskDoc({
        verification_evidence: [
          {
            oracle: "test",
            command: "cmd-red",
            result: "expected-fail",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
          },
          {
            oracle: "test",
            command: "cmd-inconclusive",
            result: "inconclusive",
            recorded_at: "2026-01-02T00:00:00.000Z",
            recorded_by: "bob",
          },
        ],
      });
      render(<TaskExecution task={doc} />);

      const expectedFailBadge = screen.getByText("expected-fail");
      const inconclusiveBadge = screen.getByText("inconclusive");
      expect(expectedFailBadge).not.toHaveClass("text-destructive-foreground");
      expect(inconclusiveBadge).not.toHaveClass("text-destructive-foreground");
    });

    it("collapses output_tail behind a <details> disclosure", () => {
      const doc = makeTaskDoc({
        verification_evidence: [
          {
            oracle: "tsc",
            command: "bun run typecheck",
            result: "fail",
            output_tail: "error TS2345: something broke",
            recorded_at: new Date().toISOString(),
            recorded_by: "alice",
          },
        ],
      });
      const { container } = render(<TaskExecution task={doc} />);

      const details = container.querySelector("details");
      expect(details).not.toBeNull();
      const pre = details!.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre).toHaveTextContent("error TS2345: something broke");
      expect(pre).toHaveClass("overflow-x-auto");
    });
  });
});
