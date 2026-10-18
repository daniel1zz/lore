// @layer service-unmeasured-floor AC-CT-9
// @reads packages/lore/src/adapters/cli/commands/assess.ts
// @reads packages/lore/src/adapters/cli/commands/status.ts
// @spawns git
/**
 * AC-CT-9 (a)(b)(d) (SPEC-143, corrected 2026-10-17 / R13) — the attestation floor reads the STAMP
 * axis first and the RADIUS axis only for stamped rows; one exported predicate produces the
 * stamp-verdict distribution that `lore assess` and `lore status` both render.
 * Half (c), the totality of `readStampVerdict`, is owned by `stamp-types.test.ts`.
 *
 * Everything runs through the REAL services over an `InMemoryStore` (a throwaway corpus; the repo's
 * own `.lore/` is never touched). Rows are written by `recordVerifiedEvidence`, the cutoff by the real
 * arming step, the verdicts by the real `loadStampBindingContext` + `buildTaskAttestationInfos` +
 * `attestationFloor`. The radius axis is measured against a REAL throwaway repository through
 * `SpawnGitPort`, and against injected ports where the radius itself is the variable.
 *
 * Halves (failure-first; every refusal has its accept control):
 *  (a)  stamped + radius unmeasured                   -> ACCEPTED; its own `radius_unmeasured` count
 *  (b)  PRECEDENCE: unbound + radius unmeasured       -> still REFUSED; unbound + radius "unchanged" too
 *  (b') stamped + radius changed                      -> REFUSED (stale); control: unchanged -> ACCEPTED;
 *       legacy_unbound is ACCEPTED whatever the radius says (the radius is never read for it)
 *  (d)  one predicate, five buckets summing to the attested-row total, beside (never merged into) the
 *       capture_source distribution; the adapters hold no second derivation
 *
 * Falsifiers (each maps to a test below that fails if the mutation is made):
 *  (a) REFUSE stamped+unmeasured            -> "(a) ... ACCEPTED" fails
 *  (b) read the radius before the stamp     -> "(b) ... still REFUSED" fails
 *  (d) merge the two distributions          -> "(d) never merged" fails
 *
 * @spec_ref spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-9
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTaskAttestationInfos,
  type CreateDocInput,
  type DeclaredScopeCoverage,
  type DocRecord,
  type StampBindingContext,
  type TaskAttestationInfo,
} from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { TaskWorkflowService, type VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";
import { StateBindingService } from "../../../src/service/state-binding-service.js";
import {
  loadStampBindingContext,
  measureRadiusByDoc,
  type RadiusDiffPort,
} from "../../../src/service/stamp-binding-reader.js";
import { SpawnGitPort } from "../../../src/service/rule-state-git-port.js";
import {
  ATTESTATION_FLOOR_FIELD,
  ATTESTATION_FLOOR_REASON,
  attestationFloor,
  computeStampVerdictDistribution,
  readStampVerdict,
} from "../../../src/service/gate-predicates.js";
import {
  computeCaptureSourceDistribution,
  formatStampVerdictLine,
} from "../../../src/adapters/cli/assess-render.js";
import { actedStore } from "../../live-invocation.js";

// ─── Harness ────────────────────────────────────────────────────────────────

const NOW = "2026-10-17T10:00:00.000Z";
const HEAD = "7ab1d742c0f9e1b6a3d5c8e2f4b7a9d0c1e3f5a7";
const REFUSED = { ok: false, reason: ATTESTATION_FLOOR_REASON, field: ATTESTATION_FLOOR_FIELD };

function makeCorpus() {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const tasks = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  const binding = new StateBindingService(store);
  return { store, corpus, tasks, binding };
}
type Corpus = ReturnType<typeof makeCorpus>;

async function createTask(c: Corpus, title: string, fileAnchors: string[] = []): Promise<DocRecord> {
  const plan = await c.corpus.create({ type: "plan", title: `Plan ${title}`, content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
  const task = await c.corpus.create({
    type: "task",
    title,
    parent_id: plan.value.id,
    content: "body",
    extra: { plan_id: plan.value.id, ...(fileAnchors.length > 0 ? { file_anchors: fileAnchors } : {}) },
  } as CreateDocInput);
  if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
  return task.value;
}

type Attestation = NonNullable<VerifiedEvidenceInput["attestation"]>;

function attestedPass(
  extraAttestation: Partial<Attestation> = {},
  command = "bun run typecheck",
): VerifiedEvidenceInput {
  return {
    oracle: "tsc",
    command,
    result: "pass",
    recorded_by: "runner",
    capture_source: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, ...extraAttestation },
  };
}

const stampedAt = (head: string): Partial<Attestation> => ({ state_stamp: { head_sha: head, worktree_dirty: false } });

async function record(c: Corpus, task: DocRecord, entry: VerifiedEvidenceInput): Promise<DocRecord> {
  const written = await c.tasks.recordVerifiedEvidence(task.id, entry, NOW);
  if (!written.ok) throw new Error(`record failed: ${JSON.stringify(written.error)}`);
  return written.value;
}

async function arm(c: Corpus): Promise<void> {
  const armed = await c.binding.arm({ actor: "agent:test", nowIso: NOW });
  if (!armed.ok) throw new Error(`arm failed: ${JSON.stringify(armed.error)}`);
}

async function bindingFor(
  c: Corpus,
  tasks: readonly DocRecord[],
  diff?: RadiusDiffPort,
): Promise<StampBindingContext> {
  const binding = await loadStampBindingContext(c.store, tasks, diff);
  if (!binding.ok) throw new Error(`binding load failed: ${JSON.stringify(binding.error)}`);
  return binding.value;
}

async function infosFor(c: Corpus, tasks: readonly DocRecord[], diff?: RadiusDiffPort): Promise<TaskAttestationInfo[]> {
  return buildTaskAttestationInfos(tasks, await bindingFor(c, tasks, diff));
}

const SCOPE_OK: DeclaredScopeCoverage = {
  declared_acs: ["AC-1"],
  unattested_acs: [],
  scope_undeclared: false,
  meets_coverage: true,
};

/** `attestationFloor` with every OTHER conjunct satisfied, so the stamp-then-radius read alone decides. */
function floorVerdict(infos: readonly TaskAttestationInfo[]) {
  return attestationFloor(infos, null, "plan-x", [], SCOPE_OK);
}

