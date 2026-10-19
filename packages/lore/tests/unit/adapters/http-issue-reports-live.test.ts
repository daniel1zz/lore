/**
 * Tests for `GET /api/issue-reports` on the live model (spec-github-owns-issue-report-state-no-mirror-task-work-carries
 * T9, AC-GS-14): the route serves only the live join of the GitHub listing and the carriers, and maps `gh`
 * errors to HTTP statuses without ever answering an empty list for a failed listing.
 *
 * Harness: `InMemoryStore` + a real `CorpusService`; the intake port is a stub, so nothing here reaches GitHub.
 * Carriers and the legacy mirror task are inserted through the bare store (the service refuses to write a
 * legacy `extra.issue_report`).
 *
 * Dimensions: HAPPY (adopted row), NEGATIVE (empty listing, legacy task), ERROR (three gh errors), BOUNDARY
 * (carrier naming an unlisted issue, wrong repo id), STATE (unwired intake), REGRESSION (no mirror read).
 */

import { describe, it, expect } from "vitest";
import type { LoreError, Result } from "@lore/core";
import { err, ok } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { handleGetIssueReports, type IssueListingPort } from "../../../src/adapters/http/issue-reports-routes.js";
import type { GithubListedIssue, GithubListing } from "../../../src/service/github-intake-port.js";
import type { App } from "../../../src/app.js";
import { makeDoc } from "../store/store-core.shared.js";

const SPEC = "spec-github-owns-issue-report-state-no-mirror-task-work-carries";
const REPO_ID = 4242;

function makeApp(store: InMemoryStore, issueIntake?: App["issueIntake"]): App {
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return { corpusService, ...(issueIntake === undefined ? {} : { issueIntake }) } as unknown as App;
}

function listedIssue(number: number, state = "open"): GithubListedIssue {
  return { number, title: `Issue ${number}`, state, body: "", labels: [], state_reason: null };
}

function stubPort(opts: {
  issues?: GithubListedIssue[];
  verifyError?: LoreError;
  listError?: LoreError;
}): IssueListingPort {
  return {
    verifyTarget: async (): Promise<Result<{ login: string; id: number }, LoreError>> =>
      opts.verifyError === undefined ? ok({ login: "tester", id: REPO_ID }) : err(opts.verifyError),
    listIssues: async (): Promise<Result<GithubListing, LoreError>> =>
      opts.listError === undefined ? ok({ issues: opts.issues ?? [], pages: 1 }) : err(opts.listError),
  };
}

async function insertCarrier(store: InMemoryStore, slug: string, number: number, repoId = REPO_ID): Promise<void> {
  const inserted = await store.insert(
    makeDoc({ type: "task", role: "plan", slug, title: slug, extra: { issues: [{ repo_id: repoId, number }] } }),
  );
  if (!inserted.ok) throw new Error(`carrier insert failed: ${JSON.stringify(inserted.error)}`);
}

async function insertLegacyMirrorTask(store: InMemoryStore, slug: string): Promise<void> {
  const inserted = await store.insert(
    makeDoc({
      type: "task",
      role: "plan",
      slug,
      title: "Legacy mirror",
      status: "draft",
      extra: { issue_report: { reporter_project: "p", reported_at: "2026-01-01T00:00:00Z", possible_duplicates: [] } },
    }),
  );
  if (!inserted.ok) throw new Error(`legacy insert failed: ${JSON.stringify(inserted.error)}`);
}

interface Body {
  rows?: Array<Record<string, unknown>>;
  open_count?: number;
}
async function readBody(res: Response): Promise<{ ok: boolean; data?: Body; error?: Record<string, unknown> }> {
  return (await res.json()) as { ok: boolean; data?: Body; error?: Record<string, unknown> };
}

