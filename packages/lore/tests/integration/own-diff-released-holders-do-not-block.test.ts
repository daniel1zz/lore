// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end;
 *   business rule BR-1346 (a hold blocks only while its holder is CLAIMED, i.e. editing).
 *
 * Throwaway repo + corpus, real `lore` subprocesses (helpers/own-diff-fixture.ts); never the repo's own `.lore/`.
 *
 * Coverage: (1) HAPPY two released branches changing one file land in order (first exits 0, the second lands after it
 * merges main); (2) NEGATIVE a still-CLAIMED holder with an overlapping anchor refuses with exit 4 naming path and
 * task; (3) STATE the judgment verdict lists a released, unlanded holder whose anchor overlapped (informational).
 */
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { OwnDiffJudgment } from "../../src/service/own-diff-judgment.js";
import { OwnDiffFixture, ownDiffFixtureEnv } from "../helpers/own-diff-fixture.js";

const PAD = Array.from({ length: 12 }, (_, i) => `// pad ${i}`).join("\n");
const shared = (a: number, b: number): string => `export const first = ${a};\n${PAD}\nexport const second = ${b};\n`;

let fx: OwnDiffFixture | undefined;
const branchOf = new Map<string, string>();

afterEach(() => {
  fx?.dispose();
  fx = undefined;
  branchOf.clear();
});

function claimOn(f: OwnDiffFixture, task: string, branch: string): void {
  branchOf.set(task, branch);
  f.claim(task, branch);
}

/** Releases `task` as the session that claimed it (the fixture's per-branch session id; its accessor is private). */
function release(f: OwnDiffFixture, task: string): void {
  const branch = branchOf.get(task) as string;
  const env = (f as unknown as { sessionEnvOf(b: string): Record<string, string> }).sessionEnvOf(branch);
  f.mustLore(["release", task], env);
}