/** A diff port whose answer is the variable under test; records every question it was asked. */
function fixedDiff(answer: "changed" | "unchanged" | "unanswerable") {
  const asked: { sha: string; paths: string[] }[] = [];
  const port: RadiusDiffPort = {
    changedSince(sha, paths) {
      asked.push({ sha, paths });
      if (answer === "unanswerable") {
        return { ok: false, error: { code: "STORE_ERROR", message: "git cannot answer" } } as never;
      }
      return { ok: true, value: answer === "changed" } as never;
    },
  };
  return { port, asked };
}

/** `bun run typecheck` names no pathspec and the task declares no anchor, so its radius is unmeasurable. */
const NO_PATHSPEC = "bun run typecheck";
const WITH_PATHSPEC = "bunx --bun vitest run packages/x/a.test.ts";

// ─── (a) stamped + unmeasured is ACCEPTED ───────────────────────────────────

describe("AC-CT-9 (a): a stamped row whose radius is unmeasurable satisfies the floor", () => {
  it("(a) stamped + no pathspec in the command or the anchors (radius unmeasured) is ACCEPTED, and counted as radius_unmeasured", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "unmeasured");
    const written = await record(c, task, attestedPass(stampedAt(HEAD), NO_PATHSPEC));
    const { port, asked } = fixedDiff("changed");

    const infos = await infosFor(c, [written], port);

    expect(floorVerdict(infos)).toEqual({ ok: true });
    expect(infos[0]?.stampTally).toMatchObject({ stamped: 1, radius_unmeasured: 1, bound: 0, stale: 0 });
    // The radius was never even asked for: an empty radius is `unmeasured` BEFORE git is consulted.
    expect(asked).toEqual([]);
  });

  it("(a) a diff port that cannot answer (shallow clone, unknown sha) reads unmeasured, never `changed` and never `unchanged`", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "unanswerable");
    const written = await record(c, task, attestedPass(stampedAt(HEAD), WITH_PATHSPEC));
    const { port } = fixedDiff("unanswerable");

    const infos = await infosFor(c, [written], port);

    expect(floorVerdict(infos)).toEqual({ ok: true });
    expect(infos[0]?.stampTally).toMatchObject({ radius_unmeasured: 1, bound: 0, stale: 0 });
  });

  it("(a) with NO diff port at all (a bare construction) every stamped row is radius_unmeasured and accepted", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "no-port");
    const written = await record(c, task, attestedPass(stampedAt(HEAD), WITH_PATHSPEC));

    const infos = await infosFor(c, [written]);

    expect(floorVerdict(infos)).toEqual({ ok: true });
    expect(infos[0]?.stampTally).toMatchObject({ stamped: 1, radius_unmeasured: 1 });
  });
});

// ─── (b) precedence: the stamp axis is read FIRST ───────────────────────────