describe(`${SPEC}#AC-GS-14 HTTP issue route serves only the live join`, () => {
  it(`${SPEC}#AC-GS-14 HAPPY: an open listed issue with an unclaimed draft carrier is one adopted row`, async () => {
    const store = new InMemoryStore();
    await insertCarrier(store, "task-carrier-30", 30);
    const res = await handleGetIssueReports(makeApp(store), stubPort({ issues: [listedIssue(30)] }));

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.data?.rows).toHaveLength(1);
    expect(body.data?.rows?.[0]).toMatchObject({ number: 30, status: "adopted", carrier: "task-carrier-30" });
    expect(body.data?.open_count).toBe(0);
  });

  it(`${SPEC}#AC-GS-14 HAPPY: a listed issue with no carrier is open and counted`, async () => {
    const res = await handleGetIssueReports(makeApp(new InMemoryStore()), stubPort({ issues: [listedIssue(7)] }));
    const body = await readBody(res);
    expect(body.data?.rows?.[0]).toMatchObject({ number: 7, status: "open", carrier: null });
    expect(body.data?.open_count).toBe(1);
  });

  it(`${SPEC}#AC-GS-14 NEGATIVE: an empty listing yields zero rows even when a carrier names #30`, async () => {
    const store = new InMemoryStore();
    await insertCarrier(store, "task-carrier-30", 30);
    const res = await handleGetIssueReports(makeApp(store), stubPort({ issues: [] }));
    expect(res.status).toBe(200);
    expect((await readBody(res)).data?.rows).toEqual([]);
  });

  it(`${SPEC}#AC-GS-14 REGRESSION: a legacy draft task with extra.issue_report is never a row`, async () => {
    const store = new InMemoryStore();
    await insertLegacyMirrorTask(store, "task-legacy-mirror");
    const res = await handleGetIssueReports(makeApp(store), stubPort({ issues: [] }));
    const body = await readBody(res);
    expect(body.data?.rows).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("task-legacy-mirror");
  });

  it(`${SPEC}#AC-GS-14 BOUNDARY: a carrier of another repo id does not claim the listed issue`, async () => {
    const store = new InMemoryStore();
    await insertCarrier(store, "task-other-repo", 30, REPO_ID + 1);
    const res = await handleGetIssueReports(makeApp(store), stubPort({ issues: [listedIssue(30)] }));
    expect((await readBody(res)).data?.rows?.[0]).toMatchObject({ number: 30, status: "open", carrier: null });
  });

  const gh: Array<[string, LoreError, number]> = [
    ["AUTH_REQUIRED", { code: "AUTH_REQUIRED", message: "run gh auth login", retryable: false }, 401],
    ["TRANSPORT_UNAVAILABLE", { code: "TRANSPORT_UNAVAILABLE", message: "offline", retryable: true }, 503],
    ["RATE_LIMITED", { code: "RATE_LIMITED", message: "slow down", reset: 1_900_000_000, retryable: true }, 429],
  ];
  for (const [code, error, status] of gh) {
    for (const stage of ["verifyError", "listError"] as const) {
      it(`${SPEC}#AC-GS-14 ERROR: ${code} from ${stage === "verifyError" ? "verifyTarget" : "listIssues"} is HTTP ${status} with no rows key`, async () => {
        const store = new InMemoryStore();
        await insertCarrier(store, "task-carrier-30", 30);
        const res = await handleGetIssueReports(makeApp(store), stubPort({ issues: [listedIssue(30)], [stage]: error }));
        expect(res.status).toBe(status);
        const body = await readBody(res);
        expect(body.ok).toBe(false);
        expect(body.error?.["code"]).toBe(code);
        expect(body).not.toHaveProperty("rows");
        expect(body).not.toHaveProperty("data");
        if (code === "RATE_LIMITED") expect(body.error?.["reset"]).toBe(1_900_000_000);
      });
    }
  }

  it(`${SPEC}#AC-GS-14 STATE: an unwired intake is a loud 422, never an empty list`, async () => {
    const res = await handleGetIssueReports(makeApp(new InMemoryStore()));
    expect(res.status).toBe(422);
    expect(await readBody(res)).not.toHaveProperty("data");
  });

  it(`${SPEC}#AC-GS-14 STATE: the wired app.issueIntake is the default port`, async () => {
    const store = new InMemoryStore();
    const res = await handleGetIssueReports(makeApp(store, ok(stubPort({ issues: [listedIssue(9)] }))));
    expect((await readBody(res)).data?.rows?.[0]).toMatchObject({ number: 9 });
  });
});
