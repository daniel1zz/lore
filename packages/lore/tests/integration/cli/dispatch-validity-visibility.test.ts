/**
 * Integration tests: a RETRACTED (invalidated) doc must be DISTINGUISHABLE from a live
 * one on every read surface the parent fix deliberately scoped OUT — the DISPATCH
 * surface (`lore feed task-start`), `lore status`'s counts, `lore tree --json`,
 * `lore get --json`, `lore pending --json`, and `lore list --governed-by`
 * (task-validity-landed-on-lore-list-only-the-dispatch-surface, Required #1..#6).
 *
 * Runs the real CLI via subprocess against an isolated throwaway corpus (`lore init`
 * inside an mkdtemp dir, HOME redirected there) — the repo's own `.lore/` is never
 * touched. Same harness shape as `list-validity-visibility.test.ts`, whose surfaces
 * this file deliberately does NOT re-test except as REGRESSION.
 *
 * ## What made these tests necessary, and how they must NOT be written
 *
 * MEASURED pre-fix on `main @ 074df1cd`: `lore feed task-start <retracted task>` returned
 * a complete, confident, entirely normal-looking eight-section work order and exit 0;
 * `lore status`'s `total_docs`/`by_type` counted retracted docs as live work; and
 * `tree --json`/`get --json`/`pending --json`/`list --governed-by` carried no
 * validity-bearing key at all. Four ways an oracle can pass here while measuring
 * nothing — all four are deliberately avoided below:
 *
 *   1. ⛔ Asserting a retracted doc is signalled WITHOUT the live control. A blanket
 *      implementation that signalled/refused for EVERY doc passes that. Every
 *      assertion below is paired: the retracted specimen AND its never-invalidated
 *      sibling, in the same call where possible.
 *   2. ⛔ Asserting that `status` merely GREW a new field. The parent task's
 *      `--include-invalid` was inert precisely because nobody asserted a DIFFERENCE.
 *      The status assertions measure `total_docs` BEFORE and AFTER a real
 *      `lore invalidate`, and require the delta to equal exactly the retracted count.
 *   3. ⛔ Asserting identity on a RENDERED column or a RAW payload string. `lore list`'s
 *      human ID column truncates the ULID; ULIDs are TIME-ORDERED so docs created in
 *      one burst share long prefixes; and a full-ULID grep over a serialized payload
 *      hits the marker quoted inside docs that document it. Every assertion below
 *      compares the FULL id against the PARSED `id` field of a decoded JSON object.
 *   4. ⛔ Asserting a single token on the `feed task-start` refusal. Two INDEPENDENT
 *      lone tokens are pinned, plus a non-zero exit code.
 *
 * Dimension mapping:
 *   HAPPY:      `feed task-start <live task>` still serves a complete eight-section
 *               pack, exit 0, byte-identical across repeat runs; every `--json`
 *               surface carries `validity_status` on a live doc as `invalidated: false`
 *   NEGATIVE:   `feed task-start <retracted task>` refuses with a non-zero exit and two
 *               independent lone tokens, and emits NO pack; a live doc is never
 *               marked, never excluded, never refused
 *   BOUNDARY:   `status`'s `total_docs` moves by EXACTLY the retracted count across a
 *               real invalidate, and back on `--undo`; `list --governed-by
 *               --include-invalid` restores exactly one doc
 *   ERROR:      `feed task-start` on an unresolvable target still fails with the
 *               ordinary not-found error, never the retraction refusal
 *   STATE:      a supersede chain's `superseded_by` travels on the `get --json` /
 *               `tree --json` payloads, pointing at the live successor
 *   REGRESSION: `lore list` / `lore search` default+`--include-invalid` behaviour is
 *               unchanged; `lore get`'s DEFAULT HUMAN render is unchanged (SPEC-043's
 *               deliberate list-hides / direct-address-shows asymmetry) and gains no
 *               machine field
 *
 * @spec_ref SPEC-043 §Design Decisions D3/D4;
 *   task-validity-landed-on-lore-list-only-the-dispatch-surface Required #1..#6
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
 * `maxBuffer` is explicit: a `--json` tree/listing grows with the corpus and the
 * default would truncate mid-payload into an unparseable string.
 */
