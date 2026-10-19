/**
 * AC-HR-6 oracle — `lore decide` and `lore pending` print what a decision is about, in plain words, and link to its
 * dashboard detail page (spec-human-review-surface-decisions-audit-items-and-pending D5).
 *
 * Driven through `runDecideFlow` with scripted human-channel ports (never a real TTY, never the `lore decide`
 * binary). Everything runs in THROWAWAY dirs under mkdtemp: a database, a corpus root and a live-server registry
 * redirected with LORE_STATE_HOME; the repo's own `.lore/` is never touched.
 *
 * @spec_ref AC-HR-6
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Invocation } from "@lore/core";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { DecisionService } from "../../src/service/decision-service.js";
import type { DecisionDetail } from "../../src/store/decision-log.js";
import { NO_DETAIL_TEXT } from "../../src/store/decision-log.js";
import { runDecideFlow } from "../../src/adapters/cli/decide-flow.js";
import { registerLiveServer, resolveLiveServerRegistryDir } from "../../src/adapters/cli/live-server-registry.js";
import { renderAuditItems, renderPendingDecisions } from "../../src/adapters/cli/pending-decisions-render.js";
import type { AuditItem } from "../../src/service/autonomy-calibration-service.js";
import { scriptedHumanPorts } from "./fixtures/scripted-human-ports.js";
import { actedStore, liveInvocation } from "../live-invocation.js";

const WEAK = { recoverability: "loss-free-by-proof", blast: "calling-session", evidence: "none" } as const;
const LIVE_URL = "http://127.0.0.1:54321";

const LOOSEN_DETAIL: DecisionDetail = {
  summary: "Loosen the governed autonomy thresholds: stash-drop.threshold: 0.8 -> 0.5",
  requested_by: "lore (no attested run)",
  change: { entry: "stash-drop", before: { "stash-drop": { threshold: 0.8 } }, after: { "stash-drop": { threshold: 0.5 } } },
  on_accept: "The threshold is lowered once you re-run the command.",
  on_reject: "Nothing changes.",
};

const NO_BEFORE_AFTER_DETAIL: DecisionDetail = {
  summary: "Drop the stash named in the subject",
  requested_by: "lore (no attested run)",
  change: { entry: "stash@{0}" },
  on_accept: "The stash is dropped when the command is re-run.",
  on_reject: "The stash stays.",
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface Fixture {
  readonly dbPath: string;
  readonly corpusDir: string;
  readonly inv: Invocation;
  readonly registryDir: string;
}

function makeFixture(): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-hr6-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const stateDir = join(dir, "state");
  const corpusDir = join(dir, "corpus");
  const env = { LORE_STATE_HOME: stateDir };
  const base = liveInvocation();
  const inv: Invocation = { ...base, env, paths: { ...base.paths, home: dir, projectRoot: corpusDir } };
  return { dbPath: join(dir, "lore.db"), corpusDir, inv, registryDir: resolveLiveServerRegistryDir(env, dir) };
}

async function seed(fx: Fixture, classId: string, subjectId: string, detail?: DecisionDetail): Promise<number> {
  const store = actedStore(new SQLiteStore(fx.dbPath));
  try {
    const service = new DecisionService({ store, executorRun: null });
    const out = await service.decide(classId, { id: subjectId, version: "v1" }, classId === "governance-loosen" ? {} : WEAK, detail);
    if (!out.ok) throw new Error(`seed failed: ${JSON.stringify(out.error)}`);
    const pending = await service.listPending();
    if (!pending.ok) throw new Error("listPending failed");
    const row = pending.value.find((p) => p.subject_id === subjectId);
    if (row === undefined) throw new Error("seeded escalation is not pending");
    return row.id;
  } finally {
    store.close();
  }
}

/** Runs the real decide flow with a scripted human; returns what the terminal showed BEFORE the confirmation code. */
async function decideShown(fx: Fixture, id: number): Promise<{ readonly before: string[]; readonly all: string; readonly code: number }> {
  const terminalLog: string[] = [];
  const code = await runDecideFlow(
    fx.inv,
    { dbPath: fx.dbPath, id: String(id), accept: true, reject: false },
    scriptedHumanPorts({ terminalLog }),
    { stdout: () => undefined, stderr: () => undefined },
  );
  const all = terminalLog.join("");
  return { before: all.split("Confirmation code:")[0]!.split("\n"), all, code };
}

