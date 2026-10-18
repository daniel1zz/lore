/**
 * Shared helpers for the AC-AU-8 / AC-AU-10 oracles: a THROWAWAY corpus (mkdtemp + `lore init`), the real CLI over it,
 * an in-process DecisionService, seeding of auto decisions, and the real `lore decide` flow driven through the
 * injectable human-channel ports (no pseudo-terminal needed; the flow, proof minting and writers are the real ones).
 * Never touches the repo's own `.lore/`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { DecisionService } from "../../../src/service/decision-service.js";
import type { DecisionLogRow } from "../../../src/store/decision-log.js";
import { runDecideFlow } from "../../../src/adapters/cli/decide-flow.js";
import type { HumanChannelPorts } from "../../../src/service/human-channel.js";
import { scriptedHumanPorts } from "./scripted-human-ports.js";
import { actedStore } from "../../live-invocation.js";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

export interface Corpus {
  readonly dir: string;
  readonly dbPath: string;
}

export interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const created: string[] = [];

/** Removes every corpus this module created (call from afterAll). */
export function removeCorpora(): void {
  for (const dir of created.splice(0)) if (dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
}

function cleanEnv(dir: string): Record<string, string> {
  return { PATH: process.env["PATH"] ?? "", HOME: dir, EDITOR: "true" };
}

/** The real CLI inside the corpus (cwd and HOME in the temp tree). */
export function lore(corpus: Corpus, args: string[]): Run {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd: corpus.dir, env: cleanEnv(corpus.dir), encoding: "utf8", timeout: 90_000 });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? -1 };
}

/** A fresh throwaway corpus with the governed threshold record seeded (`lore autonomy show`). */
export function newCorpus(prefix: string): Corpus {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  const corpus: Corpus = { dir, dbPath: join(dir, ".lore", "lore.db") };
  const init = lore(corpus, ["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  const shown = lore(corpus, ["autonomy", "show"]);
  if (shown.exitCode !== 0) throw new Error(`lore autonomy show failed: ${shown.stderr}`);
  return corpus;
}

export async function withService<T>(corpus: Corpus, fn: (service: DecisionService) => Promise<T>): Promise<T> {
  const store = actedStore(new SQLiteStore(corpus.dbPath));
  try {
    return await fn(new DecisionService({ store, executorRun: null }));
  } finally {
    store.close();
  }
}

/** Facts that make every non-C factor of a normal class clear its threshold (R 0.9, B 1, E 1). */
export const AUTO_FACTS = { recoverability: "loss-free-by-proof", blast: "own-or-ended-run", evidence: "lore-evaluated" } as const;

/** Appends `count` decisions of `classId` (distinct subjects `<prefix>-<i>`); returns their record ids and verdicts. */
export async function seedDecisions(
  corpus: Corpus,
  classId: string,
  count: number,
  prefix = "subject",
): Promise<{ ids: number[]; verdicts: string[]; confidences: number[] }> {
  return withService(corpus, async (service) => {
    const ids: number[] = [];
    const verdicts: string[] = [];
    const confidences: number[] = [];
    for (let i = 1; i <= count; i++) {
      const out = await service.decide(classId, { id: `${prefix}-${i}`, version: "v1" }, AUTO_FACTS);
      if (!out.ok) throw new Error(`decide failed: ${JSON.stringify(out.error)}`);
      ids.push(out.value.record_id);
      verdicts.push(out.value.effective.verdict);
      confidences.push(out.value.decision.factors.C);
    }
    return { ids, verdicts, confidences };
  });
}

/** Records an observed reversal of decision `id` (lore's own observer path). */
export async function observeReversal(corpus: Corpus, id: number): Promise<void> {
  await withService(corpus, async (service) => {
    const r = await service.calibration().recordObserved(id, "reversed", "merge-reverted", "test reversal");
    if (!r.ok) throw new Error(`recordObserved failed: ${JSON.stringify(r.error)}`);
  });
}

export async function readLog(corpus: Corpus): Promise<DecisionLogRow[]> {
  return withService(corpus, async (service) => {
    const rows = await service.chainRows();
    if (!rows.ok) throw new Error("chainRows failed");
    return rows.value;
  });
}

export interface DecideRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The real `lore decide` flow in-process with scripted human-channel ports (a clean human by default). */
export async function runDecide(corpus: Corpus, id: number, answer: "accept" | "reject", ports: HumanChannelPorts = scriptedHumanPorts()): Promise<DecideRun> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runDecideFlow(
    { dbPath: corpus.dbPath, id: String(id), accept: answer === "accept", reject: answer === "reject" },
    ports,
    { stdout: (t) => void out.push(t), stderr: (t) => void err.push(t) },
  );
  return { code, stdout: out.join(""), stderr: err.join("") };
}