function runLore(args: string[]): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: tmpDir,
    env: {
      ...process.env,
      HOME: tmpDir,
      EDITOR: "true",
      CLAUDECODE: "1",
      LORE_ACTOR: "agent:dispatch-validity-test",
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

let tmpDir = "";
let prdSlug = "";
let planSlug = "";
let skillSlug = "";
/** Live/dead pairs, per type. `id` fields are FULL ULIDs — never truncated. */
const live = { task: "", knowledge: "", adr: "" };
const dead = { task: "", knowledge: "", adr: "" };
const liveId = { task: "", knowledge: "", adr: "" };
const deadId = { task: "", knowledge: "", adr: "" };
/** A dedicated live doc the `status`-delta test retracts and then un-retracts. */
let statusProbeSlug = "";
/** A live and a retracted doc reachable ONLY through the skill's `governs` links. */
let governedLiveSlug = "";
let governedDeadSlug = "";
let governedLiveId = "";
let governedDeadId = "";

function createDoc(args: string[]): string {
  const r = runLore(["create", ...args, "--no-ai", "--content", "body"]);
  if (r.exitCode !== 0) throw new Error(`create ${args.join(" ")} failed: ${r.stderr}${r.stdout}`);
  const slug = /Slug:\s+(\S+)/.exec(r.stdout)?.[1];
  if (slug === undefined) throw new Error(`no slug in create output: ${r.stdout}`);
  return slug;
}

/** The FULL ULID of `slug`, read from the PARSED `--json` payload's `id` field. */
function idOf(slug: string): string {
  const r = runLore(["get", slug, "--json"]);
  if (r.exitCode !== 0) throw new Error(`get ${slug} failed: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as { data: { doc: { id: string } } };
  return parsed.data.doc.id;
}

function invalidate(slug: string, supersededBy?: string): void {
  const r = runLore([
    "invalidate",
    slug,
    ...(supersededBy !== undefined ? ["--superseded-by", supersededBy] : []),
    "--reason",
    "retracted by the dispatch-validity oracle",
  ]);
  if (r.exitCode !== 0) throw new Error(`invalidate ${slug} failed: ${r.stderr}${r.stdout}`);
}

function undoInvalidate(slug: string): void {
  const r = runLore(["invalidate", slug, "--undo"]);
  if (r.exitCode !== 0) throw new Error(`invalidate --undo ${slug} failed: ${r.stderr}${r.stdout}`);
}

beforeAll(() => {
  tmpDir = join(tmpdir(), `lore-dispatch-validity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);

  prdSlug = createDoc(["prd", "--title", "Dispatch Validity Root"]);
  planSlug = createDoc(["plan", "--title", "Dispatch Validity Plan", "--parent", prdSlug]);
  // reason: `extra.phase` validates against the MEMBER plan's declared phases, so the
  // plan must declare P1 before any task may reference it.
  const phase = runLore(["phase", "add", planSlug, "P1"]);
  if (phase.exitCode !== 0) throw new Error(`phase add failed: ${phase.stderr}`);

  const perType: Array<[keyof typeof live, string[]]> = [
    ["task", ["task", "--parent", planSlug, "--plan-id", planSlug, "--phase", "P1"]],
    ["knowledge", ["knowledge", "--sub-type", "reference", "--parent", prdSlug]],
    ["adr", ["adr", "--decision-status", "accepted", "--parent", prdSlug]],
  ];
  for (const [type, extraArgs] of perType) {
    live[type] = createDoc(["--title", `Dispatch ${type} live`, ...extraArgs]);
    dead[type] = createDoc(["--title", `Dispatch ${type} dead`, ...extraArgs]);
    invalidate(dead[type], live[type]);
    liveId[type] = idOf(live[type]);
    deadId[type] = idOf(dead[type]);
  }

  // A never-retracted probe the `status` delta test mutates and restores itself.
  statusProbeSlug = createDoc([
    "knowledge",
    "--sub-type",
    "reference",
    "--title",
    "Dispatch status probe",
    "--parent",
    prdSlug,
  ]);

  // `--governed-by` fixture: one governing doc with `governs` edges to a live and a
  // retracted artifact, both reachable ONLY through those links.
  skillSlug = createDoc([
    "knowledge",
    "--sub-type",
    "reference",
    "--title",
    "Dispatch governing skill",
    "--parent",
    prdSlug,
  ]);
  governedLiveSlug = createDoc([
    "knowledge",
    "--sub-type",
    "reference",
    "--title",
    "Dispatch governed live",
    "--parent",
    prdSlug,
  ]);
  governedDeadSlug = createDoc([
    "knowledge",
    "--sub-type",
    "reference",
    "--title",
    "Dispatch governed dead",
    "--parent",
    prdSlug,
  ]);
  for (const target of [governedLiveSlug, governedDeadSlug]) {
    const linked = runLore(["link", skillSlug, target, "--type", "governs"]);
    if (linked.exitCode !== 0) throw new Error(`link governs ${target} failed: ${linked.stderr}`);
  }
  invalidate(governedDeadSlug);
  governedLiveId = idOf(governedLiveSlug);
  governedDeadId = idOf(governedDeadSlug);
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
  metadata_unreadable?: true;
}
interface JsonDocLike {
  id: string;
  slug?: string;
  validity_status?: ValidityStatusPayload;
}
interface TreeNodeLike {
  doc: JsonDocLike;
  children: TreeNodeLike[];
}

function parseJson<T>(r: RunResult): T {
  expect(r.exitCode).toBe(0);
  return (JSON.parse(r.stdout) as { data: T }).data;
}

/** Every node of a `lore tree --json` payload, flattened depth-first. */
function flattenTree(node: TreeNodeLike): TreeNodeLike[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

/**
 * The record whose PARSED `id` field equals the FULL ULID `id`.
 * ⛔ Never a prefix comparison and never a payload substring search — see this file's
 * header, rule 3.
 */
function recordById<T extends JsonDocLike>(records: readonly T[], id: string): T | undefined {
  return records.find((r) => r.id === id);
}

function requireRecordById<T extends JsonDocLike>(records: readonly T[], id: string): T {
  const found = recordById(records, id);
  if (found === undefined) {
    throw new Error(`no record with id ${id} among [${records.map((r) => r.id).join(", ")}]`);
  }
  return found;
}

/**
 * How many docs `beforeAll` leaves RETRACTED: the task/knowledge/adr dead siblings plus
 * the retracted `governs` target. The `statusProbeSlug` doc is deliberately NOT counted —
 * the only test that retracts it restores it in a `finally`.
 */
const RETRACTED_FIXTURE_COUNT = 4;

/**
 * Explicit per-case timeout for the cases below that spawn the CLI three or more times
 * (`scripts/check-test-budgets.ts`, spec-a-test-case-s-timeout-budget-must-be-declared-
 * when-its D1 — that oracle judges the DECLARATION, never the number). Sized for four to
 * five cold `bun run src/index.ts` starts with headroom for a loaded machine.
 */
const MULTI_SPAWN_TIMEOUT_MS = 60_000;

const PACK_SECTION_HEADINGS = [
  "## Objective",
  "## Acceptance",
  "## Constraints",
  "## Boundaries",
  "## Claim",
  "## Plan state",
  "## Linked knowledge",
  "## Latest handoff",
] as const;

// ═════ Required #2 — the DISPATCH surface ════════════════════════════════════

describe("lore feed task-start — NEGATIVE: a RETRACTED task is refused, no pack served", () => {
  it("exits non-zero and names TWO independent lone tokens on stderr", () => {
    const r = runLore(["feed", "task-start", dead.task]);

    expect(r.exitCode).not.toBe(0);
    // Two INDEPENDENT conditions — a reword dropping either one fails here.
    expect(r.stderr).toContain("RETRACTED");
    expect(r.stderr).toContain("invalid_at");
  });

  it("emits NO pack — not one section heading reaches stdout", () => {
    const r = runLore(["feed", "task-start", dead.task]);

    for (const heading of PACK_SECTION_HEADINGS) {
      expect(r.stdout).not.toContain(heading);
    }
  });

  it("refuses the --json machine payload too, with the same non-zero exit", () => {
    const r = runLore(["feed", "task-start", dead.task, "--json"]);

    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).not.toContain("task_id");
    expect(r.stderr).toContain("RETRACTED");
  });

  it("points the reader at the direct-address surface that DOES show a retracted doc", () => {
    const r = runLore(["feed", "task-start", dead.task]);

    expect(r.stderr).toContain("lore get");
  });
});

describe("lore feed task-start — HAPPY control: a LIVE task is served unchanged", () => {
  it("exits 0 with all eight section headings and no retraction token", () => {
    const r = runLore(["feed", "task-start", live.task]);

    expect(r.exitCode).toBe(0);
    for (const heading of PACK_SECTION_HEADINGS) {
      expect(r.stdout).toContain(heading);
    }
    expect(r.stdout).not.toContain("RETRACTED");
    expect(r.stdout).not.toContain("invalid_at");
  });

  it(
    "is byte-identical across two consecutive runs (human AND --json)",
    () => {
      const humanA = runLore(["feed", "task-start", live.task]);
      const humanB = runLore(["feed", "task-start", live.task]);
      expect(humanA.exitCode).toBe(0);
      expect(humanA.stdout).toBe(humanB.stdout);

      const jsonA = runLore(["feed", "task-start", live.task, "--json"]);
      const jsonB = runLore(["feed", "task-start", live.task, "--json"]);
      expect(jsonA.exitCode).toBe(0);
      expect(jsonA.stdout).toBe(jsonB.stdout);
    },
    MULTI_SPAWN_TIMEOUT_MS,
  );
});

describe("lore feed task-start — ERROR: an unresolvable target is NOT a retraction", () => {
  it("fails with the ordinary not-found error, never the retraction refusal", () => {
    const r = runLore(["feed", "task-start", "task-no-such-task-anywhere"]);

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).not.toContain("RETRACTED");
  });
});

