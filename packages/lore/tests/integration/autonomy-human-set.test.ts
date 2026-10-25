/**
 * AC-LG-8 oracle — only three classes wait for a human (BR-1370).
 *
 * Everything runs against a THROWAWAY corpus store (mkdtemp + SQLiteStore) and a throwaway git repo — never this
 * repo's own `.lore/` or stashes. Decisions go through the real DecisionService over the real store, so a `milestone`
 * verdict is proven to be accepted by the migrated `decision_log` CHECK (migration 032) and to keep the chain valid.
 *
 * Halves: (1) the human-always set of the class table AND of the governed seed is exactly {push-force,
 * archive-ref-prune, governance-loosen}, `report-issue` is no class; (2) worktree-remove with only regenerable ignored
 * paths is auto with no pending decision; (3) stash-drop of an archived stash is auto with no pending decision, even
 * when its owner run is live; (4) override-judgment / override-attestation / ac-exempt record a `milestone` decision, open
 * no pending decision, and the override port lets the override through.
 * Controls: the three human classes DO open a pending decision; a worktree holding data outside the regenerable set
 * still escalates; verify-new-command is still decided by score; the chain verifies after every write.
 *
 * @spec_ref AC-LG-8
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, OPERATION_CLASS_REGISTRY, ok, seedGovernedThresholds, type AutonomyFacts } from "@lore/core";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { LATEST_SCHEMA_VERSION } from "../../src/store/schema-version.js";
import { verifyDecisionChain } from "../../src/store/decision-log.js";
import { DecisionService } from "../../src/service/decision-service.js";
import { createOverrideDecisionPort, OVERRIDE_MEASURED_FACTS } from "../../src/service/override-decision.js";
import { StashPruneService, type GitRunner } from "../../src/service/stash-prune-service.js";
import { actedStore } from "../live-invocation.js";

const HUMAN_CLASSES = ["archive-ref-prune", "governance-loosen", "push-force"] as const;
const MILESTONE_CLASSES = ["ac-exempt", "override-attestation", "override-judgment"] as const;

let dir = "";
let store: SQLiteStore;
let decisions: DecisionService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-lg8-"));
  store = actedStore(new SQLiteStore(join(dir, "lore.db")));
  decisions = new DecisionService({ store, executorRun: null });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function pendingClasses(): Promise<string[]> {
  const pending = await decisions.listPending();
  if (!pending.ok) throw new Error(`listPending failed: ${JSON.stringify(pending.error)}`);
  return pending.value.map((p) => p.class);
}

async function chainIsValid(): Promise<boolean> {
  const verified = await decisions.verifyChain();
  if (!verified.ok) throw new Error(`verifyChain failed: ${JSON.stringify(verified.error)}`);
  return verified.value.clean;
}

function humanClassesOf(table: Readonly<Record<string, { readonly tier: string }>>): string[] {
  return Object.entries(table)
    .filter(([, c]) => c.tier === "human-always")
    .map(([id]) => id)
    .sort();
}

describe("AC-LG-8 three human classes: the human-always set", () => {
  it("the class table's and the governed seed's human-always set equals exactly the three classes; report-issue is no class", () => {
    expect(humanClassesOf(OPERATION_CLASS_REGISTRY)).toEqual([...HUMAN_CLASSES]);
    expect(humanClassesOf(seedGovernedThresholds().classes)).toEqual([...HUMAN_CLASSES]);
    expect(Object.keys(OPERATION_CLASS_REGISTRY)).not.toContain("report-issue");
    // NEGATIVE: an unknown class is refused, never silently escalated to a human
    expect(decide("report-issue", "issue-1", {}).verdict).toBe("refuse");
  });

  it("each of the three human classes escalates and opens a pending decision (control: the set did not shrink)", async () => {
    for (const classId of HUMAN_CLASSES) {
      const outcome = await decisions.decide(classId, { id: `subject-${classId}`, version: "v1" }, {});
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.effective.verdict).toBe("escalate");
    }
    expect((await pendingClasses()).sort()).toEqual([...HUMAN_CLASSES]);
    expect(await chainIsValid()).toBe(true);
  });
});

describe("AC-LG-8 three human classes: worktree-remove and stash-drop decide without a human", () => {
  const regenerableOnly: AutonomyFacts = { recoverability: "loss-free-by-proof", blast: "own-or-ended-run", evidence: "lore-evaluated" };

  it("worktree-remove with only regenerable ignored paths is auto and opens no pending decision", async () => {
    const outcome = await decisions.decide("worktree-remove", { id: "/tmp/wt-a", version: "head:fp" }, regenerableOnly);
    expect(outcome.ok && outcome.value.effective.verdict).toBe("auto");
    expect(await pendingClasses()).toEqual([]);
  });

  it("CONTROL: a worktree holding ignored data outside the regenerable set is NOT auto", async () => {
    const outcome = await decisions.decide("worktree-remove", { id: "/tmp/wt-b", version: "head:fp2" }, { ...regenerableOnly, recoverability: "irreversible-local" });
    expect(outcome.ok && outcome.value.effective.verdict).toBe("escalate");
  });

  it("stash-drop of an archived stash is auto with no pending decision, even when its owner run is LIVE", async () => {
    const repo = join(dir, "repo");
    mkdirSync(repo);
    const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "f.txt"), "base\n");
    git("add", "f.txt");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "worktree-agent-liveagent");
    writeFileSync(join(repo, "f.txt"), "live work\n");
    git("stash", "push", "-m", "live wip");
    const sha = git("rev-parse", "stash@{0}");
    git("checkout", "-q", "main");

    const runner: GitRunner = (args, stdin) => {
      try {
        const stdout = execFileSync("git", [...args], { cwd: repo, encoding: "utf8", ...(stdin === undefined ? {} : { input: stdin }) });
        return { status: 0, stdout, stderr: "" };
      } catch (error) {
        const failed = error as { status?: number; stdout?: string; stderr?: string };
        return { status: failed.status ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
      }
    };
    // a run of agent "liveagent" that has NOT ended: the attribution is "live", which used to escalate forever
    const liveStore = {
      listRunsByAgentRef: async () => ok([{ id: "cc:sess-live:liveagent" }]),
      getRunEnd: async () => ok(null),
      findMany: async () => ok([]),
      listRunLifecycles: async () => ok([]),
    } as unknown as ConstructorParameters<typeof StashPruneService>[0]["store"];
    const applied = await new StashPruneService({ git: runner, store: liveStore, decisions }).apply();

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.entries[0]?.facts.attribution.state).toBe("live");
    expect(applied.value.counts).toEqual({ dropped: 1, kept: 0, escalated: 0 });
    expect(git("stash", "list")).toBe(""); // dropped from the stash list
    expect(git("rev-parse", "--verify", `refs/lore/archive/stash/${sha}^{commit}`)).toBe(sha); // archived first, recoverable
    expect(await pendingClasses()).toEqual([]);
    expect(await chainIsValid()).toBe(true);
  });
});

describe("AC-LG-8 three human classes: migration 032 widens the verdict CHECK without touching the chain", () => {
  const row = (verdict: "auto" | "escalate" | "milestone", subject: string) => ({
    ts: "2026-10-01T00:00:00.000Z", class: "override-judgment", subject_id: subject, subject_version: "1", facts: "{}", factors: "{}",
    score: 0, threshold: null, verdict, reasons: "[]", executor_run: null, channel: "machine" as const, detail: '{"summary":"s"}',
  });

  it("a schema-31 store REFUSES 'milestone'; after the upgrade the old rows (detail included) verify unchanged and 'milestone' is accepted", async () => {
    const path = join(dir, "old.db");
    const old = actedStore(new SQLiteStore(path, { schemaCeiling: 31 }));
    expect((await old.appendDecisionRecord(row("auto", "a"))).ok).toBe(true);
    expect((await old.appendDecisionRecord(row("escalate", "b"))).ok).toBe(true);
    const refused = await old.appendDecisionRecord(row("milestone", "c"));
    expect(refused.ok).toBe(false); // NEGATIVE: the CHECK of schema 31 does not know the verdict
    const before = await old.listDecisionLog();
    old.close();

    const upgraded = actedStore(new SQLiteStore(path, { migrate: true }));
    try {
      const after = await upgraded.listDecisionLog();
      expect(after.ok && before.ok && after.value).toEqual(before.ok ? before.value : []);
      expect(after.ok && after.value.length).toBe(2);
      expect(after.ok && after.value.every((r) => r.detail === '{"summary":"s"}')).toBe(true);
      expect(after.ok && verifyDecisionChain(after.value)).toEqual({ clean: true, checked: 2 });
      const appended = await upgraded.appendDecisionRecord(row("milestone", "c"));
      expect(appended.ok && appended.value.id).toBe(3);
      const final = await upgraded.listDecisionLog();
      expect(final.ok && verifyDecisionChain(final.value)).toEqual({ clean: true, checked: 3 });
      expect(() => upgraded.getDatabase().run("UPDATE decision_log SET score = 1")).toThrow(); // append-only trigger re-armed
      expect(upgraded.getDatabase().query("PRAGMA user_version").get()).toEqual({ user_version: LATEST_SCHEMA_VERSION });
    } finally {
      upgraded.close();
    }
  });
});

describe("AC-LG-8 three human classes: override classes are decided by the milestone review", () => {
  it("override-judgment / override-attestation / ac-exempt record a `milestone` decision and open no pending decision", async () => {
    for (const classId of MILESTONE_CLASSES) {
      const subject = { id: `doc-${classId}#x`, version: "1" };
      const outcome = await decisions.decide(classId, subject, OVERRIDE_MEASURED_FACTS, {
        summary: `Allow an override on doc-${classId}`,
        requested_by: "test",
        change: { document: `doc-${classId}`, override_class: classId },
        on_accept: "applies",
        on_reject: "refused",
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(outcome.value.decision.verdict).toBe("milestone");
      expect(outcome.value.effective.verdict).toBe("milestone");
    }
    expect(await pendingClasses()).toEqual([]);
    const rows = await store.listDecisionLog();
    expect(rows.ok).toBe(true);
    if (!rows.ok) return;
    // D1 queries these: class + subject + the recorded detail survive in the persisted row
    const milestone = rows.value.filter((r) => r.verdict === "milestone");
    expect(milestone.map((r) => r.class).sort()).toEqual([...MILESTONE_CLASSES]);
    expect(milestone.every((r) => r.subject_id.includes("#x") && r.detail !== null && r.channel === "machine")).toBe(true);
    expect(await chainIsValid()).toBe(true);
  });

  it("the override port lets a milestone override through (no pending decision) — and a repeat adds no pending one", async () => {
    const port = createOverrideDecisionPort(decisions);
    const request = { classId: "override-judgment", subject: { id: "spec-x#j1", version: "3" }, summary: "approve spec-x --override-judgment j1" } as const;
    expect((await port.requireAuto(request)).ok).toBe(true);
    expect((await port.requireAuto(request)).ok).toBe(true);
    expect(await pendingClasses()).toEqual([]);
  });

  it("CONTROL: verify-new-command is still decided by score, not by the milestone review", async () => {
    const outcome = await decisions.decide("verify-new-command", { id: "task-y#cmd", version: "1" }, OVERRIDE_MEASURED_FACTS);
    expect(outcome.ok && outcome.value.decision.verdict).toBe("auto");
  });
});
