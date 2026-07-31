/**
 * RED (TDD) vitest suite for SPEC-072 `IssueReportService`
 * (`packages/lore/src/service/issue-report-service.ts` — DOES NOT EXIST YET).
 *
 * `IssueReportService` is the DI-only orchestrator behind `lore report-issue`:
 * it runs the §5 check sequence (fail-loud, cheapest-first, ZERO writes until
 * the `createDraft` step succeeds) over an injected `IssueReportDeps` bundle —
 * never touching `bun:sqlite`, config files, or the filesystem directly. All
 * fakes below satisfy the shapes named in SPEC-072 §4 Public Interface
 * (`IssueReportDeps` / `UpstreamPort` / `IssueReportInput` / `IssueReportResult`),
 * redeclared LOCALLY in this file rather than imported — the real
 * `flows/upstream-context-flow.ts` and `service/issue-report-service.ts`
 * modules do not exist yet, so importing types from them (even `import type`,
 * which still requires module resolution) would break `tsc`. `IssueReportPayload`,
 * `matchRootPrd`, `countOpenReports`, `buildIssueReportExtra`, `OPEN_REPORT_CAP`,
 * `ok`, `err` DO already exist in `@lore/core` (T1, merged) and are imported
 * for real.
 *
 * Module-resolution note (see also receipt-log.test.ts's header): a
 * literal-string `import("../../../src/service/issue-report-service.js")`
 * would be statically resolved by `tsc` and fail `bun run typecheck` with
 * TS2307 even under `--noEmit`. Routing the specifier through a `const`
 * (non-literal) opts the dynamic `import()` out of TypeScript's static
 * module-resolution check (verified empirically against this exact repo's
 * tsconfig: a literal `import("./does-not-exist.js")` is flagged, the same
 * call through a variable is not). `bun`'s runtime resolver has no such
 * literal-only restriction — the import still rejects at test-run time with
 * a real "Cannot find module" error, which is exactly the RED failure this
 * suite exists to produce.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: SPEC-072 §4 Public Interface, §5 check sequence, §Acceptance Criteria
 *   AC-072-7, AC-072-13.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  ok,
  err,
  buildIssueReportExtra,
  UNKNOWN_CONTENDING_SOURCE,
  type LoreConfig,
  type LoreError,
  type Result,
} from "@lore/core";

// ─── Locally-redeclared SPEC-072 §4 shapes (SUT modules don't exist yet) ────

interface LocalUpstreamPort {
  resolveRootDoc(): Promise<Result<{ id: string; slug: string } | null, LoreError>>;
  listOpenAdhocDrafts(): Promise<Result<Array<{ id: string; status: string; extra?: unknown }>, LoreError>>;
  searchDuplicates(query: string, limit: number): Promise<Result<string[], LoreError>>;
  createDraft(input: {
    title: string;
    content: string;
    extra: Record<string, unknown>;
  }): Promise<Result<{ id: string }, LoreError>>;
  close(): void;
}

interface LocalReceiptLog {
  append(e: { upstream_doc_id: string; title: string; at: string }): Result<void, LoreError>;
  read(): Result<{ entries: unknown[]; corrupt_lines: number[] }, LoreError>;
}

interface LocalIssueReportDeps {
  loadUpstreamConfig: (root: string) => Result<LoreConfig, LoreError>;
  probe: (dbPath: string) => Result<{ user_version: number }, LoreError>;
  expectedSchemaVersion: number;
  openUpstream: (root: string) => Result<LocalUpstreamPort, LoreError>;
  receipts: LocalReceiptLog;
  loreVersion: string;
  reporterProject: string;
  /**
   * The DECLARED write-wait bound the upstream connection was opened with
   * (spec-report-issue-has-no-specified-concurrency-contract-ac-072 D4) —
   * surfaced verbatim in a `WRITE_CONTENTION` refusal.
   */
  writeWaitMs: number;
  now: () => string;
}

interface LocalIssueReportInput {
  title: string;
  description: string;
  expected: string;
  actual: string;
  repro_command?: string;
  by?: string;
}

