// @spawns packages/lore/src/index.ts
/**
 * Integration tests: an invalidated (RETRACTED) doc must be DISTINGUISHABLE from a
 * live one on every `lore list` surface, and `--include-invalid` must have a MEASURABLE
 * effect (task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in, SPEC-043 D3).
 *
 * Runs the real CLI via subprocess against an isolated throwaway corpus (`lore init`
 * inside an mkdtemp dir, HOME redirected there) — the repo's own `.lore/` is never
 * touched. Same harness shape as `list-paging.test.ts`.
 *
 * ## What made these tests necessary, and how they must NOT be written
 *
 * MEASURED pre-fix: `lore list --type task` showed a retracted task, and
 * `--include-invalid` produced a BYTE-IDENTICAL 1516-char payload — same row count,
 * same slug set, no badge, no validity-bearing key. Two ways an oracle can pass while
 * measuring nothing here, both of which this file deliberately avoids:
 *
 *   1. ⛔ Asserting only that `--include-invalid` exits 0. A silently inert flag passes
 *      that check — it IS the defect. Every opt-in assertion below pins the row/doc
 *      count DIFFERENCE between the two runs.
 *   2. ⛔ Asserting presence/absence by TITLE. The human title column truncates at ~34
 *      chars, which produced two false "absent" readings while this defect was being
 *      measured. Every human-surface assertion below keys on the 10-char ID in
 *      COLUMN 1 (`humanRowIds`), never on rendered title text.
 *
 * Dimension mapping:
 *   HAPPY:      default `--type task` (human AND --json) omits the retracted task;
 *               every `--json` record carries an explicit `validity_status`
 *   NEGATIVE:   a never-invalidated sibling is never marked and never dropped;
 *               the live row's rendered line carries no `[invalid]` token
 *   BOUNDARY:   `--include-invalid` restores exactly the invalidated docs — the
 *               count difference equals the number of retracted docs, per type
 *   ERROR:      `--include-invalid` combined with `--governed-by` still fails loud
 *               (exit 2) rather than silently ignoring one of them
 *   STATE:      a supersede chain reports `superseded_by` pointing at the live
 *               successor; `--plan-id` and `--phase` branches are gated too
 *   REGRESSION: `lore get <retracted>` still resolves AND still renders the
 *               human banner (SPEC-043's deliberate asymmetry — list hides,
 *               direct address shows); paging flags keep working
 *
 * @spec_ref SPEC-043 §Design Decisions D3/D4;
 *   task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in AC-1..AC-6
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in the throwaway corpus with an isolated HOME.
 * MOCK RISK: none — this calls the real CLI entry point.
 * `maxBuffer` is explicit: a `--json` listing grows with the corpus, and the default
 * would truncate mid-payload into an unparseable string.
 */
function runLore(args: string[]): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: tmpDir,
    env: { ...process.env, HOME: tmpDir, EDITOR: "true", CLAUDECODE: "1", LORE_ACTOR: "agent:list-validity-test" },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

let tmpDir: string;

interface DocPair {
  readonly liveSlug: string;
  readonly liveId: string;
  readonly deadSlug: string;
  readonly deadId: string;
}

const pairs: Record<"task" | "knowledge" | "adr", DocPair> = {
  task: { liveSlug: "", liveId: "", deadSlug: "", deadId: "" },
  knowledge: { liveSlug: "", liveId: "", deadSlug: "", deadId: "" },
  adr: { liveSlug: "", liveId: "", deadSlug: "", deadId: "" },
};
let planSlug = "";

function createDoc(args: string[]): string {
  const r = runLore(["create", ...args, "--no-ai", "--content", "body"]);
  if (r.exitCode !== 0) throw new Error(`create ${args.join(" ")} failed: ${r.stderr}${r.stdout}`);
  const slug = /Slug:\s+(\S+)/.exec(r.stdout)?.[1];
  if (slug === undefined) throw new Error(`no slug in create output: ${r.stdout}`);
  return slug;
}

