/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries D7 (GS-T7)
 *
 * `fileGithubIssue` NEVER writes the corpus. This file previously covered the
 * split-write honesty of the retired mint step (a corpus-write failure after a
 * landed filing named the issue number and URL); the mint and that failure path
 * are deleted (GS-T7), so what remains to pin is the absence: the injected
 * `corpusService.create` is never invoked — not after a fresh filing, not on the
 * retry branch — and a filing failure propagates unchanged.
 *
 * `GitHubIntakePort` is mocked WHOLESALE (never partially) — this file's scope
 * is the WIRING layer's corpus behavior, not the port's own internals (covered by
 * `github-intake-port-wiring.test.ts` and
 * `tests/integration/cli/github-intake-reach.bun.test.ts`). The end-to-end
 * "docs/versions counts unchanged, receipts written" oracle is
 * `tests/integration/gs-t7-filing-no-corpus-doc.bun.test.ts`.
 *
 * Runner: vitest. Coverage: HAPPY / ERROR / STATE / REGRESSION.
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

/** A corpus service whose every WRITE verb is a spy; `list` answers the root PRD (the one read the filing needs). */
function makeCorpusService(): { service: CorpusService; writes: ReturnType<typeof vi.fn> } {
  const writes = vi.fn();
  const service = {
    list: vi.fn().mockResolvedValue(ok({ docs: [ROOT_PRD_DOC], total: 1 })),
    create: writes,
    update: writes,
    set: writes,
    link: writes,
  } as unknown as CorpusService;
  return { service, writes };
}

let corpusRoot: string;

beforeEach(() => {
  corpusRoot = mkdtempSync(join(tmpdir(), "lore-github-filing-no-write-"));
  verifyTargetMock.mockReset().mockResolvedValue(ok({ login: "acme", id: 555 }));
  searchDuplicatesMock.mockReset().mockResolvedValue(ok([]));
  fileIssueMock.mockReset().mockResolvedValue(
    ok({ number: 42, url: "https://github.com/acme/widget/issues/42", idempotencyKey: "01FILEDKEY000000000000A1" }),
  );
});

afterEach(() => {
  rmSync(corpusRoot, { recursive: true, force: true });
});

function makeContext(corpusService: CorpusService): GithubFilingContext {
  return {
    consumerCorpusRoot: corpusRoot,
    corpusService,
    actor: "agent:test",
    actorSource: "explicit",
    home: homedir(),
    env: process.env,
  };
}

describe("GS-T7: fileGithubIssue never writes the corpus", () => {
  it("HAPPY: a fresh filing returns the filed issue and calls no corpus write verb", async () => {
    const { service, writes } = makeCorpusService();
    const result = await fileGithubIssue(INPUT, CFG, makeContext(service));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.number).toBe(42);
    expect(result.value.url).toBe("https://github.com/acme/widget/issues/42");
    expect(result.value.retried).toBe(false);
    // Falsifier: re-enabling the mint call reddens this from 0 to 1.
    expect(writes).not.toHaveBeenCalled();
    expect(fileIssueMock).toHaveBeenCalledTimes(1);
  });

  it("ERROR: a fileIssue failure propagates unchanged and writes nothing", async () => {
    fileIssueMock.mockReset().mockResolvedValue(err({ code: "STORE_ERROR", message: "gh api rate limited" }));
    const { service, writes } = makeCorpusService();
    const result = await fileGithubIssue(INPUT, CFG, makeContext(service));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("STORE_ERROR");
    expect(writes).not.toHaveBeenCalled();
  });

  it("STATE: a prior successful filing in the local receipt log short-circuits with no network call and no corpus write", async () => {
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

    const { service, writes } = makeCorpusService();
    const result = await fileGithubIssue(INPUT, CFG, makeContext(service));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.number).toBe(99);
    expect(result.value.retried).toBe(true);
    expect(writes).not.toHaveBeenCalled();
    expect(verifyTargetMock).not.toHaveBeenCalled();
    expect(fileIssueMock).not.toHaveBeenCalled();
  });

  it("REGRESSION: a corpus with no root PRD is still refused before any GitHub write", async () => {
    const { service } = makeCorpusService();
    (service.list as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok({ docs: [], total: 0 }));
    const result = await fileGithubIssue(INPUT, CFG, makeContext(service));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(fileIssueMock).not.toHaveBeenCalled();
  });
});