describe("AC-CT-9 (b): the stamp axis precedes the radius axis", () => {
  it("(b) PRECEDENCE CONTROL: an UNBOUND row with an unmeasured radius is still REFUSED", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "unbound-unmeasured");
    await arm(c);
    const written = await record(c, task, attestedPass({}, NO_PATHSPEC)); // post-arming, no stamp

    const infos = await infosFor(c, [written], fixedDiff("unanswerable").port);

    expect(infos[0]?.stampTally).toMatchObject({ unbound: 1, stamped: 0, radius_unmeasured: 0 });
    expect(floorVerdict(infos)).toEqual(REFUSED);
  });

  it("(b) an UNBOUND row is REFUSED even when the radius would read 'unchanged': the radius never launders it", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "unbound-unchanged");
    await arm(c);
    const written = await record(c, task, attestedPass({}, WITH_PATHSPEC));
    const { port, asked } = fixedDiff("unchanged");

    const infos = await infosFor(c, [written], port);

    expect(floorVerdict(infos)).toEqual(REFUSED);
    // No stamp, so there is no recorded HEAD to diff: the radius was not read for this row at all.
    expect(asked).toEqual([]);
  });

  it("(b) a dirty-tree row (post-arming) is unbound with its own reason, refused before the radius, never a sixth reading", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "dirty");
    await arm(c);
    const written = await record(c, task, attestedPass({ stamp_unbound_reason: "dirty_tree" }, WITH_PATHSPEC));

    const infos = await infosFor(c, [written], fixedDiff("unchanged").port);

    expect(infos[0]?.stampTally?.unbound_reasons.dirty_tree).toBe(1);
    expect(floorVerdict(infos)).toEqual(REFUSED);
  });

  it("(b) legacy_unbound is ACCEPTED whatever the radius says, and the radius is never read for it", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "legacy");
    const before = await record(c, task, attestedPass({}, WITH_PATHSPEC));
    await arm(c);
    const { port, asked } = fixedDiff("changed");

    const infos = await infosFor(c, [before], port);

    expect(infos[0]?.stampTally).toMatchObject({ legacy_unbound: 1, unbound: 0, stale: 0 });
    expect(floorVerdict(infos)).toEqual({ ok: true });
    expect(asked).toEqual([]);
  });

  it("(b') a stamped row whose radius CHANGED is REFUSED as stale, with the exact floor reason and field", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "stale");
    const written = await record(c, task, attestedPass(stampedAt(HEAD), WITH_PATHSPEC));
    const { port, asked } = fixedDiff("changed");

    const infos = await infosFor(c, [written], port);

    expect(infos[0]?.stampTally).toMatchObject({ stamped: 1, stale: 1, bound: 0, radius_unmeasured: 0 });
    expect(floorVerdict(infos)).toEqual(REFUSED);
    // The diff was asked from the row's OWN recorded HEAD, over the command's test-file pathspec.
    expect(asked).toEqual([{ sha: HEAD, paths: ["packages/x/a.test.ts"] }]);
  });

  it("(b') CONTROL: the identical stamped row whose radius is UNCHANGED is ACCEPTED (bound)", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "bound");
    const written = await record(c, task, attestedPass(stampedAt(HEAD), WITH_PATHSPEC));

    const infos = await infosFor(c, [written], fixedDiff("unchanged").port);

    expect(infos[0]?.stampTally).toMatchObject({ stamped: 1, bound: 1, stale: 0 });
    expect(floorVerdict(infos)).toEqual({ ok: true });
  });

  it("(b') one stale row does not refuse a task that also holds an accepted row (only stale-ONLY is refused)", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "mixed");
    await record(c, task, attestedPass(stampedAt(HEAD), WITH_PATHSPEC));
    const written = await record(c, task, attestedPass(stampedAt(HEAD), NO_PATHSPEC));

    const infos = await infosFor(c, [written], fixedDiff("changed").port);

    expect(infos[0]?.stampTally).toMatchObject({ stale: 1, radius_unmeasured: 1 });
    expect(infos[0]?.attestedCount).toBe(1);
    expect(floorVerdict(infos)).toEqual({ ok: true });
  });
});

// ─── the radius measured against a REAL throwaway repository ────────────────

