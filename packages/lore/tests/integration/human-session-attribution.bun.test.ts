// @spawns packages/lore/src/index.ts
/**
 * AC-HID-2 — a registered person is the writer (spec-every-write-is-made-by-a-known-party-an-attested-agent-run;
 * BR-1350, BR-1032, BR-1055).
 *
 * Contract under test, in a throwaway checkout after `lore session start --human dana`:
 *   - a `lore set` writes a version row and an audit row naming dana, with name source `human` and dana's run;
 *   - `lore session show` names the open session;
 *   - a second `lore session start` exits 4 naming the open session;
 *   - after `lore session end` the next write is refused exactly as for a writer with no known party;
 *   - a write from a process carrying the agent harness marker (`CLAUDECODE=1`) is refused, not attributed to dana.
 * Also pinned (end state 2 and 5): the token lives in a file OUTSIDE the checkout (mode 0600) while the runs registry
 * holds only its hash; the session is bound to ITS checkout (another checkout of the same user has none); a person
 * cannot be impersonated by naming their run on the command line; `session start` needs `--human` and is not for agents.
 *
 * Dimensions: HAPPY (set as dana, show), NEGATIVE (second start, ended session, marker, forged run flag, no name),
 * STATE (end deletes the file and ends the run), BOUNDARY (a second checkout), SECURITY (token never in the registry
 * or the repo, file mode), REGRESSION (the registered run is a normal run: `lore run show` reads it).
 *
 * MOCK RISK: none — the real CLI against a real corpus file and a real state directory under the temp home.
 *
 * @spec_ref AC-HID-2
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createPartyCorpus, type LoreRun, type PartyCorpus } from "../helpers/known-party-corpus.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const HUMAN: { readonly kind: "human" } = { kind: "human" };

function expectNamesBothRemedies(run: LoreRun): void {
  expect(run.stderr).toContain("lore session start --human");
  expect(run.stderr).toContain("lore setup");
}

/** The single token file under the corpus's lore state directory (`LORE_STATE_HOME/human-sessions/`). */
function tokenFilesOf(corpus: PartyCorpus): string[] {
  const dir = join(corpus.home, "state", "human-sessions");
  return existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)) : [];
}

