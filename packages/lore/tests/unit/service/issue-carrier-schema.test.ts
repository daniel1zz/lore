/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-11
 * @task task-skill-refactor-gs-t1-carrier-schema-extra-issues-retired
 *
 * The carrier schema: `extra.issues: [{repo_id, number}]` on a task or plan is the only way work names
 * a GitHub issue. The retired shapes (`extra.issue_report`, the `resolves` link type) are refused.
 *
 * Oracles:
 *   - SERVICE layer (`CorpusService` over an InMemoryStore): the layer the CLI, MCP, HTTP and batch share.
 *     The refusal is asserted HERE because a check that lives only in the CLI adapter passes every CLI case
 *     while an MCP or batch write slips through (the green-but-broken shape this AC exists to catch).
 *   - CLI layer (`runLoreInProcess`) against a throwaway corpus (`mkdtemp` + `lore init`) and a recording `gh`
 *     stub on PATH: never the repository's own `.lore`, never the real GitHub.
 *
 * Six-dimension note: HAPPY (`--issue 7 --issue 9` writes the carrier), NEGATIVE (retired shapes refused),
 * BOUNDARY (50 refs accepted / 51 refused, zero number), ERROR (exit exactly 4), STATE (`--issue 99` writes
 * nothing: doc count unchanged), REGRESSION (a plain task with no issues is unaffected).
 *
 * Made red once by removing 'issue_report' from RETIRED_EXTRA_KEYS in CorpusService.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateDocInput, LoreError } from "@lore/core";

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { recordLockGateOff } from "../../helpers/record-lock-gate-off.js";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { cleanupRecordingGhStubDir, recordingGhStubDir, setStubIssues } from "../../integration/helpers/recording-gh-stub";
import { actedStore } from "../../live-invocation.js";

const ID = "spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-11";
const REPO = "acme-test/gs-t1-carrier";
const REPO_ID = 880_001;
const CLI_TIMEOUT_MS = 120_000;

// ─── service-layer fixtures ────────────────────────────────────────────────────