// ═════ Required #3 — `lore status` counts ════════════════════════════════════

interface StatusPayload {
  total_docs: number;
  invalid_docs: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
}

function statusJson(): StatusPayload {
  return parseJson<StatusPayload>(runLore(["status", "--json"]));
}

describe("lore status — BOUNDARY: counts EXCLUDE retracted docs and report them separately", () => {
  // reason: five CLI spawns behind the `statusJson`/`invalidate` helpers — the budget
  // oracle counts DIRECT spawn-helper calls only, so it does not flag this case; the
  // declaration is made anyway because the underlying fact (this case spawns five times)
  // is what the rule is about.
  it("total_docs moves by EXACTLY the retracted count across a real invalidate, and back on --undo", () => {
    const before = statusJson();

    // reason: try/finally, not a bare sequence — a failing assertion in the middle must
    // still restore the probe doc, or every LATER test in this file inherits a corpus
    // with one extra retracted doc (measured: it turned an exact-count assertion three
    // describe blocks down into a phantom off-by-one).
    let after: StatusPayload;
    try {
      invalidate(statusProbeSlug);
      after = statusJson();
    } finally {
      undoInvalidate(statusProbeSlug);
    }

    // The NUMBER changed — not merely "a new field appeared".
    expect(after.total_docs).toBe(before.total_docs - 1);
    expect(after.invalid_docs).toBe(before.invalid_docs + 1);
    expect(after.by_type["knowledge"]).toBe((before.by_type["knowledge"] ?? 0) - 1);

    const restored = statusJson();
    expect(restored.total_docs).toBe(before.total_docs);
    expect(restored.invalid_docs).toBe(before.invalid_docs);
    expect(restored.by_type["knowledge"]).toBe(before.by_type["knowledge"]);
  }, MULTI_SPAWN_TIMEOUT_MS);

  it("invalid_docs equals the number of docs actually retracted in this corpus", () => {
    const status = statusJson();

    expect(status.invalid_docs).toBe(RETRACTED_FIXTURE_COUNT);
  });

  it("reports the retracted count in the HUMAN render too — never an omitted number", () => {
    const r = runLore(["status"]);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Retracted");
  });

  it("by_status counts drop the retracted docs too (a retracted draft is not open work)", () => {
    const status = statusJson();
    const sumByType = Object.values(status.by_type).reduce((a, b) => a + b, 0);
    const sumByStatus = Object.values(status.by_status).reduce((a, b) => a + b, 0);

    expect(sumByType).toBe(status.total_docs);
    expect(sumByStatus).toBe(status.total_docs);
  });
});

