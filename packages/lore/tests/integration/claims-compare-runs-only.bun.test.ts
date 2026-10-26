// @spawns packages/lore/src/index.ts
/**
 * AC-HID-3 — claims compare RUNS, never names (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end
 * state 4; BR-1040, BR-1043, BR-1056, BR-130).
 *
 * Contract under test, in a throwaway corpus, with a registered person (`lore session start --human dana`) and agent
 * runs as the parties:
 *   - two runs that derive the SAME display name are two holders: the second's claim of a held task is refused naming
 *     the first run, and the first's lease is untouched;
 *   - a claim whose anchors overlap another run's live claim is refused (exit 4) naming the holder run and the
 *     overlapping locations, and stores nothing;
 *   - a release by the other run without force is refused (naming the holder run) and keeps the lease; with force it
 *     releases;
 *   - the SAME run claiming again refreshes the lease and never conflicts with itself (also across overlapping anchors);
 *   - a lease that names no run (written before runs were compared) belongs to nobody: a claimant carrying the holder's
 *     very NAME is refused, and only `--force` releases it.
 *
 * Why the same-name pair is two AGENT runs: a checkout holds at most ONE open human session (a second `session start`
 * is refused), so two live people never share a corpus under one name; two agent sessions whose ids share their first
 * eight characters DO derive one name (`agent:session-<8>`), which is exactly the collision a name comparison missed.
 * The person's run is still a party in every scenario below (it holds, refreshes and is refused like any other run).
 *
 * Exit codes are the CLI's real ones: a refused claim or release is `CLAIM_CONFLICT` (exit 5, the write-contention
 * family); an anchor overlap is a gate refusal (`VALIDATION_ERROR`, exit 4).
 *
 * Dimensions: HAPPY (refresh by the same run, force release) / NEGATIVE (second run under one name, other run's
 * release, overlapping anchors) / BOUNDARY (a person holding two overlapping tasks under ONE run) / STATE (the stored
 * lease keeps its run) / REGRESSION (a name never decides: both runs below carry the identical name).
 *
 * MOCK RISK: none — the real CLI against a real corpus file.
 *
 * @spec_ref AC-HID-3
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { nameOfAgentRun, type RunId } from "@lore/core";
import { createPartyCorpus, type LoreRun, type PartyCorpus } from "../helpers/known-party-corpus.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const HUMAN: { readonly kind: "human" } = { kind: "human" };
const CLAIM_CONFLICT_EXIT = 5;
const GATE_REFUSAL_EXIT = 4;

/** Two agent runs of sessions whose ids share their first eight characters: ONE derived name, TWO runs. */
const RUN_ONE = "cc:hid3aaaa-one";
const RUN_TWO = "cc:hid3aaaa-two";

interface StoredClaim {
  readonly by: string;
  readonly at: string;
  readonly harness_run?: string | null;
}

function claimOf(corpus: PartyCorpus, slug: string): StoredClaim | undefined {
  const db = new Database(join(corpus.dir, ".lore", "lore.db"), { readonly: true });
  try {
    const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as { extra: string } | null;
    if (row === null) throw new Error(`no doc ${slug}`);
    return (JSON.parse(row.extra) as { claim?: StoredClaim }).claim;
  } finally {
    db.close();
  }
}

/** Rewrites the stored lease of `slug` to the shape every claim had before runs were compared: a name and a time, no run. */
function seedRunlessLease(corpus: PartyCorpus, slug: string, by: string): void {
  const db = new Database(join(corpus.dir, ".lore", "lore.db"));
  try {
    const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as { extra: string };
    const extra = JSON.parse(row.extra) as Record<string, unknown>;
    extra["claim"] = { by, at: new Date().toISOString() };
    db.query("UPDATE docs SET extra = ? WHERE slug = ?").run(JSON.stringify(extra), slug);
  } finally {
    db.close();
  }
}

function claim(corpus: PartyCorpus, slug: string, party: Parameters<PartyCorpus["lore"]>[1], extra: readonly string[] = []): LoreRun {
  return corpus.lore(["claim", slug, ...(extra.includes("--worktree") ? [] : ["--worktree", `cr-wt-${slug}`]), ...extra], party);
}

