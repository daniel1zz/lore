/**
 * done-command.test.ts — spec-workflow-hardening-evidence-red-vocabulary-claim-worktree
 * §M3, AC-WH-3: `lore done`'s human-readable success message must clearly distinguish
 * the idempotent no-op branch (already at a terminal status) from a real lifecycle walk,
 * and name the transitions actually performed.
 *
 * `commands/done.ts` transitively imports `loader.ts` (`bun:sqlite`), which vitest
 * cannot resolve, so this suite exercises the pure unit extracted for testability:
 *   - `formatDoneMessage` (`packages/lore/src/adapters/cli/done-render.ts`) — same
 *     split pattern as `pending-render.ts`/`assess-render.ts`/`review-render.ts`.
 *
 * The substantive service-layer behavior (evidence/claim validation, the actual
 * VALID_TRANSITIONS walk, blocks-link readiness flip, idempotency) is covered by
 * `tests/unit/service/task-workflow-service.test.ts`'s AC-WH-3 suite — this file's
 * scope is the CLI adapter's own OUTPUT rendering.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-WH-3 — spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3
 */

import { describe, it, expect } from "vitest";
import { formatDoneMessage } from "../../../src/adapters/cli/done-render.js";
import type { DoneResult } from "../../../src/service/task-workflow-service.js";
import type { DocRecord } from "@lore/core";

function makeTaskDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HDONE0000000000000000001",
    slug: "task-example",
    type: "task",
    role: "plan",
    title: "Example Task",
    status: "draft",
    priority: "medium",
    content: "# Example Task",
    parent_id: "01HPLAN000000000000000000",
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLAN000000000000000000" },
    ...overrides,
  };
}

describe("lore done — success message rendering (AC-WH-3)", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("HAPPY: a real lifecycle walk names the slug, final version, and full transitions path", () => {
    const result: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 4 }),
      already_done: false,
      transitions: ["approved", "active", "archived"],
    };

    const message = formatDoneMessage(result);
    expect(message).toContain("task-example");
    expect(message).toContain("v4");
    expect(message).toContain("approved -> active -> archived");
    expect(message).not.toContain("no-op");
  });

  it("HAPPY: a single-step walk (already approved) renders just that one step", () => {
    const result: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 2 }),
      already_done: false,
      transitions: ["archived"],
    };

    const message = formatDoneMessage(result);
    expect(message).toContain("archived");
    expect(message).not.toContain("->");
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────
  // (formatDoneMessage only ever receives a successful DoneResult — the error
  // path is rendered by the shared formatError/exitCode pair every other CLI
  // command uses, exercised at the service layer's own NEGATIVE suite. This
  // dimension is satisfied here by proving the STATE discriminant is never
  // misread — an already_done:false result never claims to be a no-op.)

  it("NEGATIVE: a real walk (already_done: false) never renders the no-op phrase", () => {
    const result: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 2 }),
      already_done: false,
      transitions: ["approved", "active", "archived"],
    };
    expect(formatDoneMessage(result)).not.toContain("idempotent");
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: the longest possible walk (draft -> archived, 3 steps) renders every step in order", () => {
    const result: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 4 }),
      already_done: false,
      transitions: ["approved", "active", "archived"],
    };
    const message = formatDoneMessage(result);
    const approvedIdx = message.indexOf("approved");
    const activeIdx = message.indexOf("active");
    const archivedIdx = message.lastIndexOf("archived");
    expect(approvedIdx).toBeGreaterThanOrEqual(0);
    expect(activeIdx).toBeGreaterThan(approvedIdx);
    expect(archivedIdx).toBeGreaterThan(activeIdx);
  });

  // ── ERROR ──────────────────────────────────────────────────────────────

  it("ERROR: an empty transitions array on a non-idempotent result renders no dangling arrow", () => {
    // reason: structurally unreachable in production (already_done: false always
    // carries ≥1 transition — computeArchiveWalk only returns [] for an already-
    // terminal status, which is exactly the already_done: true branch) — this
    // guards formatDoneMessage's OWN rendering against ever emitting a trailing
    // "-> " artifact if that invariant were ever violated upstream.
    const result: DoneResult = {
      task: makeTaskDoc({ status: "draft", version: 1 }),
      already_done: false,
      transitions: [],
    };
    const message = formatDoneMessage(result);
    expect(message.endsWith("-> ")).toBe(false);
    expect(message.endsWith(": ")).toBe(true);
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE: already_done discriminates the no-op branch from the real-walk branch", () => {
    const noOp: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 2 }),
      already_done: true,
      transitions: [],
    };
    const realWalk: DoneResult = {
      task: makeTaskDoc({ status: "archived", version: 2 }),
      already_done: false,
      transitions: ["archived"],
    };
    expect(formatDoneMessage(noOp)).toContain("no-op");
    expect(formatDoneMessage(realWalk)).not.toContain("no-op");
  });

  it("STATE: an idempotent no-op names the CURRENT terminal status, including 'deprecated' (not hardcoded 'archived')", () => {
    const deprecatedNoOp: DoneResult = {
      task: makeTaskDoc({ status: "deprecated", version: 3 }),
      already_done: true,
      transitions: [],
    };
    const message = formatDoneMessage(deprecatedNoOp);
    expect(message).toContain("already deprecated");
    expect(message).not.toContain("already archived");
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: message always leads with the doc's slug (stable prefix for scripting/grep)", () => {
    const result: DoneResult = {
      task: makeTaskDoc({ slug: "task-regression-check", status: "archived", version: 1 }),
      already_done: true,
      transitions: [],
    };
    expect(formatDoneMessage(result).startsWith("task-regression-check ")).toBe(true);
  });
});