function idOf(slug: string): string {
  const r = runLore(["get", slug, "--json"]);
  if (r.exitCode !== 0) throw new Error(`get ${slug} failed: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as { data: { doc: { id: string } } };
  return parsed.data.doc.id;
}

beforeAll(() => {
  tmpDir = join(tmpdir(), `lore-list-validity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);

  const prdSlug = createDoc(["prd", "--title", "Validity Root"]);
  planSlug = createDoc(["plan", "--title", "Validity Plan", "--parent", prdSlug]);
  // reason: `extra.phase` validates against the MEMBER plan's declared phases, so
  // the plan must declare P1 before any task may reference it.
  const phase = runLore(["phase", "add", planSlug, "P1"]);
  if (phase.exitCode !== 0) throw new Error(`phase add failed: ${phase.stderr}`);

  const spec: Array<[keyof typeof pairs, string[]]> = [
    ["task", ["task", "--parent", planSlug, "--plan-id", planSlug, "--phase", "P1"]],
    ["knowledge", ["knowledge", "--sub-type", "reference", "--parent", prdSlug]],
    ["adr", ["adr", "--decision-status", "accepted", "--parent", prdSlug]],
  ];
  for (const [type, extraArgs] of spec) {
    const liveSlug = createDoc(["--title", `Validity ${type} live`, ...extraArgs]);
    const deadSlug = createDoc(["--title", `Validity ${type} dead`, ...extraArgs]);
    const inv = runLore([
      "invalidate", deadSlug,
      "--superseded-by", liveSlug,
      "--reason", "retracted by the validity-visibility oracle",
    ]);
    if (inv.exitCode !== 0) throw new Error(`invalidate ${deadSlug} failed: ${inv.stderr}`);
    pairs[type] = { liveSlug, liveId: idOf(liveSlug), deadSlug, deadId: idOf(deadSlug) };
  }
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // reason: a leftover mkdtemp dir under /tmp is inert; failing teardown here would
    // mask the real assertion failure that preceded it.
  }
});

// ─── Parsers ──────────────────────────────────────────────────────────────────

interface ValidityStatusPayload {
  invalidated: boolean;
  invalid_at?: string;
  superseded_by?: string;
  reason?: string;
}
interface ListedRecord {
  id: string;
  slug: string;
  validity_status?: ValidityStatusPayload;
}

function listJson(args: string[]): { docs: ListedRecord[]; total: number } {
  const r = runLore(["list", ...args, "--json"]);
  expect(r.exitCode).toBe(0);
  return (JSON.parse(r.stdout) as { data: { docs: ListedRecord[]; total: number } }).data;
}

/**
 * The 10-char IDs in COLUMN 1 of a human `lore list` table.
 * ⛔ Presence/absence is asserted through THIS, never through title text — the title
 * column truncates at ~34 chars and gave two false readings when this defect was
 * first measured.
 */
function humanRowIds(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => /^([0-9A-HJKMNP-TV-Z]{10})\s/.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);
}

/** The full rendered line whose column 1 is `id`'s 10-char prefix. */
function humanRowFor(stdout: string, id: string): string {
  const prefix = id.slice(0, 10);
  const line = stdout.split("\n").find((l) => l.startsWith(`${prefix} `));
  if (line === undefined) throw new Error(`no row for ${prefix} in:\n${stdout}`);
  return line;
}

const TYPES = ["task", "knowledge", "adr"] as const;

// ─── HAPPY — default hides, and every --json record carries validity ──────────

describe("lore list — HAPPY: the default view omits retracted docs and carries validity as data", () => {
  it.each(TYPES)("`--type %s` (human) omits the retracted doc, keyed on column 1's ID", (type) => {
    const { deadId, liveId } = pairs[type];
    const human = runLore(["list", "--type", type]);

    expect(human.exitCode).toBe(0);
    expect(humanRowIds(human.stdout)).not.toContain(deadId.slice(0, 10));
    expect(humanRowIds(human.stdout)).toContain(liveId.slice(0, 10));
  });

  it.each(TYPES)("`--type %s --json` omits the retracted doc's record", (type) => {
    const { deadId, liveId } = pairs[type];
    const data = listJson(["--type", type]);

    expect(data.docs.map((d) => d.id)).not.toContain(deadId);
    expect(data.docs.map((d) => d.id)).toContain(liveId);
  });

  it.each(TYPES)("every `--type %s --json` record carries an explicit validity_status", (type) => {
    const data = listJson(["--type", type]);

    expect(data.docs.length).toBeGreaterThan(0);
    for (const doc of data.docs) {
      expect(doc.validity_status).toBeDefined();
      expect(doc.validity_status).toEqual({ invalidated: false });
    }
  });

  it("the retracted record, when included, carries invalidated:true plus its superseded_by and reason", () => {
    const { deadId, liveId } = pairs.task;
    const dead = listJson(["--type", "task", "--include-invalid"]).docs.find((d) => d.id === deadId);

    expect(dead?.validity_status?.invalidated).toBe(true);
    expect(dead?.validity_status?.superseded_by).toBe(liveId);
    expect(dead?.validity_status?.reason).toBe("retracted by the validity-visibility oracle");
    expect(typeof dead?.validity_status?.invalid_at).toBe("string");
  });
});