describe("AC-HID-3: claims compare runs, never names", () => {
  let corpus: PartyCorpus;
  let plan: string;
  let danaRun: string;

  function newTask(title: string, anchors: readonly string[] = []): string {
    const created = corpus.setup([
      "create", "task", "--title", title, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai",
      ...anchors.flatMap((anchor) => ["--anchor", anchor]),
    ]);
    return corpus.slugOf(created);
  }

  beforeAll(() => {
    corpus = createPartyCorpus("hid3");
    const prd = corpus.slugOf(corpus.setup(["create", "prd", "--title", "Claims PRD", "--content", "root", "--no-ai"]));
    plan = corpus.slugOf(corpus.setup(["create", "plan", "--title", "Claims Plan", "--parent", prd, "--content", "x", "--no-ai"]));
    const started = corpus.lore(["session", "start", "--human", "dana"]);
    expect(started.exitCode).toBe(0);
    const match = started.stdout.match(/run (human:[0-9a-f]+)/);
    if (match?.[1] === undefined) throw new Error(`no run id in: ${started.stdout}`);
    danaRun = match[1];
  });

  afterAll(() => {
    corpus.cleanup();
  });

  describe("a held task", () => {
    it("the registered person's claim stores the person's run; the same run claiming again refreshes the lease", () => {
      const task = newTask("Held by dana");
      expect(claim(corpus, task, HUMAN).exitCode).toBe(0);
      const first = claimOf(corpus, task);
      expect(first?.harness_run).toBe(danaRun);

      const again = claim(corpus, task, HUMAN);

      expect(again.exitCode).toBe(0);
      const refreshed = claimOf(corpus, task);
      expect(refreshed?.harness_run).toBe(danaRun);
      expect(Date.parse(refreshed!.at)).toBeGreaterThanOrEqual(Date.parse(first!.at));
    });

    it("another run's claim of the person's task is refused naming the person's run, and the lease keeps its run", () => {
      const task = newTask("Held by dana, claimed by an agent");
      expect(claim(corpus, task, HUMAN).exitCode).toBe(0);

      const refused = claim(corpus, task, { kind: "run", run: RUN_ONE });

      expect(refused.exitCode).toBe(CLAIM_CONFLICT_EXIT);
      expect(refused.stderr).toContain(danaRun);
      expect(claimOf(corpus, task)?.harness_run).toBe(danaRun);
    });

    it("the person's claim of an agent run's task is refused naming that run", () => {
      const task = newTask("Held by an agent, claimed by dana");
      expect(claim(corpus, task, { kind: "run", run: RUN_ONE }).exitCode).toBe(0);

      const refused = claim(corpus, task, HUMAN);

      expect(refused.exitCode).toBe(CLAIM_CONFLICT_EXIT);
      expect(refused.stderr).toContain(RUN_ONE);
      expect(claimOf(corpus, task)?.harness_run).toBe(RUN_ONE);
    });

    it("two runs that derive the SAME name are two holders: the second's claim is refused naming the first run", () => {
      const task = newTask("Held under a shared name");
      expect(claim(corpus, task, { kind: "run", run: RUN_ONE }).exitCode).toBe(0);
      const stored = claimOf(corpus, task);

      const refused = claim(corpus, task, { kind: "run", run: RUN_TWO });

      expect(refused.exitCode).toBe(CLAIM_CONFLICT_EXIT);
      expect(refused.stderr).toContain(RUN_ONE);
      expect(claimOf(corpus, task)).toEqual(stored);

      // REGRESSION: the two runs really do carry one display name, so only the run can have decided.
      const otherTask = newTask("Second run, same name");
      expect(claim(corpus, otherTask, { kind: "run", run: RUN_TWO }).exitCode).toBe(0);
      expect(claimOf(corpus, otherTask)?.by).toBe(stored?.by);
    });
  });

  describe("a lease that names no run", () => {
    it("belongs to nobody: a claimant carrying the holder's very NAME is refused, naming the holder, and the lease is untouched", () => {
      const task = newTask("Run-less lease, same name");
      const name = nameOfAgentRun(RUN_ONE as RunId);
      seedRunlessLease(corpus, task, name);

      const refused = claim(corpus, task, { kind: "run", run: RUN_ONE });

      expect(refused.exitCode).toBe(CLAIM_CONFLICT_EXIT);
      expect(refused.stderr).toContain(name);
      expect(claimOf(corpus, task)).toMatchObject({ by: name });
      expect(claimOf(corpus, task)).not.toHaveProperty("harness_run");
    });

    it("is released by no name: the holder's same-name run needs --force, and --force releases it", () => {
      const task = newTask("Run-less lease, release");
      const name = nameOfAgentRun(RUN_ONE as RunId);
      seedRunlessLease(corpus, task, name);

      const refused = corpus.lore(["release", task], { kind: "run", run: RUN_ONE });
      expect(refused.exitCode).toBe(CLAIM_CONFLICT_EXIT);
      expect(claimOf(corpus, task)).toBeDefined();

      const forced = corpus.lore(["release", task, "--force"], { kind: "run", run: RUN_ONE });
      expect(forced.exitCode).toBe(0);
      expect(claimOf(corpus, task)).toBeUndefined();
    });
  });

  describe("overlapping anchors", () => {
    it("a claim overlapping another run's live claim is refused (exit 4) naming the holder run and the overlapping location, and stores nothing", () => {
      const holder = newTask("Anchor holder", ["packages/zone-hid3/"]);
      const contender = newTask("Anchor contender", ["packages/zone-hid3/file.ts"]);
      expect(claim(corpus, holder, HUMAN).exitCode).toBe(0);

      const refused = claim(corpus, contender, { kind: "run", run: RUN_ONE });

      expect(refused.exitCode).toBe(GATE_REFUSAL_EXIT);
      expect(refused.stderr).toContain(danaRun);
      expect(refused.stderr).toContain("packages/zone-hid3");
      expect(refused.stderr).toContain(holder);
      expect(claimOf(corpus, contender)).toBeUndefined();
    });

    it("BOUNDARY: the SAME run holding a task never conflicts with itself across overlapping anchors", () => {
      const first = newTask("Own run first", ["packages/zone-hid3-own/"]);
      const second = newTask("Own run second", ["packages/zone-hid3-own/inner.ts"]);
      expect(claim(corpus, first, HUMAN).exitCode).toBe(0);

      const own = claim(corpus, second, HUMAN);

      expect(own.exitCode).toBe(0);
      expect(claimOf(corpus, second)?.harness_run).toBe(danaRun);
    });

    it("two runs that derive the SAME name still conflict on overlapping anchors (the name never exempts)", () => {
      const first = newTask("Shared name anchor one", ["packages/zone-hid3-name/"]);
      const second = newTask("Shared name anchor two", ["packages/zone-hid3-name/leaf.ts"]);
      expect(claim(corpus, first, { kind: "run", run: RUN_ONE }).exitCode).toBe(0);

      const refused = claim(corpus, second, { kind: "run", run: RUN_TWO });

      expect(refused.exitCode).toBe(GATE_REFUSAL_EXIT);
      expect(refused.stderr).toContain(RUN_ONE);
      expect(claimOf(corpus, second)).toBeUndefined();
    });
  });

  describe("release", () => {
    it("a release by the other run without force is refused naming the holder run and keeps the lease", () => {
      const task = newTask("Release by the other run");
      expect(claim(corpus, task, HUMAN).exitCode).toBe(0);

      const refused = corpus.lore(["release", task], { kind: "run", run: RUN_ONE });

      expect(refused.exitCode).toBe(CLAIM_CONFLICT_EXIT);
      expect(refused.stderr).toContain(danaRun);
      expect(claimOf(corpus, task)?.harness_run).toBe(danaRun);
    });

    it("the holder's own run releases without force; the other run needs --force and the release then clears the lease", () => {
      const own = newTask("Release by the holder");
      expect(claim(corpus, own, HUMAN).exitCode).toBe(0);
      expect(corpus.lore(["release", own], HUMAN).exitCode).toBe(0);
      expect(claimOf(corpus, own)).toBeUndefined();

      const forced = newTask("Release forced by the other run");
      expect(claim(corpus, forced, HUMAN).exitCode).toBe(0);
      expect(corpus.lore(["release", forced, "--force"], { kind: "run", run: RUN_ONE }).exitCode).toBe(0);
      expect(claimOf(corpus, forced)).toBeUndefined();
    });
  });
});