describe("AC-CT-9 radius axis over a real throwaway repository", () => {
  let repo: string | undefined;
  afterEach(() => {
    if (repo !== undefined) rmSync(repo, { recursive: true, force: true });
    repo = undefined;
  });

  function initRepo(): { git: (...args: string[]) => string; commit: (msg: string) => string; root: string } {
    const root = mkdtempSync(join(tmpdir(), "ct9-"));
    repo = root;
    const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    mkdirSync(join(root, "packages/x"), { recursive: true });
    writeFileSync(join(root, "packages/x/a.test.ts"), "1\n");
    writeFileSync(join(root, "keep.txt"), "k\n");
    const commit = (msg: string): string => {
      git("add", "-A");
      git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg);
      return git("rev-parse", "HEAD");
    };
    return { git, commit, root };
  }

  it("a peer commit INSIDE the radius makes the stamped row stale and the floor refuses it; one OUTSIDE leaves it bound and accepted", async () => {
    const { commit, root } = initRepo();
    const base = commit("base");
    const c = makeCorpus();
    const task = await createTask(c, "real-git");
    const written = await record(c, task, attestedPass(stampedAt(base), WITH_PATHSPEC));
    const diff = new SpawnGitPort(root);

    writeFileSync(join(root, "keep.txt"), "peer outside\n");
    commit("peer outside the radius");
    const outside = await infosFor(c, [written], diff);
    expect(outside[0]?.stampTally).toMatchObject({ bound: 1, stale: 0 });
    expect(floorVerdict(outside)).toEqual({ ok: true });

    writeFileSync(join(root, "packages/x/a.test.ts"), "2\n");
    commit("peer inside the radius");
    const inside = await infosFor(c, [written], diff);
    expect(inside[0]?.stampTally).toMatchObject({ bound: 0, stale: 1 });
    expect(floorVerdict(inside)).toEqual(REFUSED);
  });

  it("the task's file_anchors join the radius: a peer commit touching only an anchor makes the row stale", async () => {
    const { commit, root } = initRepo();
    const base = commit("base");
    const c = makeCorpus();
    const task = await createTask(c, "anchored", ["keep.txt"]);
    const written = await record(c, task, attestedPass(stampedAt(base), NO_PATHSPEC));

    writeFileSync(join(root, "keep.txt"), "peer touches the anchor\n");
    commit("peer on the anchor");

    const radii = measureRadiusByDoc([written], new SpawnGitPort(root));
    expect(radii.get(written.id)).toEqual([{ status: "measured", changed: true }]);
  });

  it("an unknown recorded HEAD (git cannot answer) reads unmeasured, never stale", async () => {
    const { commit, root } = initRepo();
    commit("base");
    const c = makeCorpus();
    const task = await createTask(c, "unknown-head");
    const written = await record(c, task, attestedPass(stampedAt("0".repeat(40)), WITH_PATHSPEC));

    const infos = await infosFor(c, [written], new SpawnGitPort(root));

    expect(infos[0]?.stampTally).toMatchObject({ radius_unmeasured: 1, stale: 0 });
    expect(floorVerdict(infos)).toEqual({ ok: true });
  });
});

// ─── (d) one predicate, five buckets, beside the capture_source one ─────────

