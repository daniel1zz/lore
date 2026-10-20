/**
 * @spec_ref spec-a-github-filed-defect-must-be-claimable-one-ingest-seam AC-GR-7
 *
 * `fileGithubIssue`'s split-write honesty (D8): once `GitHubIntakePort.fileIssue`
 * has landed the GitHub issue, a SUBSEQUENT failure minting the corpus task
 * must never surface as a generic error — the caller has a real, public
 * issue and no way to find it again unless the error names it. Mirrors the
 * SAME standard `github-intake-port.ts:320-330` already holds for its own
 * receipt-log-write half ("the upstream issue itself was NOT lost").
 *
 * This file ALSO covers the documented retry-path decision (this task's
 * bundle, "decide and document what the corpus write does on the retry
 * path"): `fileGithubIssue` does NOT re-attempt the corpus mint on the
 * retry branch (a prior successful filing for the exact same title is
 * already recorded in the local receipt log) — see
 * `report-issue-wiring.ts`'s module header for the full rationale. Proven
 * here by asserting the injected `corpusService.create` spy is never
 * invoked on that branch.
 *
 * `GitHubIntakePort` is mocked WHOLESALE (never partially) — this file's
 * scope is the WIRING layer's corpus-write behavior, not the port's own
 * `verifyTarget`/`searchDuplicates`/`fileIssue` internals (those already
 * have their own dedicated coverage: `github-intake-port-wiring.test.ts`,
 * `tests/integration/cli/github-intake-reach.bun.test.ts`). `GhRunner`/
 * `createNodeGhExecFile` are constructed for real inside `fileGithubIssue`
 * but never invoked (the mocked port's constructor ignores its `runner`
 * arg), so no real `gh` subprocess ever spawns.
 *
 * Runner: vitest (no `bun:sqlite` — `report-issue-wiring.ts` and its
 * value-level dependencies here touch only `node:fs` (the receipt log) and
 * `node:child_process` indirectly via the mocked-away `GhRunner`).
 *
 * Coverage: HAPPY / NEGATIVE / ERROR / STATE / REGRESSION.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok, err } from "@lore/core";
import type { CorpusService } from "../../../src/service/corpus-service.js";

// ─── GitHubIntakePort mocked wholesale — see this file's own header ────────

const verifyTargetMock = vi.fn();
const searchDuplicatesMock = vi.fn();
const fileIssueMock = vi.fn();

vi.mock("../../../src/service/github-intake-port.js", () => ({
  GitHubIntakePort: vi.fn().mockImplementation(() => ({
    verifyTarget: verifyTargetMock,
    searchDuplicates: searchDuplicatesMock,
    fileIssue: fileIssueMock,
  })),
}));

import { fileGithubIssue, type GithubFilingContext, type GithubReportInput, type GithubUpstreamCfg } from "../../../src/adapters/cli/report-issue-wiring.js";

const CFG: GithubUpstreamCfg = { repo: "acme/widget" };

const INPUT: GithubReportInput = {
  title: "lore issues exits 4 against a GitHub-configured corpus",
  description: "Steps to reproduce...",
  expected: "exit 0",
  actual: "exit 4",
  severity: "high",
  category: "regression",
  tags: ["cli", "github"],
};

const ROOT_PRD_DOC = { id: "01ROOTPRDULID00000000000A", slug: "prd-lore" };

function makeCorpusService(createImpl: ReturnType<typeof vi.fn>): CorpusService {
  return {
    list: vi.fn().mockResolvedValue(ok({ docs: [ROOT_PRD_DOC], total: 1 })),
    create: createImpl,
  } as unknown as CorpusService;
}

let corpusRoot: string;

beforeEach(() => {
  corpusRoot = mkdtempSync(join(tmpdir(), "lore-github-filing-split-write-"));
  verifyTargetMock.mockReset().mockResolvedValue(ok({ login: "acme", id: 555 }));
  searchDuplicatesMock.mockReset().mockResolvedValue(ok([]));
  fileIssueMock.mockReset().mockResolvedValue(
    ok({ number: 42, url: "https://github.com/acme/widget/issues/42", idempotencyKey: "01FILEDKEY000000000000A1" }),
  );
});

afterEach(() => {
  rmSync(corpusRoot, { recursive: true, force: true });
});

function makeContext(createImpl: ReturnType<typeof vi.fn>): GithubFilingContext {
  return {
    consumerCorpusRoot: corpusRoot,
    corpusService: makeCorpusService(createImpl),
    actor: "agent:test",
    home: homedir(),
    env: process.env,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-GR-7 — a corpus-write failure after a landed filing names the issue
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GR-7: a corpus-write failure after a landed filing names the issue number and URL", () => {
  it("ERROR: corpusService.create failing (STORE_ERROR) after a successful filing is reported with both the number and URL", async () => {
    const createMock = vi.fn().mockResolvedValue(err({ code: "STORE_ERROR", message: "disk full" }));
    const result = await fileGithubIssue(INPUT, CFG, makeContext(createMock));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    // fileGithubIssue's own contract: every corpus-write failure is wrapped
    // via buildPartialSuccessStoreError, always STORE_ERROR — narrow before
    // reading .message (several other LoreError members carry none).
    if (result.error.code !== "STORE_ERROR") throw new Error(`expected STORE_ERROR, got ${result.error.code}`);
    // Falsifier: replace buildPartialSuccessStoreError's message with a
    // generic "corpus write failed" string (D8's rejected alternative) —
    // both substring assertions below redden.
    expect(result.error.message).toContain("42");
    expect(result.error.message).toContain("https://github.com/acme/widget/issues/42");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("ERROR: corpusService.create failing with a code-only error (no .message, e.g. DUPLICATE_SLUG) still names the issue", async () => {
    const createMock = vi.fn().mockResolvedValue(err({ code: "DUPLICATE_SLUG", slug: "task-gh-555-42", existing_id: "01X" }));
    const result = await fileGithubIssue(INPUT, CFG, makeContext(createMock));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    if (result.error.code !== "STORE_ERROR") throw new Error(`expected STORE_ERROR, got ${result.error.code}`);
    expect(result.error.message).toContain("42");
    expect(result.error.message).toContain("https://github.com/acme/widget/issues/42");
  });

  it("HAPPY: a landed filing plus a successful corpus write returns the filed issue, un-retried, and mints an adhoc task", async () => {
    const createMock = vi.fn().mockResolvedValue(ok({ id: "01TASKULID", slug: "task-gh-555-42" }));
    const result = await fileGithubIssue(INPUT, CFG, makeContext(createMock));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.number).toBe(42);
    expect(result.value.retried).toBe(false);

    expect(createMock).toHaveBeenCalledTimes(1);
    const createdInput = createMock.mock.calls[0]?.[0];
    expect(createdInput.slug).toBe("task-gh-555-42");
    // parent_id is deliberately ABSENT (issue-task-shaping.ts's toIssueTaskInput
    // doc): an explicit parent_id naming the root PRD hits
    // PARENT_TYPE_CONTRACT.task's plan-only contract (INVALID_PARENT_TYPE) —
    // CorpusService._createImpl's adhoc auto-parenting is the only legal path.
    expect("parent_id" in createdInput).toBe(false);
    expect(createdInput.extra.adhoc).toBe(true);
    expect("plan_id" in createdInput.extra).toBe(false);
    expect(createdInput.extra.ac_scope).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Retry-path decision — documented in report-issue-wiring.ts's module
// header: the corpus mint is NOT re-attempted on a recognized retry.
// ═══════════════════════════════════════════════════════════════════════════

describe("retry-path decision: fileGithubIssue does not re-attempt the corpus mint on a recognized retry", () => {
  it("STATE: a prior successful filing recorded in the local receipt log short-circuits before any corpusService.create call", async () => {
    const receiptsPath = join(corpusRoot, ".lore", "issue-receipts-v2.jsonl");
    mkdirSync(join(corpusRoot, ".lore"), { recursive: true });
    const priorLines = [
      JSON.stringify({ phase: "intent", idempotency_key: "01PRIORKEY0000000000000A", title: INPUT.title, at: "2026-08-01T00:00:00.000Z" }),
      JSON.stringify({
        phase: "outcome",
        idempotency_key: "01PRIORKEY0000000000000A",
        number: 99,
        url: "https://github.com/acme/widget/issues/99",
        at: "2026-08-01T00:00:01.000Z",
      }),
    ];
    writeFileSync(receiptsPath, priorLines.join("\n") + "\n");

    const createMock = vi.fn().mockResolvedValue(ok({ id: "01TASKULID", slug: "task-gh-555-99" }));
    const result = await fileGithubIssue(INPUT, CFG, makeContext(createMock));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.number).toBe(99);
    expect(result.value.url).toBe("https://github.com/acme/widget/issues/99");
    expect(result.value.retried).toBe(true);

    // The decision under test: retry recognition never touches the corpus.
    // Falsifier: make the retry branch also call ctx.corpusService.create
    // (a naive "self-heal" attempt) — this assertion reddens from 0 to 1.
    expect(createMock).not.toHaveBeenCalled();
    // ...and it never even reaches the mocked GitHubIntakePort, confirming
    // "no network call at all" on this branch.
    expect(verifyTargetMock).not.toHaveBeenCalled();
    expect(fileIssueMock).not.toHaveBeenCalled();
  });

  it("REGRESSION: a title with no prior receipt still proceeds to file + mint normally", async () => {
    const createMock = vi.fn().mockResolvedValue(ok({ id: "01TASKULID", slug: "task-gh-555-42" }));
    const result = await fileGithubIssue(INPUT, CFG, makeContext(createMock));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.retried).toBe(false);
    expect(fileIssueMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
