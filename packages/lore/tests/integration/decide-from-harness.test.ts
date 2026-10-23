// @spawns assets/hooks/post-ask-decide.mjs
// @spawns assets/hooks/pre-bash-git-safety-gate.mjs
// @spawns packages/lore/src/index.ts
// @reads assets/**
/**
 * AC-ASK-1..3 oracle — a human answers a pending decision in the agent session; lore wrote the question and the
 * PostToolUse hook records the answer (spec-human-decisions-are-asked-in-the-session-and-recorded-by; BR-1374, BR-1375).
 *
 * Everything runs in THROWAWAY corpora (mkdtemp + `lore init`, never the repo's `.lore/`) through the real CLI
 * (`bun run src/index.ts`) and the real shipped hook scripts. The hook finds `lore` on PATH, so a shim that execs the
 * source entry stands in for the installed binary.
 *
 * The payload shape comes from Claude Code's hooks reference (PostToolUse: session_id, cwd, hook_event_name, tool_name,
 * tool_input, tool_response, tool_use_id; AskUserQuestion input `questions[]` with question/header/options[label,
 * description]/multiSelect) and from the tool's recorded result (`answers`: question text -> chosen label).
 *
 * @spec_ref AC-ASK-1
 * @spec_ref AC-ASK-2
 * @spec_ref AC-ASK-3
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lore, newCorpus, readLog, removeCorpora, type Corpus, type Run } from "./fixtures/autonomy-calibration-helpers.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const ASK_HOOK = join(REPO_ROOT, "assets", "hooks", "post-ask-decide.mjs");
const GATE_HOOK = join(REPO_ROOT, "assets", "hooks", "pre-bash-git-safety-gate.mjs");

const shimDirs: string[] = [];
afterAll(() => {
  removeCorpora();
  for (const dir of shimDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Question {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

/** A directory holding a `lore` script that runs the source entry; first on PATH for the hook. */
function loreShimDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-ask-shim-"));
  shimDirs.push(dir);
  const shim = join(dir, "lore");
  writeFileSync(shim, `#!/bin/sh\nexec bun run "${INDEX_TS}" "$@"\n`);
  chmodSync(shim, 0o755);
  return dir;
}

const SHIM = loreShimDir();

function payloadOf(corpus: Corpus, questions: readonly unknown[], answers: Record<string, string>): Record<string, unknown> {
  return {
    session_id: "sess-ask-test",
    cwd: corpus.dir,
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions },
    tool_response: { questions, answers, annotations: {} },
    tool_use_id: "toolu_ask_test",
  };
}