// ═════ Required #4 — `tree --json` and `get --json` ══════════════════════════

describe("lore tree --json — every node carries validity, in BOTH directions", () => {
  it("marks the retracted node invalidated and the live sibling not, keyed on the FULL id", () => {
    const root = parseJson<TreeNodeLike>(runLore(["tree", prdSlug, "--json", "--depth", "5"]));
    const nodes = flattenTree(root);
    const docs = nodes.map((n) => n.doc);

    const deadNode = requireRecordById(docs, deadId.knowledge);
    const liveNode = requireRecordById(docs, liveId.knowledge);

    expect(deadNode.validity_status?.invalidated).toBe(true);
    expect(liveNode.validity_status?.invalidated).toBe(false);
  });

  it("stamps validity on EVERY node, so an absent key can never read as 'live'", () => {
    const root = parseJson<TreeNodeLike>(runLore(["tree", prdSlug, "--json", "--depth", "5"]));

    for (const node of flattenTree(root)) {
      expect(node.doc.validity_status).toBeDefined();
      expect(typeof node.doc.validity_status?.invalidated).toBe("boolean");
    }
  });

  it("the phase-grouped plan payload carries validity on each phase task", () => {
    interface PhasePayload {
      phases: Array<{ name: string; tasks: JsonDocLike[] }>;
    }
    const data = parseJson<PhasePayload>(runLore(["tree", planSlug, "--json"]));
    const tasks = data.phases.flatMap((p) => p.tasks);

    expect(requireRecordById(tasks, deadId.task).validity_status?.invalidated).toBe(true);
    expect(requireRecordById(tasks, liveId.task).validity_status?.invalidated).toBe(false);
  });
});

