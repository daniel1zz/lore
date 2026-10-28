// @spawns packages/lore/src/index.ts
/**
 * AC-DR-6 — file premises are quoted and pinned by lore at write time, not by the writer.
 * (spec-a-decision-carrying-write-records-its-decision-on-its, "The decision payload" and D9; BR-1476)
 *
 * Contract under test, with the real CLI, a real git repository (the corpus's own directory, `git init`) and a real
 * decision-carrying write (an agent's correction of an approved ADR):
 *   - a file premise's named lines are stored as `quote`, the text lore read, not anything the writer typed;
 *   - a premise with no `@sha` is stamped with HEAD; one with `@sha` is quoted at THAT commit, not at HEAD;
 *   - a file with uncommitted changes (or untracked) and no `@sha` exits 4 naming the file, and writes no version;
 *   - lines absent at the commit (past the end of the file, or the file absent there) exit 4, and write no version.
 *
 * Dimensions: HAPPY (quote + HEAD stamp, older sha), NEGATIVE (dirty, untracked, absent lines, absent file, unknown sha),
 * BOUNDARY (last line, one past it, a one-line range), STATE (no version row on any refusal), REGRESSION (a dirty file is
 * fine once a sha pins it).
 *
 * MOCK RISK: none — `git` and `lore` are real processes against files under the OS temp directory.
 *
 * @spec_ref AC-DR-6
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPartyCorpus, type Party, type PartyCorpus } from "../../helpers/known-party-corpus.js";

import { ensureRequirementsDocSlug } from "../../helpers/parented-create.js";
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const AGENT: Party = { kind: "run", run: "cc:dr6-agent" };
const V1 = ["export const ttl = 60000;", "export const retries = 3;", "export const name = 'registry';"];
const V2 = ["export const ttl = 180000;", "export const retries = 3;", "export const name = 'registry';", "export const extra = true;"];

interface StoredSource {
  kind: string;
  path: string;
  lines: [number, number];
  sha: string;
  quote: string;
}

describe("AC-DR-6: file premises are quoted and pinned at write time", () => {
  let corpus: PartyCorpus;
  let adr: string;
  let firstSha: string;
  let secondSha: string;
  let weightTable: string;
  let weightTableVersion: number;

  const git = (...args: string[]): string => {
    const proc = Bun.spawnSync(["git", "-c", "user.name=dr6", "-c", "user.email=dr6@example.invalid", ...args], { cwd: corpus.dir });
    if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
    return proc.stdout.toString().trim();
  };
  const writeRegistry = (lines: readonly string[]): void => writeFileSync(join(corpus.dir, "src", "registry.ts"), `${lines.join("\n")}\n`);

  const versionCount = (): number => {
    const db = new Database(join(corpus.dir, ".lore", "lore.db"), { readonly: true });
    try {
      return (db.query("SELECT COUNT(*) AS n FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ?").get(adr) as { n: number }).n;
    } finally {
      db.close();
    }
  };

  /** The file source of the latest version's first premise. */
  const storedSource = (): StoredSource => {
    const db = new Database(join(corpus.dir, ".lore", "lore.db"), { readonly: true });
    try {
      const row = db
        .query("SELECT v.decision AS decision FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ? ORDER BY v.version DESC LIMIT 1")
        .get(adr) as { decision: string | null };
      const decision = JSON.parse(row.decision as string) as { premises: { source: StoredSource }[] };
      return decision.premises[0]?.source as StoredSource;
    } finally {
      db.close();
    }
  };

  let writes = 0;
  /** A decision-carrying correction of the ADR citing `source` as its premise (each call writes distinct content). */
  const correctWith = (source: string, tier = "S") => {
    writes += 1;
    return corpus.lore(
      ["set", adr, "--content", `# Decision\n\nrevision ${writes}`, "--correction", "typo", "--reason", "the constant moved", "--premise", `the ttl is stated here|${source}|${tier}`, "--alt", "leave it|the record would stay wrong"],
      AGENT,
    );
  };

  beforeAll(() => {
    corpus = createPartyCorpus("dr6");
    adr = corpus.slugOf(corpus.setup(["create", "adr", "--parent", ensureRequirementsDocSlug((a) => corpus.setup(a)), "--title", "DR6 ADR", "--decision-status", "accepted", "--no-ai", "--content", "# Decision\n\nbody"]));
    const db = new Database(join(corpus.dir, ".lore", "lore.db"));
    try {
      db.query("UPDATE docs SET status = 'approved' WHERE slug = ?").run(adr);
    } finally {
      db.close();
    }
    // reason: BR-1482 — a decision's scores must cite the approved weight table of the command's kind (`document revision`
    // for `lore set`); the table is approved directly in the corpus file, as the ADR above is.
    weightTable = corpus.slugOf(corpus.setup(["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => corpus.setup(a)), "--sub-type", "reference", "--title", "DR6 weights", "--no-ai", "--content", "# Weights\n\nbody"]));
    corpus.setup(["weights", "set", weightTable, "--kind", "document revision", "--dimension", "cost=1"]);
    const tableDb = new Database(join(corpus.dir, ".lore", "lore.db"));
    try {
      tableDb.query("UPDATE docs SET status = 'approved' WHERE slug = ?").run(weightTable);
      weightTableVersion = (tableDb.query("SELECT version FROM docs WHERE slug = ?").get(weightTable) as { version: number }).version;
    } finally {
      tableDb.close();
    }
    git("init", "-q");
    mkdirSync(join(corpus.dir, "src"), { recursive: true });
    writeRegistry(V1);
    git("add", "src/registry.ts");
    git("commit", "-q", "-m", "first");
    firstSha = git("rev-parse", "HEAD");
    writeRegistry(V2);
    git("add", "src/registry.ts");
    git("commit", "-q", "-m", "second");
    secondSha = git("rev-parse", "HEAD");
  });

  afterAll(() => corpus.cleanup());

  it("stores the named lines' text as the quote, and stamps HEAD when no @sha is given", () => {
    const run = correctWith("file:src/registry.ts:1-2");
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    const source = storedSource();
    expect(source).toEqual({ kind: "file", path: "src/registry.ts", lines: [1, 2], sha: secondSha, quote: `${V2[0]}\n${V2[1]}` });
  });

  it("quotes at the named commit, not at HEAD", () => {
    const run = correctWith(`file:src/registry.ts:1@${firstSha}`);
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    const source = storedSource();
    expect(source.sha).toBe(firstSha);
    expect(source.quote).toBe(V1[0]);
    expect(source.quote).not.toBe(V2[0]);
  });

  it("BOUNDARY: the last line is quotable; one past the end exits 4 and writes no version", () => {
    const last = correctWith("file:src/registry.ts:4");
    expect(last.exitCode, `${last.stdout}${last.stderr}`).toBe(0);
    expect(storedSource().quote).toBe(V2[3]);

    const before = versionCount();
    const past = correctWith("file:src/registry.ts:4-5");
    expect(past.exitCode).toBe(4);
    expect(past.stderr).toContain("absent");
    expect(past.stderr).toContain("src/registry.ts");
    expect(versionCount()).toBe(before);
  });

  it("lines that do not exist at the named commit exit 4 (the file has 3 lines there), and write no version", () => {
    const before = versionCount();
    const run = correctWith(`file:src/registry.ts:4@${firstSha}`);
    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain("absent");
    expect(versionCount()).toBe(before);
  });

  it("a file that does not exist at the commit exits 4 naming it, and writes no version", () => {
    const before = versionCount();
    const run = correctWith("file:src/never-existed.ts:1");
    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain("does not exist");
    expect(run.stderr).toContain("src/never-existed.ts");
    expect(versionCount()).toBe(before);
  });

  it("an unknown commit exits 4 as lines absent there", () => {
    const before = versionCount();
    const run = correctWith(`file:src/registry.ts:1@${"1".repeat(40)}`);
    expect(run.exitCode).toBe(4);
    expect(versionCount()).toBe(before);
  });

  describe("a file with uncommitted changes", () => {
    beforeAll(() => writeRegistry(["export const ttl = 1;", ...V2.slice(1)]));
    afterAll(() => {
      git("checkout", "-q", "--", "src/registry.ts");
    });

    it("and no @sha exits 4 naming the file and the way out; no version is written", () => {
      const before = versionCount();
      const run = correctWith("file:src/registry.ts:1");
      expect(run.exitCode).toBe(4);
      expect(run.stderr).toContain("uncommitted");
      expect(run.stderr).toContain("src/registry.ts");
      expect(run.stderr).toContain("@<sha>");
      expect(versionCount()).toBe(before);
    });

    it("is fine once a sha pins the premise: the quote is the committed text, not the working copy", () => {
      const run = correctWith(`file:src/registry.ts:1@${secondSha}`);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(storedSource().quote).toBe(V2[0]);
    });
  });

  it("an untracked file and no @sha exits 4 (HEAD does not hold what the writer read)", () => {
    writeFileSync(join(corpus.dir, "src", "untracked.ts"), "const x = 1;\n");
    const before = versionCount();
    const run = correctWith("file:src/untracked.ts:1");
    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain("uncommitted");
    expect(versionCount()).toBe(before);
  });

  describe("gate and score evidence that is a file source", () => {
    interface StoredDecision {
      gates?: { evidence: string; evidence_source?: StoredSource }[];
      scores?: { evidence: string; evidence_source?: StoredSource }[];
    }
    const storedDecision = (): StoredDecision => {
      const db = new Database(join(corpus.dir, ".lore", "lore.db"), { readonly: true });
      try {
        const row = db
          .query("SELECT v.decision AS decision FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ? ORDER BY v.version DESC LIMIT 1")
          .get(adr) as { decision: string };
        return JSON.parse(row.decision) as StoredDecision;
      } finally {
        db.close();
      }
    };
    const correctWithEvidence = (gate: string, score?: string) => {
      writes += 1;
      return corpus.lore(
        [
          "set", adr, "--content", `# Decision\n\nrevision ${writes}`, "--correction", "typo", "--reason", "the constant moved",
          "--premise", "the ttl is stated|issue:#41|A", "--alt", "leave it|the record would stay wrong", "--gate", gate,
          ...(score !== undefined ? ["--score", score, "--weight-table", `${weightTable}@${weightTableVersion}`] : []),
        ],
        AGENT,
      );
    };

    it("a gate's file evidence is quoted and pinned to HEAD like a premise; the typed text is kept", () => {
      const run = correctWithEvidence("meaning-unchanged|pass|file:src/registry.ts:2-3");
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      const gate = storedDecision().gates?.[0];
      expect(gate?.evidence).toBe("file:src/registry.ts:2-3");
      expect(gate?.evidence_source).toEqual({ kind: "file", path: "src/registry.ts", lines: [2, 3], sha: secondSha, quote: `${V2[1]}\n${V2[2]}` });
    });

    it("a score's file evidence at a named commit is quoted at that commit", () => {
      const run = correctWithEvidence("meaning-unchanged|pass|prose evidence", `A|cost|1|file:src/registry.ts:1@${firstSha}`);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(storedDecision().scores?.[0]?.evidence_source).toMatchObject({ sha: firstSha, quote: V1[0] });
    });

    it("plain-prose evidence stays unquoted", () => {
      const run = correctWithEvidence("meaning-unchanged|pass|the words are the same");
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(storedDecision().gates?.[0]?.evidence_source).toBeUndefined();
    });

    it("gate evidence naming lines absent at the commit exits 4 and writes no version", () => {
      const before = versionCount();
      const run = correctWithEvidence("meaning-unchanged|pass|file:src/registry.ts:40-41");
      expect(run.exitCode).toBe(4);
      expect(run.stderr).toContain("gate");
      expect(run.stderr).toContain("absent");
      expect(versionCount()).toBe(before);
    });

    it("gate evidence naming an untracked file and no sha exits 4, and writes no version", () => {
      writeFileSync(join(corpus.dir, "src", "evidence-untracked.ts"), "const y = 2;\n");
      const before = versionCount();
      const run = correctWithEvidence("meaning-unchanged|pass|file:src/evidence-untracked.ts:1");
      expect(run.exitCode).toBe(4);
      expect(run.stderr).toContain("uncommitted");
      expect(versionCount()).toBe(before);
    });
  });

  it("a premise whose source is not a file is stored as typed (no quote is invented)", () => {
    const run = correctWith("issue:#41", "A");
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    expect(storedSource()).toEqual({ kind: "issue", number: 41 } as unknown as StoredSource);
  });
});
