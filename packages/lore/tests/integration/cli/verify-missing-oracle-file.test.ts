// @spawns packages/lore/src/index.ts
// @layer integration-cli-verify-missing-oracle AC-EI-2 (real CLI in a throwaway corpus; owner is the evidence-identity spec oracle)
/**
 * A script AC whose command names a test file that no longer exists is NOT MEASURED
 * (task-skill-implement-tg-10-verify-records-a-missing-oracle-file; spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-6;
 * baseline AS-17: a completeness/fidelity oracle never reports complete over what it could not see).
 *
 * Subprocess pattern (commands/ac.ts imports bun:sqlite, unresolvable under vitest): `bun run src/index.ts` in a
 * `mkdtemp` + `lore init` corpus, never this repo's `.lore/`.
 *
 * Dimension mapping:
 *   HAPPY:      the oracle file exists -> verify records an attested pass, `ac list` renders attested_pass
 *   NEGATIVE:   file deleted -> verify exits 3 (the inconclusive exit) with the missing path in its output, records `inconclusive` (never pass/fail),
 *               `ac list` coverage state is `not_measured`, `lore done` exits exactly 4 naming the AC
 *   STATE:      the earlier attested pass stays in the log but no longer renders as passing
 *   REGRESSION: repointing the command to an existing file clears the refusal (verify passes, done exits 0)
 *
 * @spec_ref AC-TG-6
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withSessionIdentity } from "../../helpers/session-actor.js";

const GIT_AUTHOR_ARGS = ["-c", "user.email=lore-test@example.com", "-c", "user.name=Lore Test"] as const;
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const AC_ID = "AC-M-1";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string, actor: string | null = "missing-oracle-test"): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" }, actor) as Record<string, string>,
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function mustRun(args: string[], cwd: string): string {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function extractSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function disableAllGates(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      ...["spec-create", "spec-promote", "plan-promote", "task-claim", '"task-create"'].flatMap((g) => [
        `    ${g}:`,
        "      enabled: false",
      ]),
      "",
    ].join("\n"),
  );
}

const PASSING_TEST_BODY = 'import { test, expect } from "bun:test";\ntest("ok", () => { expect(1).toBe(1); });\n';

function commitAll(dir: string, msg: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", [...GIT_AUTHOR_ARGS, "commit", "-q", "-m", msg, "--allow-empty"], { cwd: dir });
}

function coverageState(dir: string, spec: string): string | undefined {
  const parsed = JSON.parse(mustRun(["ac", "list", spec, "--json"], dir)) as {
    data: { coverage: Array<{ ac_id: string; state: string }> | null };
  };
  return parsed.data.coverage?.find((f) => f.ac_id === AC_ID)?.state;
}

function lastEvidenceResult(dir: string, task: string): string | undefined {
  const parsed = JSON.parse(mustRun(["get", task, "--json"], dir)) as {
    data: { doc: { extra: { verification_evidence?: Array<{ result: string }> } } };
  };
  const rows = parsed.data.doc.extra.verification_evidence ?? [];
  return rows[rows.length - 1]?.result;
}

describe("lore verify / ac list / done over an AC whose oracle file is missing", () => {
  let dir: string;
  let spec: string;
  let plan: string;
  let task: string;

  // reason: ~10 CLI spawns at ~1-2s each.
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-missing-oracle-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    mustRun(["init"], dir);
    disableAllGates(dir);
    mustRun(["create", "prd", "--title", "Missing Oracle PRD", "--no-ai", "--content", "body"], dir);
    spec = extractSlug(mustRun(["create", "spec", "--title", "Missing Oracle Spec", "--no-ai", "--content", "body"], dir));
    writeFileSync(join(dir, "oracle.test.ts"), PASSING_TEST_BODY);
    writeFileSync(join(dir, "replacement.test.ts"), PASSING_TEST_BODY);
    mustRun(
      ["ac", "add", spec, AC_ID, "--statement", "oracle file exists", "--mode", "script", "--oracle", "test",
        "--command", `bun test oracle.test.ts && echo '${AC_ID} PASS: oracle ran'`],
      dir,
    );
    plan = extractSlug(mustRun(["create", "plan", "--title", "Missing Oracle Plan", "--parent", spec, "--no-ai", "--content", "body"], dir));
    task = extractSlug(
      mustRun(["create", "task", "--kind", "code", "--title", "Missing Oracle Task", "--parent", plan, "--plan-id", plan, "--ac-scope", AC_ID, "--no-ai", "--content", "body"], dir),
    );
    commitAll(dir, "fixture");
  }, 180_000);

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("HAPPY: with the file present verify attests a pass and ac list renders attested_pass", { timeout: 120_000 }, () => {
    const verified = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    expect(lastEvidenceResult(dir, task)).toBe("pass");
    expect(coverageState(dir, spec)).toBe("attested_pass");
  });

  it("NEGATIVE/STATE: file deleted -> verify records not-measured with the path, list stops showing a pass, done exits 4 naming the AC", { timeout: 180_000 }, () => {
    rmSync(join(dir, "oracle.test.ts"));
    commitAll(dir, "delete oracle");

    const verified = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(3);
    expect(verified.stdout + verified.stderr).toContain("oracle.test.ts");
    expect(lastEvidenceResult(dir, task)).toBe("inconclusive");

    expect(coverageState(dir, spec)).toBe("not_measured");

    const done = runLore(["done", task, "--declare-no-new-tests", "fixture"], dir);
    expect(done.exitCode, done.stdout + done.stderr).toBe(4);
    expect(done.stderr).toContain(AC_ID);
    expect(done.stderr).toContain("oracle.test.ts");
  });

  it("REGRESSION: repointing the command at an existing file restores verify and done", { timeout: 180_000 }, () => {
    mustRun(
      ["ac", "set", spec, AC_ID, "--command", `bun test replacement.test.ts && echo '${AC_ID} PASS: replacement ran'`],
      dir,
    );
    commitAll(dir, "repoint");
    const verified = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    expect(coverageState(dir, spec)).toBe("attested_pass");

    const done = runLore(["done", task, "--declare-no-new-tests", "fixture"], dir);
    expect(done.exitCode, done.stdout + done.stderr).toBe(0);
  });
});

// ─── A declared-not-yet-written oracle is not a lie; a declared one that once passed and vanished is ───────────

describe("AC-TG-6 — red-first (--allow-missing-path) ACs: no evidence stays none and does not block done; a vanished once-passing oracle still does", () => {
  let dir: string;
  let spec: string;
  let plan: string;
  let taskRedFirst: string;
  let taskVanished: string;
  let taskDifferentFile: string;
  let taskDotSpelling: string;
  let taskScript: string;

  const addScriptAc = (id: string, file: string, extra: string[] = []): void => {
    mustRun(
      ["ac", "add", spec, id, "--statement", `${id} oracle`, "--mode", "script", "--oracle", "test",
        "--command", `bun test ${file} && echo '${id} PASS: ran'`, ...extra],
      dir,
    );
  };
  const stateOf = (id: string): string | undefined => {
    const parsed = JSON.parse(mustRun(["ac", "list", spec, "--json"], dir)) as {
      data: { coverage: Array<{ ac_id: string; state: string }> | null };
    };
    return parsed.data.coverage?.find((f) => f.ac_id === id)?.state;
  };
  const newTask = (title: string, scope: string[]): string => {
    const slug = extractSlug(
      mustRun(["create", "task", "--kind", "code", "--title", title, "--parent", plan, "--plan-id", plan, "--ac-scope", scope[0] as string, "--no-ai", "--content", "body"], dir),
    );
    for (const extra of scope.slice(1)) mustRun(["scope", "add", slug, extra], dir);
    return slug;
  };

  // reason: ~20 CLI spawns at ~1-2s each.
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-missing-oracle-rf-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    mustRun(["init"], dir);
    disableAllGates(dir);
    mustRun(["create", "prd", "--title", "RF PRD", "--no-ai", "--content", "body"], dir);
    spec = extractSlug(mustRun(["create", "spec", "--title", "RF Spec", "--no-ai", "--content", "body"], dir));
    writeFileSync(join(dir, "ok.test.ts"), PASSING_TEST_BODY);
    addScriptAc("AC-OK", "ok.test.ts");
    addScriptAc("AC-RF", "later.test.ts", ["--allow-missing-path", "red-first: a later task writes it"]);
    addScriptAc("AC-VAN", "vanish.test.ts", ["--allow-missing-path", "red-first: written before verify"]);
    addScriptAc("AC-DIFF", "never-written.test.ts", ["--allow-missing-path", "red-first: a later task writes it"]);
    addScriptAc("AC-DOT", "dotspelled.bun.test.ts", ["--allow-missing-path", "red-first: written before the pass"]);
    mustRun(
      ["ac", "add", spec, "AC-SCR", "--statement", "AC-SCR script oracle", "--mode", "script", "--oracle", "other",
        "--command", "sh scripts/ran.sh", "--allow-missing-path", "red-first: written before the pass"],
      dir,
    );
    plan = extractSlug(mustRun(["create", "plan", "--title", "RF Plan", "--parent", spec, "--no-ai", "--content", "body"], dir));
    taskRedFirst = newTask("RF Task One", ["AC-OK", "AC-RF"]);
    taskVanished = newTask("RF Task Two", ["AC-OK", "AC-VAN"]);
    taskDifferentFile = newTask("RF Task Three", ["AC-OK", "AC-DIFF"]);
    taskDotSpelling = newTask("RF Task Four", ["AC-OK", "AC-DOT"]);
    taskScript = newTask("RF Task Five", ["AC-OK", "AC-SCR"]);
    commitAll(dir, "fixture");
  }, 180_000);

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("STATE/HAPPY: a declared red-first AC with no evidence reads none and its task can be archived", { timeout: 180_000 }, () => {
    const verified = runLore(["verify", plan, "--task", taskRedFirst, "--ac", "AC-OK", "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    expect(stateOf("AC-RF")).toBe("none");

    const done = runLore(["done", taskRedFirst, "--declare-no-new-tests", "fixture"], dir);
    expect(done.exitCode, done.stdout + done.stderr).toBe(0);
  });

  it("NEGATIVE: a declared AC that once passed and whose file is gone is not measured and still refuses done with exit 4", { timeout: 180_000 }, () => {
    writeFileSync(join(dir, "vanish.test.ts"), PASSING_TEST_BODY);
    commitAll(dir, "write vanish oracle");
    for (const ac of ["AC-OK", "AC-VAN"]) {
      const verified = runLore(["verify", plan, "--task", taskVanished, "--ac", ac, "--yes"], dir);
      expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    }
    rmSync(join(dir, "vanish.test.ts"));
    commitAll(dir, "delete vanish oracle");

    expect(stateOf("AC-VAN")).toBe("not_measured");
    const done = runLore(["done", taskVanished, "--declare-no-new-tests", "fixture"], dir);
    expect(done.exitCode, done.stdout + done.stderr).toBe(4);
    expect(done.stderr).toContain("AC-VAN");
    expect(done.stderr).toContain("vanish.test.ts");
  });

  it("REGRESSION (TG-22 narrowing removed; AC-TG-6 text + AC-EI-2): a declared red-first AC with a pass tagged to it that ran a DIFFERENT existing file renders not_measured and lore done exits 4 naming the AC and its path", { timeout: 180_000 }, () => {
    const verified = runLore(["verify", plan, "--task", taskDifferentFile, "--ac", "AC-OK", "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    // A pass tagged AC-DIFF whose command runs other.bun.test.ts (exists), never never-written.test.ts (the AC's oracle).
    writeFileSync(join(dir, "other.bun.test.ts"), PASSING_TEST_BODY);
    const recorded = runLore(
      ["evidence", taskDifferentFile, "--oracle", "test", "--command", "bun test other.bun.test.ts", "--result", "pass", "--ac", "AC-DIFF", "--capture"],
      dir,
    );
    expect(recorded.exitCode, recorded.stdout + recorded.stderr).toBe(0);

    // AC-EI-2: a missing oracle is not measured whichever files earlier passes ran (TG-22's "passes that ran the
    // missing file" narrowing is gone; spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-6 text never had it).
    expect(stateOf("AC-DIFF")).toBe("not_measured");
    // AC-TG-6 text: `lore done` exits 4 naming the AC until its command is repointed — no "ran the missing file" narrowing.
    const done = runLore(["done", taskDifferentFile, "--declare-no-new-tests", "fixture"], dir);
    expect(done.exitCode, done.stdout + done.stderr).toBe(4);
    expect(done.stderr).toContain("AC-DIFF");
    expect(done.stderr).toContain("never-written.test.ts");
  });

  it("NEGATIVE (TG-22): a pass recorded as ./dotspelled.bun.test.ts of an AC path dotspelled.bun.test.ts that has since vanished is still not measured and refuses done", { timeout: 180_000 }, () => {
    writeFileSync(join(dir, "dotspelled.bun.test.ts"), PASSING_TEST_BODY);
    commitAll(dir, "write dotspelled oracle");
    const verified = runLore(["verify", plan, "--task", taskDotSpelling, "--ac", "AC-OK", "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    const recorded = runLore(
      ["evidence", taskDotSpelling, "--oracle", "test", "--command", "bun test ./dotspelled.bun.test.ts", "--result", "pass", "--ac", "AC-DOT", "--capture"],
      dir,
    );
    expect(recorded.exitCode, recorded.stdout + recorded.stderr).toBe(0);
    rmSync(join(dir, "dotspelled.bun.test.ts"));
    commitAll(dir, "delete dotspelled oracle");

    expect(stateOf("AC-DOT")).toBe("not_measured");
    const done = runLore(["done", taskDotSpelling, "--declare-no-new-tests", "fixture"], dir);
    expect(done.exitCode, done.stdout + done.stderr).toBe(4);
    expect(done.stderr).toContain("AC-DOT");
  });
  it("NEGATIVE (AC-EI-2): a script path that once passed and vanished is not measured and lore done exits 4 naming the AC and the script", { timeout: 180_000 }, () => {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "ran.sh"), "echo ran\n");
    commitAll(dir, "write script oracle");
    for (const ac of ["AC-OK", "AC-SCR"]) {
      const verified = runLore(["verify", plan, "--task", taskScript, "--ac", ac, "--yes"], dir);
      expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    }
    rmSync(join(dir, "scripts", "ran.sh"));
    commitAll(dir, "delete script oracle");

    expect(stateOf("AC-SCR")).toBe("not_measured");
    const done = runLore(["done", taskScript, "--declare-no-new-tests", "fixture"], dir);
    expect(done.exitCode, done.stdout + done.stderr).toBe(4);
    expect(done.stderr).toContain("AC-SCR");
    expect(done.stderr).toContain("scripts/ran.sh");
  });
});