// ─── NEGATIVE — the live sibling is never marked, never dropped ───────────────

describe("lore list — NEGATIVE: a never-invalidated doc is never marked", () => {
  it.each(TYPES)("the live %s record reports invalidated:false with no retraction detail", (type) => {
    const { liveId } = pairs[type];
    const live = listJson(["--type", type, "--include-invalid"]).docs.find((d) => d.id === liveId);

    expect(live?.validity_status?.invalidated).toBe(false);
    expect(live?.validity_status?.superseded_by).toBeUndefined();
    expect(live?.validity_status?.invalid_at).toBeUndefined();
    expect(live?.validity_status?.reason).toBeUndefined();
  });

  it("the live task's human row carries no [invalid] token while the retracted one does", () => {
    const human = runLore(["list", "--type", "task", "--include-invalid"]);

    expect(humanRowFor(human.stdout, pairs.task.liveId)).not.toContain("[invalid]");
    expect(humanRowFor(human.stdout, pairs.task.deadId)).toContain("[invalid]");
  });
});

// ─── BOUNDARY — the opt-in flag's effect is a MEASURED count difference ───────

describe("lore list --include-invalid — BOUNDARY: the flag's effect is measurable, never inert", () => {
  it.each(TYPES)("`--type %s`: --include-invalid adds exactly the 1 retracted doc (--json)", (type) => {
    const defaultDocs = listJson(["--type", type]).docs;
    const openedDocs = listJson(["--type", type, "--include-invalid"]).docs;

    // ⛔ the DIFFERENCE is the assertion — an inert flag passes any exit-code check.
    expect(openedDocs.length - defaultDocs.length).toBe(1);
    const defaultSlugs = new Set(defaultDocs.map((d) => d.slug));
    const restored = openedDocs.filter((d) => !defaultSlugs.has(d.slug)).map((d) => d.id);
    expect(restored).toEqual([pairs[type].deadId]);
  });

  it.each(TYPES)("`--type %s` (human): --include-invalid adds exactly one data row", (type) => {
    const defaultRows = humanRowIds(runLore(["list", "--type", type]).stdout);
    const openedRows = humanRowIds(runLore(["list", "--type", type, "--include-invalid"]).stdout);

    expect(openedRows.length - defaultRows.length).toBe(1);
    expect(openedRows).toContain(pairs[type].deadId.slice(0, 10));
    expect(defaultRows).not.toContain(pairs[type].deadId.slice(0, 10));
  });

  it("the human row is marked by TWO independent lone tokens — a badge and a Validity cell", () => {
    // ⛔ two independent lone tokens, never one remembered sentence: a contiguous
    // substring matcher degrades silently to no-match on any format tweak.
    const human = runLore(["list", "--type", "task", "--include-invalid"]);
    const deadRow = humanRowFor(human.stdout, pairs.task.deadId);

    expect(deadRow).toContain("[invalid]");
    expect(deadRow).toContain(pairs.task.liveId.slice(0, 10));
    expect(human.stdout).toContain("Validity");
    expect(humanRowFor(human.stdout, pairs.task.liveId)).toContain("valid");
  });
});

// ─── ERROR — conflicting flags still fail loud ───────────────────────────────

describe("lore list --include-invalid — ERROR", () => {
  it("combined with --governed-by and another filter, still exits 2 naming the conflict", () => {
    const r = runLore(["list", "--governed-by", pairs.knowledge.liveSlug, "--type", "task", "--include-invalid"]);

    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("--governed-by");
  });

  it("an unknown neighbouring flag is still rejected exit 2, not silently dropped", () => {
    const r = runLore(["list", "--type", "task", "--include-invalid", "--include-invalidd"]);

    expect(r.exitCode).toBe(2);
  });
});