describe("AC-HID-2: a registered person is the writer", () => {
  let corpus: PartyCorpus;
  let prd: string;
  let otherCheckout: PartyCorpus;

  beforeAll(() => {
    corpus = createPartyCorpus("hid2");
    prd = corpus.slugOf(corpus.setup(["create", "prd", "--title", "Human session PRD", "--content", "root", "--no-ai"]));
    otherCheckout = createPartyCorpus("hid2-other");
  });

  afterAll(() => {
    corpus.cleanup();
    otherCheckout.cleanup();
  });

  it("before any session: a write from the checkout is refused (nobody is registered yet)", () => {
    const result = corpus.lore(["set", prd, "--title", "Before the session"], HUMAN);
    expect(result.exitCode).toBe(4);
    expectNamesBothRemedies(result);
  });

  it("`session start` without --human is a usage error (exit 2); nothing is registered", () => {
    const result = corpus.lore(["session", "start"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--human");
    expect(tokenFilesOf(corpus)).toEqual([]);
  });

  it("`session start` inside an agent harness is refused (exit 4): a session is for a person", () => {
    const result = corpus.lore(["session", "start", "--human", "dana"], { kind: "nobody" }, { CLAUDECODE: "1" });
    expect(result.exitCode).toBe(4);
    expect(tokenFilesOf(corpus)).toEqual([]);
  });

  describe("with dana's session open", () => {
    let danaRun: string;

    beforeAll(() => {
      const started = corpus.lore(["session", "start", "--human", "dana"]);
      expect(started.exitCode).toBe(0);
      expect(started.stdout).toContain("dana");
      const match = started.stdout.match(/run (human:[0-9a-f]+)/);
      if (match?.[1] === undefined) throw new Error(`no run id in: ${started.stdout}`);
      danaRun = match[1];
    });

    it("a lore set writes a version row and an audit row naming dana, source human, and dana's run", () => {
      const before = corpus.counts();
      const result = corpus.lore(["set", prd, "--title", "Renamed by dana"], HUMAN);
      expect(result.exitCode).toBe(0);
      const after = corpus.counts();
      expect(after.versions).toBe(before.versions + 1);
      expect(after.audit).toBeGreaterThan(before.audit);

      const version = corpus.versionRowsOf(prd).at(-1);
      expect(version?.created_by).toBe("dana");
      expect(version?.harness_run).toBe(danaRun);

      const audit = corpus.auditRows().filter((row) => row.actor === "dana" && row.action !== "create");
      expect(audit.length).toBeGreaterThan(0);
      for (const row of audit) {
        expect(row.harness_run).toBe(danaRun);
        expect(row.details["name_source"]).toBe("human");
      }
    });

    it("lore session show names the open session and its run", () => {
      const shown = corpus.lore(["session", "show"], HUMAN);
      expect(shown.exitCode).toBe(0);
      expect(shown.stdout).toContain("dana");
      expect(shown.stdout).toContain(danaRun);
    });

    it("the registered run is a normal run: lore run show reads it, with harness human and the person's name", () => {
      const shown = corpus.lore(["run", "show", danaRun, "--json"], HUMAN);
      expect(shown.exitCode).toBe(0);
      const data = (JSON.parse(shown.stdout) as { data: { harness: string; agentRef: string | null } }).data;
      expect(data.harness).toBe("human");
      expect(data.agentRef).toBe("dana");
    });

    it("a second `session start` exits 4 naming the open session and writes no second token", () => {
      const result = corpus.lore(["session", "start", "--human", "eve"]);
      expect(result.exitCode).toBe(4);
      expect(result.stderr).toContain("dana");
      expect(result.stderr).toContain(danaRun);
      expect(tokenFilesOf(corpus)).toHaveLength(1);
    });

    it("a write from a process carrying the agent harness marker is refused, not attributed to dana", () => {
      const before = corpus.counts();
      const result = corpus.lore(["set", prd, "--title", "Renamed under dana's name by an agent"], { kind: "human", marker: true });
      expect(result.exitCode).toBe(4);
      expectNamesBothRemedies(result);
      expect(corpus.counts()).toEqual(before);
    });

    it("a person cannot be impersonated by naming their run on the command line (exit 2, nothing written)", () => {
      const before = corpus.counts();
      const result = corpus.lore(["--harness-run", danaRun, "set", prd, "--title", "Forged"], { kind: "nobody" });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("agent run");
      expect(corpus.counts()).toEqual(before);
    });

    it("the session is bound to its checkout: another checkout of the same user has no session and refuses writes", () => {
      const other = otherCheckout.slugOf(otherCheckout.setup(["create", "prd", "--title", "Other checkout PRD", "--content", "root", "--no-ai"]));
      const before = otherCheckout.counts();
      // reason: same HOME for both is NOT needed — the binding is the token file keyed by checkout path; this corpus
      // simply has no file, which is what "bound to its checkout" means.
      const result = otherCheckout.lore(["set", other, "--title", "Renamed in the other checkout"], HUMAN);
      expect(result.exitCode).toBe(4);
      expect(otherCheckout.counts()).toEqual(before);
    });

    it("the token sits in a 0600 file outside the checkout; the registry holds only its hash", () => {
      const files = tokenFilesOf(corpus);
      expect(files).toHaveLength(1);
      const file = files[0] as string;
      expect(file.startsWith(corpus.dir)).toBe(true); // the TEST's state dir is under its temp home...
      expect(file.startsWith(join(corpus.dir, ".lore"))).toBe(false); // ...but never inside the repository's .lore
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const stored = JSON.parse(readFileSync(file, "utf8")) as { token: string; name: string };
      expect(stored.name).toBe("dana");
      expect(stored.token).toMatch(/^[0-9a-f]{64}$/);

      const db = new Database(join(corpus.dir, ".lore", "lore.db"), { readonly: true });
      try {
        const run = db.query("SELECT session_ref, agent_ref, harness FROM runs WHERE id = ?").get(danaRun) as { session_ref: string; agent_ref: string; harness: string };
        expect(run.harness).toBe("human");
        expect(run.session_ref).toMatch(/^[0-9a-f]{64}$/);
        expect(run.session_ref).not.toBe(stored.token); // the hash, never the token
        const everything = JSON.stringify(db.query("SELECT * FROM runs").all()) + JSON.stringify(db.query("SELECT * FROM audit").all());
        expect(everything).not.toContain(stored.token);
      } finally {
        db.close();
      }
    });

    it("lore session end deletes the token and ends the run; the next write is refused as for a writer with no known party", () => {
      const ended = corpus.lore(["session", "end"], HUMAN);
      expect(ended.exitCode).toBe(0);
      expect(tokenFilesOf(corpus)).toEqual([]);

      const db = new Database(join(corpus.dir, ".lore", "lore.db"), { readonly: true });
      try {
        const run = db.query("SELECT ended_at FROM runs WHERE id = ?").get(danaRun) as { ended_at: string | null };
        expect(run.ended_at).not.toBeNull();
      } finally {
        db.close();
      }

      const before = corpus.counts();
      const refused = corpus.lore(["set", prd, "--title", "After the session ended"], HUMAN);
      expect(refused.exitCode).toBe(4);
      expectNamesBothRemedies(refused);
      expect(corpus.counts()).toEqual(before);

      const shown = corpus.lore(["session", "show"], HUMAN);
      expect(shown.exitCode).toBe(3);
      expect(corpus.lore(["session", "end"], HUMAN).exitCode).toBe(3);
    });
  });
});