describe("lore get --json — the machine payload carries validity, the human render does not change", () => {
  it("reports invalidated: true for the retracted doc and false for the live one", () => {
    interface GetPayload {
      doc: { id: string };
      validity_status: ValidityStatusPayload;
    }
    const deadPayload = parseJson<GetPayload>(runLore(["get", dead.knowledge, "--json"]));
    const livePayload = parseJson<GetPayload>(runLore(["get", live.knowledge, "--json"]));

    expect(deadPayload.doc.id).toBe(deadId.knowledge);
    expect(deadPayload.validity_status.invalidated).toBe(true);
    expect(livePayload.doc.id).toBe(liveId.knowledge);
    expect(livePayload.validity_status.invalidated).toBe(false);
  });

  it("STATE: the supersede chain's successor travels on the payload", () => {
    interface GetPayload {
      validity_status: ValidityStatusPayload;
    }
    const payload = parseJson<GetPayload>(runLore(["get", dead.knowledge, "--json"]));

    expect(payload.validity_status.superseded_by).toBe(liveId.knowledge);
    expect(payload.validity_status.reason).toContain("dispatch-validity oracle");
  });

  it("REGRESSION: the DEFAULT human render still resolves, still banners, and gains no machine field", () => {
    const r = runLore(["get", dead.knowledge]);

    expect(r.exitCode).toBe(0);
    // SPEC-043's deliberate asymmetry: direct address SHOWS a retracted doc.
    expect(r.stdout.toUpperCase()).toContain("RETRACTED");
    // ⛔ The machine key must not leak into the human projection.
    expect(r.stdout).not.toContain("validity_status");
  });
});

// ═════ Required #5 — `lore pending` ══════════════════════════════════════════