describe("AC-HR-6 lore decide prints the detail and a link", () => {
  it("AC-HR-6 governance-loosen: What/Before/After/If you accept/If you reject, then Details with the registered url", async () => {
    const fx = makeFixture();
    const id = await seed(fx, "governance-loosen", "stash-drop.threshold", LOOSEN_DETAIL);
    // the registry keys on the corpus root's realpath, so the directory must exist
    mkdirSync(fx.corpusDir, { recursive: true });
    cleanups.push(registerLiveServer({ registryDir: fx.registryDir, corpusRoot: fx.corpusDir, baseUrl: `${LIVE_URL}/` }));

    const shown = await decideShown(fx, id);
    expect(shown.code).toBe(0);
    const starts = (prefix: string) => shown.before.some((line) => line.startsWith(prefix));
    expect(shown.before).toContain(`What: ${LOOSEN_DETAIL.summary}`);
    expect(starts("Before: ")).toBe(true);
    expect(starts("After: ")).toBe(true);
    expect(shown.before).toContain(`If you accept: ${LOOSEN_DETAIL.on_accept}`);
    expect(shown.before).toContain(`If you reject: ${LOOSEN_DETAIL.on_reject}`);
    expect(shown.before.find((l) => l.startsWith("Before: "))).toContain("0.8");
    expect(shown.before.find((l) => l.startsWith("After: "))).toContain("0.5");
    expect(shown.before).toContain(`Details: ${LIVE_URL}/needs-you/decisions/${id}`);
    // the code line comes after every detail line, and the nonce never appears in the link
    expect(shown.all.indexOf("Details:")).toBeLessThan(shown.all.indexOf("Confirmation code:"));
    expect(shown.before.find((l) => l.startsWith("Details: "))).not.toMatch(/TESTN0/);
  });

  it("AC-HR-6 no live server: the Details line names the dashboard command and carries no URL", async () => {
    const fx = makeFixture();
    const id = await seed(fx, "governance-loosen", "stash-drop.threshold", LOOSEN_DETAIL);
    const shown = await decideShown(fx, id);
    expect(shown.before).toContain(`Details: start the dashboard with \`lore dashboard\`, then open /needs-you/decisions/${id}`);
    expect(shown.before.find((l) => l.startsWith("Details: "))).not.toContain("http");
  });

  it("AC-HR-6 a class with no before/after omits those two lines and prints the rest", async () => {
    const fx = makeFixture();
    const id = await seed(fx, "stash-drop", "stash@{0}", NO_BEFORE_AFTER_DETAIL);
    const shown = await decideShown(fx, id);
    expect(shown.before).toContain(`What: ${NO_BEFORE_AFTER_DETAIL.summary}`);
    expect(shown.before.some((l) => l.startsWith("Before: ") || l.startsWith("After: "))).toBe(false);
    expect(shown.before).toContain(`If you accept: ${NO_BEFORE_AFTER_DETAIL.on_accept}`);
    expect(shown.before).toContain(`If you reject: ${NO_BEFORE_AFTER_DETAIL.on_reject}`);
    expect(shown.before.some((l) => l.startsWith("Details: "))).toBe(true);
  });

  it("AC-HR-6 a row without detail says so exactly in the What line", async () => {
    const fx = makeFixture();
    const id = await seed(fx, "stash-drop", "stash@{1}");
    const shown = await decideShown(fx, id);
    expect(shown.before).toContain(`What: ${NO_DETAIL_TEXT}`);
    expect(NO_DETAIL_TEXT).toBe("no detail recorded (decided before detail existed)");
    expect(shown.before.some((l) => l.startsWith("If you accept: "))).toBe(false);
  });
});

describe("AC-HR-6 lore pending prints a Details line per decision and per audit row", () => {
  it("AC-HR-6 each open decision and each audit row gets a Details line of the same form", async () => {
    const fx = makeFixture();
    const id = await seed(fx, "governance-loosen", "stash-drop.threshold", LOOSEN_DETAIL);
    const store = actedStore(new SQLiteStore(fx.dbPath));
    let decisions;
    try {
      const listed = await new DecisionService({ store, executorRun: null }).listPending();
      if (!listed.ok) throw new Error("listPending failed");
      decisions = listed.value;
    } finally {
      store.close();
    }
    const audit: AuditItem[] = [
      { id: 9, class: "stash-drop", subject_id: "stash@{2}", subject_version: "v1", decided_at: "2026-10-19T00:00:00.000Z", sequence: 5, score: 0.9, detail: null },
    ];

    const live = renderPendingDecisions(decisions, LIVE_URL) + renderAuditItems(audit, LIVE_URL);
    expect(live).toContain(`Details: ${LIVE_URL}/needs-you/decisions/${id}`);
    expect(live).toContain(`Details: ${LIVE_URL}/needs-you/decisions/9`);
    expect(live).toContain(`What: ${LOOSEN_DETAIL.summary}`);
    expect(live).toContain(`What: ${NO_DETAIL_TEXT}`);

    const none = renderPendingDecisions(decisions, null) + renderAuditItems(audit, null);
    expect(none).toContain(`Details: start the dashboard with \`lore dashboard\`, then open /needs-you/decisions/${id}`);
    expect(none).toContain("Details: start the dashboard with `lore dashboard`, then open /needs-you/decisions/9");
    expect(none).not.toContain("http");
  });
});