function runAskHook(corpus: Corpus, payload: unknown): Run {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = spawnSync("node", [ASK_HOOK], {
    input,
    encoding: "utf8",
    env: { PATH: `${SHIM}:${process.env["PATH"] ?? ""}`, HOME: corpus.dir, CLAUDE_STATE_BASE_OVERRIDE: join(corpus.dir, "state") },
    timeout: 120_000,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? -1 };
}

function decideFromHarness(corpus: Corpus, payload: unknown, extraArgs: string[] = []): Run {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = spawnSync("bun", ["run", INDEX_TS, "decide", "--from-harness", ...extraArgs], {
    cwd: corpus.dir,
    env: { PATH: process.env["PATH"] ?? "", HOME: corpus.dir, EDITOR: "true" },
    input,
    encoding: "utf8",
    timeout: 90_000,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? -1 };
}

/** `lore autonomy set <class> --threshold <n>` is a loosening: exits 4 and opens a governance-loosen decision. */
function openLoosening(corpus: Corpus, classId: string): number {
  const first = lore(corpus, ["autonomy", "set", classId, "--threshold", "0.5"]);
  expect(first.exitCode, first.stderr).toBe(4);
  const id = Number(/Pending decision (\d+) created/.exec(first.stderr)?.[1]);
  expect(id, first.stderr).toBeGreaterThan(0);
  return id;
}

function loosenAgain(corpus: Corpus, classId: string): Run {
  return lore(corpus, ["autonomy", "set", classId, "--threshold", "0.5"]);
}

function thresholdOf(corpus: Corpus, classId: string): number {
  const shown = lore(corpus, ["autonomy", "show", "--json"]);
  expect(shown.exitCode, shown.stderr).toBe(0);
  const record = (JSON.parse(shown.stdout) as { data: { record: { classes: Record<string, { threshold?: number }> } } }).data.record;
  return record.classes[classId]?.threshold as number;
}

function ask(corpus: Corpus, extraArgs: string[] = []): { questions: Question[]; decision_ids: number[] } {
  const run = lore(corpus, ["pending", "--ask", ...extraArgs]);
  expect(run.exitCode, run.stderr).toBe(0);
  return (JSON.parse(run.stdout) as { data: { questions: Question[]; decision_ids: number[] } }).data;
}

async function humanRows(corpus: Corpus): Promise<number> {
  return (await readLog(corpus)).filter((r) => r.channel === "human-tty").length;
}

function questionOf(asked: { questions: Question[]; decision_ids: number[] }, id: number): Question {
  const found = asked.questions[asked.decision_ids.indexOf(id)];
  if (found === undefined) throw new Error(`no question for decision ${id}`);
  return found;
}

const answerFor = (question: Question, label: string): Record<string, string> => ({ [question.question]: label });

describe("AC-ASK-1 harness records the answer", () => {
  it("lore pending --ask writes AskUserQuestion-ready questions; an Accept answer through the shipped hook records it and the re-run applies", async () => {
    const corpus = newCorpus("lore-ask1-");
    const id = openLoosening(corpus, "stash-drop");
    const asked = ask(corpus, ["--recommend", `${id}=reject:the change is not needed yet`]);

    expect(asked.decision_ids).toEqual([id]);
    const question = questionOf(asked, id);
    expect(question.question).toContain(`Lore decision #${id}`);
    expect(question.question).toMatch(/\[ask [A-Z2-9]{8}\]/);
    expect(question.question).toContain("What:");
    expect(question.options.map((o) => o.label)).toEqual(["Reject (Recommended)", "Accept"]);
    expect(question.options[0]?.description.startsWith("the change is not needed yet")).toBe(true);
    expect(question.options[1]?.description).not.toContain("the change is not needed yet");
    expect(question.multiSelect).toBe(false);
    // the human-facing text points at the in-session path, never at a terminal command
    expect(lore(corpus, ["pending"]).stdout).toContain("lore pending --ask");
    expect(lore(corpus, ["pending"]).stdout).not.toContain("lore decide");

    expect(thresholdOf(corpus, "stash-drop")).toBe(0.8);
    expect(loosenAgain(corpus, "stash-drop").exitCode).toBe(4); // still refused before the answer

    const hook = runAskHook(corpus, payloadOf(corpus, [question], answerFor(question, "Accept")));
    expect(hook.exitCode, hook.stderr).toBe(0);
    expect(hook.stdout).toContain(`decision ${id} accepted`);

    const applied = loosenAgain(corpus, "stash-drop");
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(thresholdOf(corpus, "stash-drop")).toBe(0.5);
    const human = (await readLog(corpus)).filter((r) => r.channel === "human-tty");
    expect(human).toHaveLength(1);
    expect(JSON.parse(human[0]?.facts ?? "{}").human.via).toBe("harness-ask");
  }, 240_000);

  it("a Reject answer records rejected and the re-run stays refused", async () => {
    const corpus = newCorpus("lore-ask1r-");
    const id = openLoosening(corpus, "stash-drop");
    const question = questionOf(ask(corpus), id);

    const hook = runAskHook(corpus, payloadOf(corpus, [question], answerFor(question, "Reject")));
    expect(hook.exitCode, hook.stderr).toBe(0);
    expect(hook.stdout).toContain(`decision ${id} rejected`);

    const again = loosenAgain(corpus, "stash-drop");
    expect(again.exitCode, again.stderr).not.toBe(0); // the same refusal as before the answer (autonomy-tier-retire pins the code family)
    expect(thresholdOf(corpus, "stash-drop")).toBe(0.8);
    const human = (await readLog(corpus)).filter((r) => r.channel === "human-tty");
    expect(human).toHaveLength(1);
    expect(human[0]?.verdict).toBe("refuse");
  }, 240_000);
});

describe("AC-ASK-1 harness records the answer: recommendation order, marker, language", () => {
  it("the recommended option comes first with the language's marker, no boilerplate reject line, no dashboard text, and the hash still verifies", async () => {
    const corpus = newCorpus("lore-ask1m-");
    const id = openLoosening(corpus, "stash-drop");

    const en = questionOf(ask(corpus, ["--recommend", `${id}=accept:it is the change you asked for`]), id);
    expect(en.options.map((o) => o.label)).toEqual(["Accept (Recommended)", "Reject"]);
    expect(en.options[0]?.description.startsWith("it is the change you asked for")).toBe(true);
    expect(en.question).not.toContain("Lore's measured recommendation: reject (human-always");
    expect(en.question).not.toContain("start the dashboard");
    expect(en.question).not.toContain("Details:");

    const zh = questionOf(ask(corpus, ["--recommend", `${id}=accept:这正是你要的改动`, "--lang", "zh"]), id);
    expect(zh.options.map((o) => o.label)).toEqual(["接受（推荐）", "拒绝"]);
    expect(zh.options[0]?.description.startsWith("这正是你要的改动")).toBe(true);
    expect(zh.question).toContain("内容：");
    expect(zh.question).toContain("如果接受：");
    expect(zh.question).toContain("你接受吗？");
    expect(zh.question).not.toContain("What:");
    expect(zh.question).not.toContain("start the dashboard");

    const bad = lore(corpus, ["pending", "--ask", "--lang", "fr"]);
    expect(bad.exitCode).toBe(2);

    // the reordered, labelled question verifies through the hook and records the answer
    const hook = runAskHook(corpus, payloadOf(corpus, [zh], answerFor(zh, "接受（推荐）")));
    expect(hook.exitCode, hook.stderr).toBe(0);
    expect(hook.stdout).toContain(`decision ${id} accepted`);
    expect(loosenAgain(corpus, "stash-drop").exitCode).toBe(0);
    expect(thresholdOf(corpus, "stash-drop")).toBe(0.5);
  }, 240_000);
});

describe("AC-ASK-2 agent cannot forge an answer", () => {
  it("a forged, stale, replayed, foreign or altered question is refused with exit 4 and records nothing; Other, dismissed and non-lore questions leave it pending", async () => {
    const corpus = newCorpus("lore-ask2-");
    const idA = openLoosening(corpus, "stash-drop");
    const idB = openLoosening(corpus, "worktree-remove");
    const asked = ask(corpus);
    const qA = questionOf(asked, idA);
    const qB = questionOf(asked, idB);
    const nonceOf = (q: Question): string => /\[ask ([A-Z2-9]+)\]/.exec(q.question)?.[1] as string;

    const refused = async (label: string, payload: unknown): Promise<void> => {
      const before = await humanRows(corpus);
      const run = decideFromHarness(corpus, payload);
      expect(run.exitCode, `${label}: ${run.stdout}${run.stderr}`).toBe(4);
      expect(await humanRows(corpus), `${label} must record nothing`).toBe(before);
    };

    // not a PostToolUse AskUserQuestion payload
    await refused("not json", "this is not json");
    await refused("another tool", { ...payloadOf(corpus, [qA], answerFor(qA, "Accept")), tool_name: "Bash" });
    await refused("another event", { ...payloadOf(corpus, [qA], answerFor(qA, "Accept")), hook_event_name: "PreToolUse" });
    // one changed character in the text
    const changed: Question = { ...qA, question: qA.question.replace("do you accept it?", "do you accept it!") };
    await refused("changed text", payloadOf(corpus, [changed], answerFor(changed, "Accept")));
    // a changed option description
    const changedOption: Question = { ...qA, options: [{ ...(qA.options[0] as Question["options"][number]), description: "Accept: anything" }, qA.options[1] as Question["options"][number]] };
    await refused("changed option", payloadOf(corpus, [changedOption], answerFor(changedOption, "Accept")));
    // nonce missing
    const noNonce: Question = { ...qA, question: qA.question.replace(/ \[ask [A-Z2-9]+\]/, "") };
    await refused("nonce missing", payloadOf(corpus, [noNonce], answerFor(noNonce, "Accept")));
    // another decision's nonce
    const foreign: Question = { ...qA, question: qA.question.replace(nonceOf(qA), nonceOf(qB)) };
    await refused("another decision's nonce", payloadOf(corpus, [foreign], answerFor(foreign, "Accept")));
    // a nonce lore never issued
    const invented: Question = { ...qA, question: qA.question.replace(nonceOf(qA), "ZZZZZZZZ") };
    await refused("invented nonce", payloadOf(corpus, [invented], answerFor(invented, "Accept")));
    // the same forgery fed through the shipped hook: exit 0 (never blocks), the refusal is on stderr, nothing recorded
    const hookForged = runAskHook(corpus, payloadOf(corpus, [changed], answerFor(changed, "Accept")));
    expect(hookForged.exitCode).toBe(0);
    expect(hookForged.stderr).toContain("refused");
    expect(await humanRows(corpus)).toBe(0);

    // stale: a newer lore pending --ask makes the first questions stale
    const fresh = ask(corpus);
    await refused("stale nonce", payloadOf(corpus, [qA], answerFor(qA, "Accept")));
    const freshA = questionOf(fresh, idA);
    const freshB = questionOf(fresh, idB);

    // free-text Other, a dismissed question and a non-lore question: nothing recorded, still pending, exit 0
    const other = decideFromHarness(corpus, payloadOf(corpus, [freshB], { [freshB.question]: "do something else entirely" }));
    expect(other.exitCode, other.stderr).toBe(0);
    expect(other.stdout).toContain(`decision ${idB} still pending`);
    const dismissed = decideFromHarness(corpus, payloadOf(corpus, [freshB], {}));
    expect(dismissed.exitCode, dismissed.stderr).toBe(0);
    expect(dismissed.stdout).toContain(`decision ${idB} still pending`);
    const plain: Question = { question: "Which colour?", header: "Colour", options: [{ label: "Red", description: "r" }, { label: "Blue", description: "b" }], multiSelect: false };
    const ordinary = decideFromHarness(corpus, payloadOf(corpus, [plain], answerFor(plain, "Red")));
    expect(ordinary.exitCode, ordinary.stderr).toBe(0);
    expect(await humanRows(corpus)).toBe(0);

    // mixed call: the valid question is recorded, the altered one makes the call exit 4
    const forgedB: Question = { ...freshB, question: freshB.question.replace("do you accept it?", "do you accept it.") };
    const mixed = decideFromHarness(corpus, payloadOf(corpus, [freshA, forgedB], { ...answerFor(freshA, "Accept"), ...answerFor(forgedB, "Accept") }));
    expect(mixed.exitCode, `${mixed.stdout}${mixed.stderr}`).toBe(4);
    expect(mixed.stdout).toContain(`decision ${idA} accepted`);
    expect(await humanRows(corpus)).toBe(1);
    expect(thresholdOf(corpus, "worktree-remove")).toBe(0.8);

    // single use: replaying the recorded answer is refused
    await refused("replayed nonce", payloadOf(corpus, [freshA], answerFor(freshA, "Accept")));
    // and the untouched valid question for B is still answerable once
    const good = decideFromHarness(corpus, payloadOf(corpus, [freshB], answerFor(freshB, "Reject")));
    expect(good.exitCode, good.stderr).toBe(0);
    expect(await humanRows(corpus)).toBe(2);
  }, 400_000);

  it("the git-safety gate refuses an agent Bash call containing lore decide, with or without --from-harness (exit 2)", () => {
    const gate = (command: string): { code: number; stderr: string } => {
      const r = spawnSync("node", [GATE_HOOK], { input: JSON.stringify({ cwd: tmpdir(), tool_input: { command } }), encoding: "utf8" });
      return { code: r.status ?? -1, stderr: r.stderr ?? "" };
    };
    for (const command of [
      "lore decide --from-harness",
      "echo '{}' | lore decide --from-harness",
      "lore decide 3 --accept",
      "FOO=1 lore decide --from-harness < payload.json",
      "./dist/lore decide --from-harness",
      "bun run packages/lore/src/index.ts decide --from-harness",
    ]) {
      const r = gate(command);
      expect(r.code, command).toBe(2);
      expect(r.stderr, command).toMatch(/human-channel-only/);
      expect(r.stderr, command).not.toMatch(/their own terminal/);
    }
    expect(gate("lore pending --ask").code).toBe(0);
    expect(gate('git commit -m "docs: lore decide --from-harness"').code).toBe(0);
  }, 60_000);

  it("lore decide --from-harness takes only the payload: an id or answer flag is refused (exit 4)", () => {
    const corpus = newCorpus("lore-ask2f-");
    for (const extra of [["3"], ["--accept"], ["--reject"], ["--reason", "x"]]) {
      const run = decideFromHarness(corpus, "{}", extra);
      expect(run.exitCode, extra.join(" ")).toBe(4);
    }
  }, 120_000);
});

describe("AC-ASK-3 the rule ships", () => {
  it("the always-loaded fragments rendered by lore context carry BR-1375, and no shipped asset sends the human to a terminal", () => {
    const root = mkdtempSync(join(tmpdir(), "lore-ask3-"));
    shimDirs.push(root);
    const home = join(root, "home");
    const project = join(root, "corpus");
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    const run = (args: string[]): Run => {
      const r = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd: project, env: { PATH: process.env["PATH"] ?? "", HOME: home, EDITOR: "true" }, encoding: "utf8", timeout: 120_000 });
      return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? -1 };
    };
    expect(run(["init"]).exitCode).toBe(0);
    const init = run(["context", "init", "--no-ai"]);
    expect(init.exitCode, init.stderr).toBe(0);
    const refreshed = run(["context", "refresh"]);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);

    const rulesDir = join(project, ".claude", "rules");
    const rendered = readdirSync(rulesDir).map((f) => readFileSync(join(rulesDir, f), "utf8")).join("\n");
    expect(rendered).toContain("interactive question tool");
    expect(rendered).toContain("carry out the answer yourself");
    expect(rendered).toContain("Never tell the human to run a command, open a page or look something up elsewhere");
    expect(existsSync(join(rulesDir, "lore-ask-then-execute.md"))).toBe(true);

    // no asset (context, skills, agents, hook messages, project files) tells the human to run lore decide in a terminal
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(md|mjs|js|json|sh|txt|yaml|yml)$/.test(name) || !name.includes(".")) {
          const lines = readFileSync(path, "utf8").split("\n");
          lines.forEach((line, i) => {
            if (/lore decide/.test(line) && /(terminal|own shell|ask them to run|human (runs|types)|--accept\|--reject)/i.test(line)) offenders.push(`${path}:${i + 1}`);
          });
        }
      }
    };
    walk(join(REPO_ROOT, "assets"));
    expect(offenders).toEqual([]);
  }, 240_000);
});
