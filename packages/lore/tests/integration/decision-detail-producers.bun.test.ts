// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/**
/**
 * AC-HR-1 oracle — every escalating producer records a readable detail (this file: the governance-loosen rows; the
 * table below is the extension point, one row per class).
 *
 * Real CLI (`bun run src/index.ts`) in THROWAWAY corpora (mkdtemp + `lore init`, cwd and HOME inside the temp tree);
 * the stored detail is read straight from the corpus database.
 *
 * @spec_ref AC-HR-1
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { decisionDetailSchema, type DecisionDetail } from "../../src/store/decision-log.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const HEX_RUN_40 = /[0-9a-fA-F]{40,}/;

const created: string[] = [];
afterAll(() => {
  for (const dir of created) if (dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
});

interface Corpus {
  readonly dir: string;
  readonly dbPath: string;
}

function lore(corpus: Corpus, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: corpus.dir,
    env: { PATH: process.env["PATH"] ?? "", HOME: corpus.dir, EDITOR: "true" },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? -1 };
}

function newCorpus(): Corpus {
  const dir = mkdtempSync(join(tmpdir(), "lore-hr1-"));
  created.push(dir);
  const corpus: Corpus = { dir, dbPath: join(dir, ".lore", "lore.db") };
  const init = lore(corpus, ["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  const shown = lore(corpus, ["autonomy", "show"]);
  if (shown.exitCode !== 0) throw new Error(`lore autonomy show failed: ${shown.stderr}`);
  return corpus;
}

/** The latest stored detail of `cls`, parsed, or null when the row has none. */
function latestDetail(corpus: Corpus, cls: string): { raw: string | null; detail: DecisionDetail | null; verdict: string } {
  const db = new Database(corpus.dbPath);
  try {
    const row = db.query("SELECT detail, verdict FROM decision_log WHERE class = ? ORDER BY id DESC LIMIT 1").get(cls) as { detail: string | null; verdict: string } | null;
    if (row === null) throw new Error(`no decision_log row for class ${cls}`);
    return { raw: row.detail, detail: row.detail === null ? null : decisionDetailSchema.parse(JSON.parse(row.detail)), verdict: row.verdict };
  } finally {
    db.close();
  }
}

interface ProducerRow {
  readonly cls: string;
  readonly label: string;
  /** Drives the producer to an escalate verdict. */
  readonly drive: (corpus: Corpus) => void;
  /** The words the summary must contain (the subject). */
  readonly summaryWords: readonly string[];
  /** Class-specific assertions over `change`. */
  readonly checkChange: (change: Record<string, unknown>) => void;
}

const PRODUCERS: readonly ProducerRow[] = [
  {
    cls: "governance-loosen",
    label: "lore autonomy regenerable add",
    drive: (corpus) => {
      const r = lore(corpus, ["autonomy", "regenerable", "add", ".cache-hr1/"]);
      expect(r.exitCode, r.stderr).not.toBe(1);
    },
    summaryWords: [".cache-hr1/"],
    checkChange: (change) => {
      expect(change["entry"]).toBe("worktreeRemoveRegenerable");
      const before = (change["before"] as Record<string, string[]>)["worktreeRemoveRegenerable"];
      const after = (change["after"] as Record<string, string[]>)["worktreeRemoveRegenerable"];
      expect(before).not.toContain(".cache-hr1/");
      expect(after).toContain(".cache-hr1/");
      expect(after).toEqual([...(before as string[]), ".cache-hr1/"]);
    },
  },
  {
    cls: "governance-loosen",
    label: "lore autonomy set (threshold loosening)",
    drive: (corpus) => {
      const r = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.5"]);
      expect(r.exitCode, r.stderr).not.toBe(1);
    },
    summaryWords: ["stash-drop", "threshold"],
    checkChange: (change) => {
      expect(change["entry"]).toBe("stash-drop");
      const before = (change["before"] as Record<string, { threshold: number }>)["stash-drop"];
      const after = (change["after"] as Record<string, { threshold: number }>)["stash-drop"];
      expect(before?.threshold).toBe(0.8);
      expect(after?.threshold).toBe(0.5);
    },
  },
];

describe("decision detail producers", () => {
  it.each(PRODUCERS.map((p) => [p.label, p] as const))("AC-HR-1: %s escalates with a complete, readable detail", (_label, producer) => {
    const corpus = newCorpus();
    producer.drive(corpus);
    const { raw, detail, verdict } = latestDetail(corpus, producer.cls);
    expect(verdict, `class ${producer.cls} must have escalated`).toBe("escalate");
    expect(raw, `class ${producer.cls} wrote no detail`).not.toBeNull();
    if (detail === null) return;
    for (const field of ["summary", "requested_by", "on_accept", "on_reject"] as const) {
      expect(detail[field].trim().length, `${producer.cls}.${field} is empty`).toBeGreaterThan(0);
      expect(HEX_RUN_40.test(detail[field]), `${producer.cls}.${field} holds a hash-like run`).toBe(false);
    }
    for (const word of producer.summaryWords) expect(detail.summary, `${producer.cls} summary names the subject`).toContain(word);
    expect(Object.keys(detail.change)).toEqual(expect.arrayContaining(["entry", "before", "after"]));
    producer.checkChange(detail.change);
  }, 120_000);
});