async function makeService(): Promise<{ service: CorpusService; taskId: string; specId: string }> {
  const store = actedStore(new InMemoryStore());
  const service = new CorpusService(store, recordLockGateOff(store));
  const prd = await service.create({ type: "prd", title: "Root", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error(`prd: ${JSON.stringify(prd.error)}`);
  const task = await service.create({
    type: "task",
    title: "Carrier candidate",
    content: "body",
    extra: { adhoc: true, ac_scope: [] },
  } as CreateDocInput);
  if (!task.ok) throw new Error(`task: ${JSON.stringify(task.error)}`);
  const spec = await service.create({ type: "spec", title: "A spec", content: "spec body" } as CreateDocInput);
  if (!spec.ok) throw new Error(`spec: ${JSON.stringify(spec.error)}`);
  return { service, taskId: task.value.id, specId: spec.value.id };
}

function expectValidation(error: LoreError, field: string): void {
  expect(error.code).toBe("VALIDATION_ERROR");
  expect((error as { field?: string }).field).toBe(field);
}

function refs(count: number): Array<{ repo_id: number; number: number }> {
  return Array.from({ length: count }, (_, index) => ({ repo_id: REPO_ID, number: index + 1 }));
}

// ─── CLI fixtures ──────────────────────────────────────────────────────────────

let ghStub: string;
let corpus: string;

async function lore(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runLoreInProcess(args, {
    cwd: corpus,
    home: corpus,
    env: { ...process.env, HOME: corpus, CLAUDECODE: "1", PATH: ghStub, EDITOR: "true" },
  });
}

async function listDocs(): Promise<Array<{ slug: string; type: string; extra: Record<string, unknown> }>> {
  const listed = await lore(["list", "--json"]);
  expect(listed.exitCode, listed.stderr).toBe(0);
  return (JSON.parse(listed.stdout) as { data: Array<{ slug: string; type: string; extra: Record<string, unknown> }> }).data;
}

beforeAll(async () => {
  ghStub = recordingGhStubDir({
    repoId: REPO_ID,
    issues: [
      { number: 7, title: "seven", state: "open" },
      { number: 9, title: "nine", state: "open" },
    ],
  });
  corpus = mkdtempSync(join(tmpdir(), "lore-gs-t1-corpus-"));
  const init = await lore(["init"]);
  if (init.exitCode !== 0) throw new Error(`init failed: ${init.stderr}`);
  const prd = await lore(["create", "prd", "--title", "gs-t1 root", "--content", "root", "--no-ai"]);
  if (prd.exitCode !== 0) throw new Error(`prd failed: ${prd.stderr}`);
  const configPath = join(corpus, ".lore", "config.yaml");
  writeFileSync(configPath, `${readFileSync(configPath, "utf8")}feedback:\n  upstream:\n    repo: ${REPO}\n`);
}, CLI_TIMEOUT_MS);

afterAll(() => {
  cleanupRecordingGhStubDir(ghStub);
  rmSync(corpus, { recursive: true, force: true });
});

// ─── service layer ─────────────────────────────────────────────────────────────

describe(`${ID}: the service refuses the retired and malformed carrier shapes`, () => {
  it(`${ID}: create with extra.issue_report is refused, naming 'lore issues migrate --apply'`, async () => {
    const { service } = await makeService();
    const result = await service.create({
      type: "task",
      title: "Legacy report",
      content: "body",
      extra: { adhoc: true, ac_scope: [], issue_report: { github: { number: 1 } } },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectValidation(result.error, "extra.issue_report");
    expect((result.error as { message: string }).message).toContain("lore issues migrate --apply");
  });

  it(`${ID}: set with extra.issue_report is refused, naming 'lore issues migrate --apply'`, async () => {
    const { service, taskId } = await makeService();
    const result = await service.set(taskId, { extra: { adhoc: true, issue_report: { github: { number: 1 } } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectValidation(result.error, "extra.issue_report");
    expect((result.error as { message: string }).message).toContain("lore issues migrate --apply");
  });

  it(`${ID}: creating a link of type 'resolves' is refused`, async () => {
    const { service, taskId, specId } = await makeService();
    const result = await service.link(specId, taskId, "resolves");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it(`${ID}: a spec with extra.issues is refused (a spec is not a carrier)`, async () => {
    const { service, specId } = await makeService();
    const created = await service.create({
      type: "spec",
      title: "Spec with issues",
      content: "body",
      extra: { issues: refs(1) },
    } as CreateDocInput);
    expect(created.ok).toBe(false);
    if (!created.ok) expectValidation(created.error, "extra.issues");

    const patched = await service.set(specId, { extra: { issues: refs(1) } });
    expect(patched.ok).toBe(false);
    if (!patched.ok) expectValidation(patched.error, "extra.issues");
  });

  it.each([
    ["a duplicate ref", [{ repo_id: REPO_ID, number: 5 }, { repo_id: REPO_ID, number: 5 }]],
    ["a zero number", [{ repo_id: REPO_ID, number: 0 }]],
    ["a negative repo_id", [{ repo_id: -1, number: 3 }]],
    ["a non-integer number", [{ repo_id: REPO_ID, number: 1.5 }]],
    ["an empty array", []],
    ["51 refs", refs(51)],
  ])(`${ID}: extra.issues with %s is refused on set`, async (_label, issues) => {
    const { service, taskId } = await makeService();
    const result = await service.set(taskId, { extra: { adhoc: true, issues } });
    expect(result.ok).toBe(false);
    if (!result.ok) expectValidation(result.error, "extra.issues");
  });

  it(`${ID}: extra.issues with 51 refs is refused on create, 50 distinct refs are accepted`, async () => {
    const { service, taskId } = await makeService();
    const tooMany = await service.create({
      type: "task",
      title: "Fifty one",
      content: "body",
      extra: { adhoc: true, ac_scope: [], issues: refs(51) },
    } as CreateDocInput);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expectValidation(tooMany.error, "extra.issues");

    const fifty = await service.set(taskId, { extra: { adhoc: true, ac_scope: [], issues: refs(50) } });
    expect(fifty.ok, JSON.stringify(fifty)).toBe(true);
  });

  it(`${ID}: a task carrying valid extra.issues is accepted and the refs are stored as given`, async () => {
    const { service, taskId } = await makeService();
    const issues = [{ repo_id: REPO_ID, number: 7 }, { repo_id: REPO_ID, number: 9 }];
    const result = await service.set(taskId, { extra: { adhoc: true, ac_scope: [], issues } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const read = await service.get(taskId);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.doc.extra["issues"]).toEqual(issues);
  });
});

// ─── CLI layer ─────────────────────────────────────────────────────────────────

describe(`${ID}: the CLI exits 4 for the same refusals and --issue writes the carrier`, () => {
  it(
    `${ID}: lore link --type resolves exits exactly 4`,
    async () => {
      const a = await lore(["create", "task", "--title", "link from", "--adhoc", "--ac-scope", "", "--content", "b", "--no-ai", "--json"]);
      const b = await lore(["create", "task", "--title", "link to", "--adhoc", "--ac-scope", "", "--content", "b", "--no-ai", "--json"]);
      expect(a.exitCode, a.stderr).toBe(0);
      expect(b.exitCode, b.stderr).toBe(0);
      const from = (JSON.parse(a.stdout) as { data: { slug: string } }).data.slug;
      const to = (JSON.parse(b.stdout) as { data: { slug: string } }).data.slug;
      const linked = await lore(["link", from, to, "--type", "resolves"]);
      expect(linked.exitCode, linked.stderr).toBe(4);
    },
    CLI_TIMEOUT_MS,
  );

  it(
    `${ID}: lore create spec --issue 7 exits exactly 4`,
    async () => {
      const before = (await listDocs()).length;
      const run = await lore(["create", "spec", "--title", "spec with issue", "--content", "b", "--no-ai", "--issue", "7"]);
      expect(run.exitCode, run.stderr).toBe(4);
      expect((await listDocs()).length).toBe(before);
    },
    CLI_TIMEOUT_MS,
  );

  it(
    `${ID}: lore create task --issue 7 --issue 9 exits 0 and writes extra.issues == [{repo_id,7},{repo_id,9}]`,
    async () => {
      const run = await lore([
        "create", "task", "--title", "carrier task", "--adhoc", "--ac-scope", "", "--content", "b", "--no-ai",
        "--issue", "7", "--issue", "9", "--json",
      ]);
      expect(run.exitCode, run.stderr).toBe(0);
      const slug = (JSON.parse(run.stdout) as { data: { slug: string } }).data.slug;
      const got = await lore(["get", slug, "--json"]);
      expect(got.exitCode, got.stderr).toBe(0);
      const extra = (JSON.parse(got.stdout) as { data: { doc: { extra: Record<string, unknown> } } }).data.doc.extra;
      expect(extra["issues"]).toEqual([
        { repo_id: REPO_ID, number: 7 },
        { repo_id: REPO_ID, number: 9 },
      ]);
      expect(extra).not.toHaveProperty("issue_report");
    },
    CLI_TIMEOUT_MS,
  );

  it(
    `${ID}: lore create task --issue 99 (not listed) exits exactly 4 and writes nothing`,
    async () => {
      const before = (await listDocs()).length;
      const run = await lore(["create", "task", "--title", "ghost carrier", "--adhoc", "--ac-scope", "", "--content", "b", "--no-ai", "--issue", "99"]);
      expect(run.exitCode, run.stderr).toBe(4);
      expect((await listDocs()).length).toBe(before);
    },
    CLI_TIMEOUT_MS,
  );

  it(
    `${ID}: --issue 0, a repeated --issue 7, and 51 --issue values each exit exactly 4 and write nothing`,
    async () => {
      const before = (await listDocs()).length;
      const base = ["create", "task", "--title", "bad refs", "--adhoc", "--ac-scope", "", "--content", "b", "--no-ai"];
      const zero = await lore([...base, "--issue", "0"]);
      expect(zero.exitCode, zero.stderr).toBe(4);
      const duplicate = await lore([...base, "--issue", "7", "--issue", "7"]);
      expect(duplicate.exitCode, duplicate.stderr).toBe(4);

      setStubIssues(
        ghStub,
        Array.from({ length: 51 }, (_, index) => ({ number: index + 1, title: `issue ${index + 1}`, state: "open" as const })),
      );
      const tooMany = await lore([...base, ...Array.from({ length: 51 }, (_, index) => ["--issue", String(index + 1)]).flat()]);
      expect(tooMany.exitCode, tooMany.stderr).toBe(4);
      setStubIssues(ghStub, [
        { number: 7, title: "seven", state: "open" },
        { number: 9, title: "nine", state: "open" },
      ]);
      expect((await listDocs()).length).toBe(before);
    },
    CLI_TIMEOUT_MS,
  );

  it(
    `${ID}: a task created without --issue carries no extra.issues (regression)`,
    async () => {
      const run = await lore(["create", "task", "--title", "plain task", "--adhoc", "--ac-scope", "", "--content", "b", "--no-ai", "--json"]);
      expect(run.exitCode, run.stderr).toBe(0);
      const extra = (JSON.parse(run.stdout) as { data: { extra: Record<string, unknown> } }).data.extra;
      expect(extra).not.toHaveProperty("issues");
    },
    CLI_TIMEOUT_MS,
  );
});