describe("AC-CT-9 (d): the stamp-verdict distribution", () => {
  /** A corpus holding one row in EACH of the five readings (plus one self-report that has no stamp reading). */
  async function fiveReadingsCorpus() {
    const c = makeCorpus();
    const legacyTask = await createTask(c, "legacy");
    await record(c, legacyTask, attestedPass({}, WITH_PATHSPEC)); // legacy_unbound once armed
    await arm(c);
    const task = await createTask(c, "mix");
    await record(c, task, attestedPass(stampedAt(HEAD), WITH_PATHSPEC)); // bound
    await record(c, task, attestedPass(stampedAt(HEAD.replace(/.$/, "8")), WITH_PATHSPEC)); // stale
    await record(c, task, attestedPass(stampedAt(HEAD), NO_PATHSPEC)); // radius_unmeasured
    await record(c, task, attestedPass({}, NO_PATHSPEC)); // unbound / no_stamp
    await record(c, task, attestedPass({ stamp_unbound_reason: "dirty_tree" }, NO_PATHSPEC)); // unbound / dirty_tree
    const self = await c.tasks.addEvidence(task.id, { oracle: "manual", command: "looked", result: "pass", recorded_by: "agent:test", capture_source: "self-report", output_tail: "read the rendered page by eye" }, () => NOW);
    if (!self.ok) throw new Error(`self-report failed: ${JSON.stringify(self.error)}`);
    const docs = [await refetch(c, legacyTask.id), await refetch(c, task.id)];
    // changed for HEAD…8, unchanged for HEAD: the answer depends on the question.
    const port: RadiusDiffPort = {
      changedSince: (sha) => ({ ok: true, value: sha.endsWith("8") }) as never,
    };
    return { c, docs, port };
  }

  async function refetch(c: Corpus, id: string): Promise<DocRecord> {
    const found = await c.store.find(id);
    if (!found.ok || found.value === null) throw new Error("refetch failed");
    return found.value;
  }

  it("(d) five buckets, each row in exactly one, radius_unmeasured with its OWN count, the five summing to the attested-row total", async () => {
    const { c, docs, port } = await fiveReadingsCorpus();

    const distribution = computeStampVerdictDistribution(docs, await bindingFor(c, docs, port));

    expect(distribution).toMatchObject({
      total: 6,
      bound: 1,
      stale: 1,
      radius_unmeasured: 1,
      unbound: 2,
      legacy_unbound: 1,
    });
    expect(
      distribution.bound +
        distribution.stale +
        distribution.radius_unmeasured +
        distribution.unbound +
        distribution.legacy_unbound,
    ).toBe(distribution.total);
    // The reason counts PARTITION the unbound bucket.
    expect(distribution.unbound_reasons).toEqual({ dirty_tree: 1, state_moved: 0, audit_id_unresolved: 0, no_stamp: 1 });
    expect(Object.values(distribution.unbound_reasons).reduce((a, b) => a + b, 0)).toBe(distribution.unbound);
  });

  it("(d) the service method the adapters call returns the SAME value as the exported predicate (no second derivation)", async () => {
    const { c, docs, port } = await fiveReadingsCorpus();
    c.corpus.setStampRadiusDiff(port);

    const viaService = await c.corpus.stampVerdictDistribution(docs);
    const direct = computeStampVerdictDistribution(docs, await bindingFor(c, docs, port));

    expect(viaService).toEqual({ ok: true, value: direct });
  });

  it("(d) never merged: the capture_source distribution buckets the SAME rows on another axis and sums to ITS OWN total, not twice the row count", async () => {
    const { c, docs, port } = await fiveReadingsCorpus();
    const stamp = computeStampVerdictDistribution(docs, await bindingFor(c, docs, port));
    const captureSource = computeCaptureSourceDistribution({ tasks: docs } as never);

    const evidenceRows = 7; // six attested rows + the one self-report
    expect(captureSource.runnerCount + captureSource.selfReportCount + captureSource.runnerUnattestedCount).toBe(evidenceRows);
    expect(stamp.total).toBe(6); // attested rows only: a self-report has no stamp reading
    expect(stamp.total + 1).toBe(evidenceRows);
    // Disjoint vocabularies: no bucket of one axis is a bucket of the other.
    const stampKeys = Object.keys(stamp);
    for (const key of ["runnerCount", "selfReportCount", "runnerUnattestedCount"]) {
      expect(stampKeys).not.toContain(key);
    }
  });

  it("(d) the rendered line names all five readings, radius-unmeasured on its own", async () => {
    const { c, docs, port } = await fiveReadingsCorpus();

    const line = formatStampVerdictLine(computeStampVerdictDistribution(docs, await bindingFor(c, docs, port)));

    expect(line).toBe(
      "Stamp verdicts (6 attested rows): 1 bound / 1 stale / 1 radius-unmeasured / 2 unbound (dirty_tree 1, no_stamp 1) / 1 legacy-unbound",
    );
  });

  it("(d) the five buckets are exactly readStampVerdict's five readings: every reading is reachable and no other bucket exists", async () => {
    const { c, docs, port } = await fiveReadingsCorpus();
    const distribution = computeStampVerdictDistribution(docs, await bindingFor(c, docs, port));
    const readings = new Set(
      (["stamped", "unbound", "legacy_unbound"] as const).flatMap((stamp) =>
        [
          { status: "measured", changed: true } as const,
          { status: "measured", changed: false } as const,
          { status: "unmeasured" } as const,
        ].map((radius) => readStampVerdict({ stamp, radius })),
      ),
    );
    expect([...readings].sort()).toEqual(["bound", "legacy_unbound", "radius_unmeasured", "stale", "unbound"]);
    for (const reading of readings) expect(distribution[reading]).toBeGreaterThan(0);
  });

  const ADAPTERS = ["assess.ts", "status.ts"].map((file) =>
    join(__dirname, "../../../src/adapters/cli/commands", file),
  );

  it("(d) both adapters route through the ONE service method and derive no bucket of their own", () => {
    for (const path of ADAPTERS) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("stampVerdictDistribution(");
      expect(source, path).toContain("formatStampVerdictLine(");
      // No private re-derivation: the classifier and the radius vocabulary live in one place.
      expect(source, path).not.toMatch(/readStampVerdict|readStampedRadius|classifyEvidenceStamps|radius_unmeasured\s*\+=/);
    }
  });
});