type LocalCfg = { corpus_path: string; root_prd: string };

// ─── Dynamic import helper (module does not exist yet — see header note) ────

const ISSUE_REPORT_SERVICE_MODULE_SPECIFIER = "../../../src/service/issue-report-service.js";

async function importIssueReportService(): Promise<{
  IssueReportService: new (deps: LocalIssueReportDeps) => {
    report(
      input: LocalIssueReportInput,
      cfg: LocalCfg | undefined,
    ): Promise<Result<{ upstream_doc_id: string; possible_duplicates: string[]; dedup_degraded: boolean }, LoreError>>;
    list(cfg: LocalCfg): Promise<Result<unknown[], LoreError>>;
  };
}> {
  const mod = await import(ISSUE_REPORT_SERVICE_MODULE_SPECIFIER);
  const IssueReportService = (mod as any).IssueReportService;
  if (typeof IssueReportService !== "function") {
    throw new Error(
      "issue-report-service.ts does not export IssueReportService — implementation missing (RED expected)",
    );
  }
  return { IssueReportService };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_INPUT: LocalIssueReportInput = {
  title: "lore create prd crashes on empty title",
  description: "Filing an empty --title should fail loud, not crash.",
  expected: "exit 4 VALIDATION_ERROR",
  actual: "exit 1 unhandled TypeError",
  repro_command: "lore create prd --title ''",
};

const BASE_CFG: LocalCfg = { corpus_path: "/tmp/upstream-corpus", root_prd: "prd-lore" };

const NOW_ISO = "2026-07-24T00:00:00.000Z";

/**
 * A non-default declared bound, so the WRITE_CONTENTION cases below prove the
 * service SURFACES the injected bound rather than a hardcoded 2000 that would
 * look identical to the schema default.
 */
const DECLARED_WRITE_WAIT_MS = 1234;

function makeFakePort(overrides: Partial<LocalUpstreamPort> = {}): LocalUpstreamPort {
  return {
    resolveRootDoc: vi.fn(async () => ok({ id: "01ROOTPRD", slug: "prd-lore" })),
    listOpenAdhocDrafts: vi.fn(async () => ok([])),
    searchDuplicates: vi.fn(async () => ok([])),
    createDraft: vi.fn(async () => ok({ id: "01NEWDOC" })),
    close: vi.fn(),
    ...overrides,
  };
}

function makeFakeDeps(
  overrides: Partial<Omit<LocalIssueReportDeps, "receipts">> & { port?: LocalUpstreamPort; receipts?: LocalReceiptLog } = {},
): { deps: LocalIssueReportDeps; port: LocalUpstreamPort } {
  const port = overrides.port ?? makeFakePort();
  const receipts: LocalReceiptLog = overrides.receipts ?? {
    append: vi.fn(() => ok(undefined)),
    read: vi.fn(() => ok({ entries: [], corrupt_lines: [] })),
  };
  const deps: LocalIssueReportDeps = {
    loadUpstreamConfig: vi.fn(() => ok({} as LoreConfig)),
    probe: vi.fn(() => ok({ user_version: 7 })),
    expectedSchemaVersion: 7,
    openUpstream: vi.fn(() => ok(port)),
    receipts,
    loreVersion: "0.9.0",
    reporterProject: "consumer-a",
    writeWaitMs: DECLARED_WRITE_WAIT_MS,
    now: () => NOW_ISO,
    ...overrides,
  };
  return { deps, port };
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

describe("SPEC-072 IssueReportService (RED — packages/lore/src/service/issue-report-service.ts not implemented yet)", () => {
  it("ERROR: createDraft failure propagates VERBATIM (same code+message) and receipts.append is never called (AC-072-7)", async () => {
    const { IssueReportService } = await importIssueReportService();
    const failure: LoreError = { code: "STORE_ERROR", message: "upstream write failed: disk full" };
    const port = makeFakePort({ createDraft: vi.fn(async () => err(failure)) });
    const { deps } = makeFakeDeps({ port });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(failure);
    }
    expect(deps.receipts.append).not.toHaveBeenCalled();
  });

  // ── AC-IC-1/AC-IC-4 (spec-report-issue-has-no-specified-concurrency-contract-ac-072) ──
  // A contended write is the ONE documented narrowing of the verbatim-propagation
  // invariant asserted directly above: the same fact gets a truthful
  // classification (contention, not "the store is broken"), which is what earns
  // the declared exit code and the declared 3-part message. Everything else —
  // including the `disk full` store error above — still propagates byte-identically.
  it("ERROR: a CONTENDED createDraft failure is re-typed as WRITE_CONTENTION carrying the declared bound, corpus path and unknown-source; no receipt is written", async () => {
    const { IssueReportService } = await importIssueReportService();
    const sqliteBusy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY", errno: 5 });
    const failure: LoreError = { code: "STORE_ERROR", message: "database is locked", cause: sqliteBusy };
    const port = makeFakePort({ createDraft: vi.fn(async () => err(failure)) });
    const { deps } = makeFakeDeps({ port });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "WRITE_CONTENTION",
        operation: "report-issue",
        corpus_path: `${BASE_CFG.corpus_path}/.lore/lore.db`,
        bound_ms: DECLARED_WRITE_WAIT_MS,
        source: UNKNOWN_CONTENDING_SOURCE,
      });
    }
    // Zero writes on a refusal — the receipt log must not record a report that
    // never landed upstream.
    expect(deps.receipts.append).not.toHaveBeenCalled();
  });

  it("BOUNDARY: contention detected from the driver CODE alone (a cause with SQLITE_BUSY but an unrecognisable message)", async () => {
    const { IssueReportService } = await importIssueReportService();
    const sqliteBusy = Object.assign(new Error("cannot start a transaction within a transaction"), {
      code: "SQLITE_BUSY",
    });
    const port = makeFakePort({
      createDraft: vi.fn(async () =>
        err({
          code: "STORE_ERROR",
          message: "cannot start a transaction within a transaction",
          cause: sqliteBusy,
        } as LoreError),
      ),
    });
    const { deps } = makeFakeDeps({ port });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WRITE_CONTENTION");
    }
  });

  // ── The openUpstream rail (task-openvalidatedupstream-lets-a-synchronous-store-init-throw) ──
  //
  // `deps.openUpstream` opens a READ-WRITE handle against the same file
  // `createDraft` later writes to, so it contends for the same lock — and its
  // constructor used to raise `database is locked` SYNCHRONOUSLY, sailing past
  // this service's `if (!portResult.ok)` rail and killing the process with a
  // raw stack trace (measured: 92 of ~300 attempts of the concurrency
  // harness). The port now upholds its declared `Result` contract — the throw
  // is caught where the handle is opened (`buildUpstreamContext`) and returned
  // as the `STORE_ERROR` these two tests inject — so the classification below
  // is reached at all. The failure shape used here is exactly what
  // `store-shared.ts::wrapStoreError` builds from a caught bun:sqlite error:
  // the driver's own message, plus the original error as `cause` (which is
  // what carries the `SQLITE_BUSY` code through).
  it("ERROR: a CONTENDED openUpstream failure is re-typed as WRITE_CONTENTION carrying the declared bound; createDraft is never reached and no receipt is written", async () => {
    const { IssueReportService } = await importIssueReportService();
    const sqliteBusy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY", errno: 5 });
    const failure: LoreError = { code: "STORE_ERROR", message: "database is locked", cause: sqliteBusy };
    const { deps, port } = makeFakeDeps({ openUpstream: vi.fn(() => err(failure)) });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "WRITE_CONTENTION",
        operation: "report-issue",
        corpus_path: `${BASE_CFG.corpus_path}/.lore/lore.db`,
        bound_ms: DECLARED_WRITE_WAIT_MS,
        source: UNKNOWN_CONTENDING_SOURCE,
      });
    }
    // Refused before the port ever existed: nothing was written anywhere.
    expect(port.createDraft).not.toHaveBeenCalled();
    expect(deps.receipts.append).not.toHaveBeenCalled();
  });

  it("NEGATIVE: a NON-contention openUpstream failure propagates VERBATIM — a corrupt or unreadable upstream must never masquerade as contention", async () => {
    const { IssueReportService } = await importIssueReportService();
    const failure: LoreError = {
      code: "STORE_ERROR",
      message: "file is not a database",
      cause: Object.assign(new Error("file is not a database"), { code: "SQLITE_NOTADB" }),
    };
    const { deps } = makeFakeDeps({ openUpstream: vi.fn(() => err(failure)) });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(failure);
    }
    expect(deps.receipts.append).not.toHaveBeenCalled();
  });

  it("NEGATIVE: a non-contention store failure with a malformed cause still propagates VERBATIM (no accidental re-typing)", async () => {
    const { IssueReportService } = await importIssueReportService();
    const failure: LoreError = {
      code: "STORE_ERROR",
      message: "no such table: docs",
      cause: Object.assign(new Error("no such table: docs"), { code: 42 }),
    };
    const port = makeFakePort({ createDraft: vi.fn(async () => err(failure)) });
    const { deps } = makeFakeDeps({ port });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(failure);
    }
  });

  it("NEGATIVE: cfg unset (feedback.upstream not configured) → VALIDATION_ERROR naming both feedback.upstream.corpus_path and feedback.upstream.root_prd; no dep beyond config invoked", async () => {
    const { IssueReportService } = await importIssueReportService();
    const { deps } = makeFakeDeps();
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      const message = (result.error as { message: string }).message;
      expect(message).toContain("feedback.upstream.corpus_path");
      expect(message).toContain("feedback.upstream.root_prd");
    }
    expect(deps.loadUpstreamConfig).not.toHaveBeenCalled();
    expect(deps.probe).not.toHaveBeenCalled();
    expect(deps.openUpstream).not.toHaveBeenCalled();
    expect(deps.receipts.append).not.toHaveBeenCalled();
  });

  it("NEGATIVE: probe user_version !== expectedSchemaVersion → VALIDATION_ERROR naming both versions; openUpstream never called (ordering)", async () => {
    const { IssueReportService } = await importIssueReportService();
    const { deps } = makeFakeDeps({
      probe: vi.fn(() => ok({ user_version: 5 })),
      expectedSchemaVersion: 7,
    });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      const message = (result.error as { message: string }).message;
      expect(message).toContain("5");
      expect(message).toContain("7");
    }
    expect(deps.openUpstream).not.toHaveBeenCalled();
  });

  it("NEGATIVE: upstream config sync.enabled=true → VALIDATION_ERROR naming the v1 SQLite-only constraint; probe never called (config check precedes probe)", async () => {
    const { IssueReportService } = await importIssueReportService();
    const { deps } = makeFakeDeps({
      loadUpstreamConfig: vi.fn(() => ok({ sync: { enabled: true } } as unknown as LoreConfig)),
    });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      const message = (result.error as { message: string }).message.toLowerCase();
      expect(message).toContain("sqlite");
    }
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it("NEGATIVE: root-PRD mismatch (matchRootPrd fails) → VALIDATION_ERROR naming expected vs found; createDraft never called", async () => {
    const { IssueReportService } = await importIssueReportService();
    const port = makeFakePort({
      resolveRootDoc: vi.fn(async () => ok({ id: "01OTHERROOT", slug: "prd-other-project" })),
    });
    const { deps } = makeFakeDeps({ port });
    const service = new IssueReportService(deps);

    // BASE_CFG.root_prd === "prd-lore"; upstream's actual root is "prd-other-project".
    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      const message = (result.error as { message: string }).message;
      expect(message).toContain("prd-lore"); // expected
      expect(message).toContain("prd-other-project"); // found
    }
    expect(port.createDraft).not.toHaveBeenCalled();
  });

  it("NEGATIVE: 10 open reports already filed by this reporter_project → VALIDATION_ERROR listing the 10 open ids; createDraft never called", async () => {
    const { IssueReportService } = await importIssueReportService();
    const openTasks = Array.from({ length: 10 }, (_, i) => ({
      id: `01OPENTASK${i}`,
      status: "draft",
      extra: buildIssueReportExtra({
        reporter_project: "consumer-a",
        reporter_actor: "agent:consumer-a",
        lore_version: "0.9.0",
        expected: "e",
        actual: "a",
        reported_at: NOW_ISO,
        possible_duplicates: [],
      }),
    }));
    const port = makeFakePort({ listOpenAdhocDrafts: vi.fn(async () => ok(openTasks)) });
    const { deps } = makeFakeDeps({ port, reporterProject: "consumer-a" });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      const message = (result.error as { message: string }).message;
      for (const task of openTasks) {
        expect(message).toContain(task.id);
      }
    }
    expect(port.createDraft).not.toHaveBeenCalled();
  });

  it("STATE: searchDuplicates failure degrades to dedup_degraded=true but still proceeds to createDraft (advisory never blocks)", async () => {
    const { IssueReportService } = await importIssueReportService();
    const port = makeFakePort({
      searchDuplicates: vi.fn(async () => err({ code: "STORE_ERROR", message: "fts5 unavailable" })),
    });
    const { deps } = makeFakeDeps({ port });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dedup_degraded).toBe(true);
    }
    expect(port.createDraft).toHaveBeenCalledTimes(1);
  });

  it("HAPPY: successful createDraft appends exactly one receipt, strictly AFTER createDraft resolves, with {upstream_doc_id,title,at}", async () => {
    const { IssueReportService } = await importIssueReportService();
    const callOrder: string[] = [];
    const port = makeFakePort({
      createDraft: vi.fn(async () => {
        callOrder.push("createDraft");
        return ok({ id: "01NEWDOCID" });
      }),
    });
    const receipts: LocalReceiptLog = {
      append: vi.fn((entry: { upstream_doc_id: string; title: string; at: string }) => {
        callOrder.push("append");
        return ok(undefined);
      }),
      read: vi.fn(() => ok({ entries: [], corrupt_lines: [] })),
    };
    const { deps } = makeFakeDeps({ port, receipts });
    const service = new IssueReportService(deps);

    const result = await service.report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(true);
    expect(receipts.append).toHaveBeenCalledTimes(1);
    // Ordering: createDraft must resolve BEFORE append is invoked (§5 step 9:
    // "only after step-8 success").
    expect(callOrder).toEqual(["createDraft", "append"]);

    const appendMock = receipts.append as ReturnType<typeof vi.fn>;
    const firstCall = appendMock.mock.calls[0];
    if (!firstCall) throw new Error("receipts.append was not called");
    const appendedEntry = firstCall[0] as { upstream_doc_id: string; title: string; at: string };
    expect(appendedEntry.upstream_doc_id).toBe("01NEWDOCID");
    expect(appendedEntry.title).toBe(BASE_INPUT.title);
    expect(typeof appendedEntry.at).toBe("string");
  });

  // ─── AC-072-13: static import-graph pin ──────────────────────────────────

  it("AC-072-13: issue-report-service.ts has no value import of flows/* or bun:sqlite (import type allowed)", () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // tests/unit/service -> src/service (3 levels up + src/service)
    const serviceSourcePath = resolve(__dirname, "../../../src/service/issue-report-service.ts");

    // The implementation module does not exist yet — this read is expected to
    // throw ENOENT (a legitimate RED failure: the file this AC pins doesn't
    // exist to be scanned).
    const content = readFileSync(serviceSourcePath, "utf8");

    // No bare `bun:sqlite` VALUE import (type-only via `import type` allowed).
    const bunSqliteValueImport = /^\s*import\s+(?!type\b)[^;]*from\s+["']bun:sqlite["']/m;
    expect(bunSqliteValueImport.test(content)).toBe(false);

    // No bare `flows/*` VALUE import (type-only via `import type` allowed) —
    // matches any relative specifier whose path contains a `flows/` segment,
    // regardless of how many `../` levels precede it.
    const flowsValueImport = /^\s*import\s+(?!type\b)[^;]*from\s+["'][^"']*\/flows\/[^"']*["']/m;
    expect(flowsValueImport.test(content)).toBe(false);
  });
});