describe("BR-1346 — a released holder never blocks another branch's landing", () => {
  it("(1) two released branches changing one file land in order; the second lands after merging main", () => {
    const f = new OwnDiffFixture();
    fx = f;
    f.commitOnMain({ "src/shared.ts": shared(1, 1) }, "base");
    const t1 = f.createTask("R1", ["src/shared.ts"]);
    const t2 = f.createTask("R2", ["src/shared.ts"]);
    f.makeBranch("rel-1", { "src/shared.ts": shared(10, 1) });
    f.makeBranch("rel-2", { "src/shared.ts": shared(1, 20) });
    // sequential, as real sessions work: the claim gate itself refuses a second claim while the first is held
    claimOn(f, t1, "rel-1");
    release(f, t1);
    claimOn(f, t2, "rel-2");
    release(f, t2);

    const first = f.integrate("rel-1");
    expect(first.exitCode, first.text).toBe(0);

    f.mergeIntoBranch("rel-2", "main");
    const second = f.integrate("rel-2");
    expect(second.exitCode, second.text).toBe(0);
  }, 300_000);

  it("(2) a still-claimed holder with an overlapping anchor refuses with exit 4 naming path and task", () => {
    const f = new OwnDiffFixture();
    fx = f;
    f.commitOnMain({ "src/shared.ts": shared(1, 1) }, "base");
    const holder = f.createTask("Holder", ["src/shared.ts"]);
    const mine = f.createTask("Mine", ["src/other.ts"]);
    f.makeBranch("holder-b", { "h.txt": "h\n" });
    f.makeBranch("mine-b", { "src/shared.ts": shared(5, 1) });
    claimOn(f, holder, "holder-b");
    claimOn(f, mine, "mine-b");

    const refused = f.integrate("mine-b");

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("BR-1346");
    expect(refused.stderr).toContain("src/shared.ts");
    expect(refused.stderr).toContain(holder);
  }, 300_000);

  it("(2b) a claimed holder's directory anchor holds only the files its branch changed", () => {
    const f = new OwnDiffFixture();
    fx = f;
    f.commitOnMain({ "packages/x/a.ts": "export const a = 1;\n", "packages/x/b.ts": "export const b = 1;\n" }, "base");
    const holder = f.createTask("DirHolder", ["packages/x/"]);
    const onB = f.createTask("OnB", ["src/ob.ts"]);
    const onA = f.createTask("OnA", ["src/oa.ts"]);
    f.makeBranch("dir-holder", { "packages/x/a.ts": "export const a = 2;\n" });
    f.makeBranch("touch-b", { "packages/x/b.ts": "export const b = 2;\n" });
    f.makeBranch("touch-a", { "packages/x/a.ts": "export const a = 3;\n" });
    claimOn(f, holder, "dir-holder");
    claimOn(f, onB, "touch-b");
    claimOn(f, onA, "touch-a");

    const free = f.integrate("touch-b");
    expect(free.exitCode, free.text).toBe(0);

    const refused = f.integrate("touch-a");
    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("packages/x/a.ts");
    expect(refused.stderr).toContain(holder);
  }, 300_000);

  it("(3) the verdict lists a released, unlanded holder whose anchor overlapped, and does not refuse", async () => {
    const f = new OwnDiffFixture();
    fx = f;
    f.commitOnMain({ "src/shared.ts": shared(1, 1) }, "base");
    f.makeBranch("mine-b", { "src/shared.ts": shared(5, 1) });
    f.makeBranch("other-b", { "o.txt": "o\n" });
    const tip = f.git(["rev-parse", "mine-b"]);
    const judgment = new OwnDiffJudgment({
      git: (cwd, args) => {
        try {
          return { status: 0, stdout: execFileSync("git", [...args], { cwd, env: ownDiffFixtureEnv(), stdio: ["ignore", "pipe", "pipe"] }).toString(), stderr: "" };
        } catch (e) {
          const x = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
          return { status: x.status ?? 1, stdout: x.stdout?.toString() ?? "", stderr: x.stderr?.toString() ?? "" };
        }
      },
      projectRoot: f.dir,
      ownership: {
        read: async () => ({
          ok: true as const,
          value: {
            own: [{ slug: "mine", anchors: ["src/other.ts"] }],
            others: [{ slug: "released-holder", anchors: ["src/shared.ts"], held: false, claimedBranches: ["other-b"] }],
          },
        }),
      },
      loadCoChangeRules: () => ({ measured: true, rules: [] }),
      matchesGlob: () => false,
    });

    const verdict = await judgment.judge("mine-b", tip);

    expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.value.unlanded_overlaps).toEqual([{ task: "released-holder", branch: "other-b", paths: ["src/shared.ts"] }]);
  }, 300_000);

  it("(4) a claimed holder whose branch cannot be measured holds the whole directory and is named unmeasured", async () => {
    const f = new OwnDiffFixture();
    fx = f;
    f.commitOnMain({ "src/shared.ts": shared(1, 1) }, "base");
    f.makeBranch("mine-b", { "src/shared.ts": shared(5, 1) });
    const tip = f.git(["rev-parse", "mine-b"]);
    const judgment = new OwnDiffJudgment({
      git: (cwd, args) => {
        try {
          return { status: 0, stdout: execFileSync("git", [...args], { cwd, env: ownDiffFixtureEnv(), stdio: ["ignore", "pipe", "pipe"] }).toString(), stderr: "" };
        } catch (e) {
          const x = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
          return { status: x.status ?? 1, stdout: x.stdout?.toString() ?? "", stderr: x.stderr?.toString() ?? "" };
        }
      },
      projectRoot: f.dir,
      ownership: {
        read: async () => ({
          ok: true as const,
          value: {
            own: [{ slug: "mine", anchors: ["src/other.ts"] }],
            others: [{ slug: "ghost-holder", anchors: ["src/"], held: true, claimedBranches: ["no-such-branch"] }],
          },
        }),
      },
      loadCoChangeRules: () => ({ measured: true, rules: [] }),
      matchesGlob: () => false,
    });

    const verdict = await judgment.judge("mine-b", tip);

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(JSON.stringify(verdict.error)).toContain("ghost-holder");
    expect(JSON.stringify(verdict.error)).toContain("unmeasured");
    expect(JSON.stringify(verdict.error)).toContain("src/shared.ts");
  }, 300_000);
});