// ─── STATE — the other gated branches (--plan-id, --phase) ───────────────────

describe("lore list — STATE: every full-record branch is gated, not just --type task", () => {
  it("--plan-id omits the retracted member by default and restores it under --include-invalid", () => {
    const { deadId } = pairs.task;
    const defaultDocs = listJson(["--plan-id", planSlug]).docs;
    const openedDocs = listJson(["--plan-id", planSlug, "--include-invalid"]).docs;

    expect(defaultDocs.map((d) => d.id)).not.toContain(deadId);
    expect(openedDocs.map((d) => d.id)).toContain(deadId);
    expect(openedDocs.length - defaultDocs.length).toBe(1);
    for (const doc of defaultDocs) expect(doc.validity_status?.invalidated).toBe(false);
  });

  it("--phase omits the retracted member by default and restores it under --include-invalid", () => {
    const { deadId } = pairs.task;
    const defaultDocs = listJson(["--type", "task", "--phase", "P1"]).docs;
    const openedDocs = listJson(["--type", "task", "--phase", "P1", "--include-invalid"]).docs;

    expect(defaultDocs.map((d) => d.id)).not.toContain(deadId);
    expect(openedDocs.map((d) => d.id)).toContain(deadId);
    expect(openedDocs.length - defaultDocs.length).toBe(1);
  });

  it("the plain listing (no --type) hides retracted docs of every type and stamps the survivors", () => {
    const data = listJson([]);
    const ids = data.docs.map((d) => d.id);

    for (const type of TYPES) {
      expect(ids).not.toContain(pairs[type].deadId);
      expect(ids).toContain(pairs[type].liveId);
    }
    for (const doc of data.docs) expect(doc.validity_status?.invalidated).toBe(false);
  });
});

// ─── REGRESSION — direct address still shows; paging unaffected ───────────────

describe("lore list / lore get — REGRESSION", () => {
  it("`lore get <retracted>` still resolves and still renders the human banner", () => {
    // SPEC-043's deliberate asymmetry: list HIDES, direct address SHOWS.
    const r = runLore(["get", pairs.knowledge.deadSlug]);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("INVALIDATED");
    expect(r.stdout).toContain("superseded");
    expect(r.stdout).toContain(pairs.knowledge.liveSlug);
  });

  it("`lore get <retracted> --json` still returns the doc body (retraction is not deletion)", () => {
    const r = runLore(["get", pairs.task.deadSlug, "--json"]);

    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: { doc: { id: string; content: string } } };
    expect(parsed.data.doc.id).toBe(pairs.task.deadId);
    expect(parsed.data.doc.content).toContain("body");
  });

  it("--limit/--offset still page the gated result deterministically", () => {
    const all = listJson(["--type", "task"]).docs;
    const page = listJson(["--type", "task", "--limit", "1", "--offset", "0"]).docs;

    expect(page).toHaveLength(1);
    expect(page[0]?.id).toBe(all[0]?.id);
    expect(page[0]?.validity_status?.invalidated).toBe(false);
  });

  it("--limit paging under --include-invalid never returns a short page", () => {
    // reason: the exclusion is a client-side narrowing, so it MUST run before the
    // page boundary — a store-level page taken first would come up short here.
    const opened = listJson(["--type", "task", "--include-invalid"]).docs;
    const pageSize = opened.length;
    const paged = listJson(["--type", "task", "--include-invalid", "--limit", String(pageSize)]).docs;

    expect(paged).toHaveLength(pageSize);
  });

  it("two consecutive --json reads over an untouched corpus are BYTE-IDENTICAL", () => {
    // reason: an earlier revision echoed the evaluation instant onto every record,
    // which broke this read-idempotence contract (already pinned for --plan-id in
    // list-plan-membership.test.ts). Pinned HERE too, on the surface that grew the
    // field, so re-adding a wall-clock stamp fails loudly instead of silently.
    const first = runLore(["list", "--type", "task", "--include-invalid", "--json"]);
    const second = runLore(["list", "--type", "task", "--include-invalid", "--json"]);

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toBe(second.stdout);
  });

  it("the default listing's row count equals the corpus count minus the retracted docs", () => {
    const openedTotal = listJson(["--include-invalid"]).docs.length;
    const defaultTotal = listJson([]).docs.length;

    expect(openedTotal - defaultTotal).toBe(TYPES.length);
  });
});