describe("lore pending --json — the queue payload carries validity, in BOTH directions", () => {
  it("omits the retracted draft by default and stamps invalidated: false on the live one", () => {
    interface PendingPayload {
      docs: JsonDocLike[];
      total: number;
    }
    const data = parseJson<PendingPayload>(runLore(["pending", "--json", "--all"]));

    expect(recordById(data.docs, deadId.knowledge)).toBeUndefined();
    expect(requireRecordById(data.docs, liveId.knowledge).validity_status?.invalidated).toBe(false);
  });

  it("restores exactly the retracted drafts under --include-invalid, each stamped invalidated: true", () => {
    interface PendingPayload {
      docs: JsonDocLike[];
      total: number;
    }
    const closed = parseJson<PendingPayload>(runLore(["pending", "--json", "--all"]));
    const opened = parseJson<PendingPayload>(runLore(["pending", "--json", "--all", "--include-invalid"]));

    // The count DIFFERENCE is the measurement — never "the flag exited 0".
    expect(opened.docs.length - closed.docs.length).toBe(RETRACTED_FIXTURE_COUNT);
    expect(requireRecordById(opened.docs, deadId.knowledge).validity_status?.invalidated).toBe(true);
    expect(requireRecordById(opened.docs, liveId.knowledge).validity_status?.invalidated).toBe(false);
  });
});

// ═════ Required #6 — `lore list --governed-by` ═══════════════════════════════

describe("lore list --governed-by — the last ungated branch is gated, in BOTH directions", () => {
  interface ListPayload {
    docs: JsonDocLike[];
    total: number;
  }

  it("excludes the retracted governed artifact by default, keeping the live one", () => {
    const data = parseJson<ListPayload>(runLore(["list", "--governed-by", skillSlug, "--json"]));

    expect(recordById(data.docs, governedDeadId)).toBeUndefined();
    expect(requireRecordById(data.docs, governedLiveId).validity_status?.invalidated).toBe(false);
  });

  it("BOUNDARY: --include-invalid restores EXACTLY one doc, stamped invalidated: true", () => {
    const closed = parseJson<ListPayload>(runLore(["list", "--governed-by", skillSlug, "--json"]));
    const opened = parseJson<ListPayload>(
      runLore(["list", "--governed-by", skillSlug, "--include-invalid", "--json"]),
    );

    expect(opened.docs.length - closed.docs.length).toBe(1);
    expect(requireRecordById(opened.docs, governedDeadId).validity_status?.invalidated).toBe(true);
    expect(requireRecordById(opened.docs, governedLiveId).validity_status?.invalidated).toBe(false);
  });

  it("carries validity on EVERY governed record — never an absent key", () => {
    const data = parseJson<ListPayload>(
      runLore(["list", "--governed-by", skillSlug, "--include-invalid", "--json"]),
    );

    expect(data.docs.length).toBeGreaterThan(0);
    for (const doc of data.docs) {
      expect(doc.validity_status).toBeDefined();
    }
  });
});

// ═════ REGRESSION — the parent fix's surfaces are untouched ══════════════════

describe("REGRESSION — lore list and lore search keep the behaviour the parent fix shipped", () => {
  interface ListPayload {
    docs: JsonDocLike[];
    total: number;
  }

  it("`list --type knowledge` still hides retracted docs by default and restores them on opt-in", () => {
    const closed = parseJson<ListPayload>(runLore(["list", "--type", "knowledge", "--json"]));
    const opened = parseJson<ListPayload>(
      runLore(["list", "--type", "knowledge", "--include-invalid", "--json"]),
    );

    expect(recordById(closed.docs, deadId.knowledge)).toBeUndefined();
    expect(requireRecordById(opened.docs, deadId.knowledge).validity_status?.invalidated).toBe(true);
    // Two retracted knowledge docs in this corpus: the type pair's, and the governed one.
    expect(opened.docs.length - closed.docs.length).toBe(2);
  });

  it("`search` still excludes a retracted hit by default", () => {
    interface SearchPayload {
      results: Array<{ id: string }>;
    }
    const data = parseJson<SearchPayload>(runLore(["search", "Dispatch", "--json"]));
    const ids = data.results.map((h) => h.id);

    expect(ids).not.toContain(deadId.knowledge);
    expect(ids).toContain(liveId.knowledge);
  });
});
