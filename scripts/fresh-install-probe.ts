/**
 * Fresh-install probe (AC-FIP-6; AS-16 every shipped command works from the compiled binary; BR-1007).
 *
 *   bun scripts/fresh-install-probe.ts --bin dist/lore [--keep]
 *
 * Creates a throwaway consumer project (git init, package.json, one src file, one commit) under mkdtemp, runs the
 * whole baseline loop with the COMPILED binary and prints one `PASS|FAIL <step> (exit N) <reason>` line per step.
 * Exit 0 iff every step meets its expectation, 1 otherwise, 2 on a usage error. The repo's own .lore is never
 * touched: every child runs with cwd inside the temp project and HOME inside the temp root.
 *
 * Side-effect class: IO edge (spawns processes, writes only under the mkdtemp root). Step logic lives in
 * scripts/lib/fresh-install-probe-steps.ts.
 */
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import yaml from "yaml";
import {
  ACTOR,
  buildSteps,
  evaluateCommandStep,
  evaluateSkillScan,
  formatStepLine,
  formatSummary,
  parseProbeArgs,
  ProbeUsageError,
  SPEC_BODY,
  type ScannedFile,
  type StepVerdict,
} from "./lib/fresh-install-probe-steps.js";

const STEP_TIMEOUT_MS = 180_000;

function runBin(bin: string, argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv) {
  const res = spawnSync(bin, [...argv], { cwd, env, encoding: "utf8", timeout: STEP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new Error(`spawn failed for ${bin} ${argv.join(" ")}: ${res.error.message}`);
  if (res.status === null) throw new Error(`${bin} ${argv.join(" ")} terminated by signal ${String(res.signal)}`);
  return { exitCode: res.status, stdout: res.stdout, stderr: res.stderr };
}

function git(args: readonly string[], cwd: string): void {
  const res = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

function makeConsumerProject(project: string): void {
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "probe-consumer", version: "0.0.0", private: true }, null, 2));
  writeFileSync(join(project, "src", "a.ts"), "export const a = 1;\n");
  git(["init", "-q", "."], project);
  git(["add", "-A"], project);
  git(["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", "commit", "-q", "-m", "init"], project);
}

/** Stub claude-cli judge that always approves (review has no non-AI mode); mirrors review-tree-position-parentless. */
function configureStubJudge(root: string, project: string): void {
  const script = join(root, "fake-judge.sh");
  const verdict = JSON.stringify({ decision: "approve", confidence: 0.9, reasons: [{ dimension: "stub", finding: "stub judge" }], blocking_questions: [] });
  writeFileSync(script, `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${verdict}\nJSONEOF\n`, { mode: 0o755 });
  const configPath = join(project, ".lore", "config.yaml");
  if (!existsSync(configPath)) throw new Error(`${configPath} missing: cannot configure the stub judge`);
  const config = (yaml.parse(readFileSync(configPath, "utf8")) ?? {}) as Record<string, unknown>;
  config["ai"] = { provider: "claude-cli", providers: { "claude-cli": { command: script, args: [], timeout_ms: 20_000 } }, templates: {}, telemetry: false };
  writeFileSync(configPath, yaml.stringify(config));
}

function walk(dir: string, out: ScannedFile[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(md|mdc|txt|json|ya?ml|sh|mjs|js)$/.test(entry)) out.push({ path: full, text: readFileSync(full, "utf8") });
  }
}

/** Files that `setup --project` and the global `setup --claude-dir` install and that teach the agent the spec contract. */
function collectInstalledFiles(project: string, claudeHome: string): ScannedFile[] {
  const files: ScannedFile[] = [];
  walk(join(project, ".claude"), files);
  walk(join(claudeHome, "skills"), files);
  const claudeMd = join(project, "CLAUDE.md");
  if (existsSync(claudeMd)) files.push({ path: claudeMd, text: readFileSync(claudeMd, "utf8") });
  return files;
}

// ── first-write-attested (AC-RID-16; BR-1044) ───────────────────────────────────

const FIXTURE_SESSION = "probe-session-0001";
const FIRST_WRITE_STEP = "first-write-attested";

interface HookEntry {
  readonly matcher: string | undefined;
  readonly command: string;
}

function hookEntries(settings: unknown, event: string): HookEntry[] {
  const hooks = (settings as { hooks?: Record<string, unknown> } | null)?.hooks;
  const groups = hooks?.[event];
  if (!Array.isArray(groups)) return [];
  const out: HookEntry[] = [];
  for (const g of groups as { matcher?: string; hooks?: { command?: string }[] }[]) {
    for (const h of g.hooks ?? []) if (typeof h.command === "string") out.push({ matcher: g.matcher, command: h.command });
  }
  return out;
}

function findString(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec[key] === "string") return rec[key] as string;
  for (const v of Object.values(rec)) {
    const found = findString(v, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function runHook(command: string, payload: unknown, project: string, env: NodeJS.ProcessEnv) {
  const res = spawnSync("sh", ["-c", command], {
    cwd: project,
    env: { ...env, CLAUDE_PROJECT_DIR: project },
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: STEP_TIMEOUT_MS,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function firstWriteAttested(bin: string, root: string, project: string, claudeHome: string, env: NodeJS.ProcessEnv): { exit: number | "-"; verdict: StepVerdict } {
  // `lore setup --claude-dir` registers the hooks in <claude-dir>/settings.json (SPEC-046), not in the project.
  const settingsPath = join(claudeHome, "settings.json");
  if (!existsSync(settingsPath)) return { exit: "-", verdict: { pass: false, reason: `${settingsPath} missing after lore setup --claude-dir` } };
  const settings: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));

  const missing: string[] = [];
  const find = (event: string, script: string, matcher: string | undefined): HookEntry | undefined => {
    const hit = hookEntries(settings, event).find((e) => e.command.includes(script) && (matcher === undefined || e.matcher === matcher));
    if (hit === undefined) missing.push(`${event}${matcher === undefined ? "" : `[${matcher}]`} -> ${script}`);
    return hit;
  };
  const sessionStart = find("SessionStart", "run-register.mjs", undefined);
  find("SubagentStart", "run-register.mjs", undefined);
  const preBash = find("PreToolUse", "pre-tool-harness-run.mjs", "Bash");
  if (missing.length > 0 || sessionStart === undefined || preBash === undefined) {
    return { exit: "-", verdict: { pass: false, reason: `installed settings lack hook registration(s): ${missing.join("; ")}` } };
  }

  // `lore` on PATH inside the hooks must be the probe's binary, never an installed one.
  const shimDir = join(root, "bin");
  mkdirSync(shimDir, { recursive: true });
  symlinkSync(bin, join(shimDir, "lore"));
  const hookEnv: NodeJS.ProcessEnv = { ...env, PATH: `${shimDir}:${env["PATH"] ?? ""}` };
  delete hookEnv["LORE_ACTOR"];

  const reg = runHook(sessionStart.command, { session_id: FIXTURE_SESSION, cwd: project, hook_event_name: "SessionStart", source: "startup" }, project, hookEnv);
  if (reg.status !== 0) return { exit: reg.status ?? "-", verdict: { pass: false, reason: `run-register hook exited ${String(reg.status)}: ${reg.stderr.slice(0, 160)}` } };

  const created = runBin(bin, ["create", "task", "--adhoc", "--ac-scope", "", "--title", "First Write Probe Task", "--json"], project, env);
  if (created.exitCode !== 0) return { exit: created.exitCode, verdict: { pass: false, reason: `create task failed: ${created.stderr.slice(0, 160)}` } };
  const slug = findString(JSON.parse(created.stdout), "slug");
  if (slug === undefined) return { exit: 0, verdict: { pass: false, reason: "create task --json carried no slug" } };

  const pre = runHook(
    preBash.command,
    { session_id: FIXTURE_SESSION, cwd: project, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `lore claim ${slug}` } },
    project,
    hookEnv,
  );
  if (pre.status !== 0) return { exit: pre.status ?? "-", verdict: { pass: false, reason: `pre-tool-harness-run hook exited ${String(pre.status)}: ${pre.stderr.slice(0, 160)}` } };
  let rewritten: string | undefined;
  try {
    rewritten = findString(JSON.parse(pre.stdout), "command");
  } catch {
    rewritten = undefined;
  }
  if (rewritten === undefined || !rewritten.includes("--harness-run")) {
    return { exit: 0, verdict: { pass: false, reason: `hook did not rewrite the command with --harness-run: ${pre.stdout.slice(0, 160)}` } };
  }

  const claim = spawnSync("sh", ["-c", rewritten], { cwd: project, env: hookEnv, encoding: "utf8", timeout: STEP_TIMEOUT_MS });
  if (claim.status !== 0) return { exit: claim.status ?? "-", verdict: { pass: false, reason: `rewritten claim exited ${String(claim.status)}: ${(claim.stderr ?? "").slice(0, 160)}` } };

  // No CLI surface renders harness_run yet (`lore log --json` carries only created_by), so read the claim's audit row from the
  // probe corpus directly: the attestation is the stored audit.harness_run column, not a rendered string.
  const run = `cc:${FIXTURE_SESSION}`;
  const db = new Database(join(project, ".lore", "lore.db"), { readonly: true });
  let claimRuns: (string | null)[];
  try {
    claimRuns = (db.query("SELECT harness_run FROM audit WHERE action = 'claim'").all() as { harness_run: string | null }[]).map((r) => r.harness_run);
  } finally {
    db.close();
  }
  if (!claimRuns.includes(run)) return { exit: 0, verdict: { pass: false, reason: `claim audit row does not carry ${run} (claim rows: ${JSON.stringify(claimRuns)})` } };
  return { exit: 0, verdict: { pass: true, reason: `hooks registered; claim of ${slug} attributed to ${run}` } };
}

function main(): number {
  let args;
  try {
    args = parseProbeArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof ProbeUsageError) {
      console.error(`fresh-install-probe: ${e.message}\nusage: bun scripts/fresh-install-probe.ts --bin <path-to-compiled-lore> [--keep]`);
      return 2;
    }
    throw e;
  }
  const bin = resolve(args.bin);
  if (!existsSync(bin)) {
    console.error(`fresh-install-probe: binary not found: ${bin}`);
    return 2;
  }

  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-fresh-install-probe-")));
  const project = join(root, "project");
  const claudeHome = join(root, "claude-home");
  const specBodyFile = join(root, "spec-body.md");
  mkdirSync(project);
  mkdirSync(claudeHome);
  writeFileSync(specBodyFile, SPEC_BODY);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, LORE_ACTOR: ACTOR, CLAUDECODE: "1" };

  const verdicts: StepVerdict[] = [];
  try {
    makeConsumerProject(project);
    for (const step of buildSteps({ claudeHome, specBodyFile })) {
      let verdict: StepVerdict;
      let exit: number | "-" = "-";
      try {
        if (step.kind === "command") {
          const out = runBin(bin, step.argv, project, env);
          exit = out.exitCode;
          verdict = evaluateCommandStep(step, out);
        } else if (step.kind === "configure-judge") {
          configureStubJudge(root, project);
          verdict = { pass: true, reason: "ok" };
        } else {
          verdict = evaluateSkillScan(collectInstalledFiles(project, claudeHome));
        }
      } catch (e) {
        verdict = { pass: false, reason: e instanceof Error ? e.message : String(e) };
      }
      verdicts.push(verdict);
      console.log(formatStepLine(step.name, exit, verdict));
    }
    {
      let r: { exit: number | "-"; verdict: StepVerdict };
      try {
        r = firstWriteAttested(bin, root, project, claudeHome, env);
      } catch (e) {
        r = { exit: "-", verdict: { pass: false, reason: e instanceof Error ? e.message : String(e) } };
      }
      verdicts.push(r.verdict);
      console.log(formatStepLine(FIRST_WRITE_STEP, r.exit, r.verdict));
    }
  } finally {
    if (args.keep) console.log(`kept: ${project}`);
    else rmSync(root, { recursive: true, force: true });
  }
  console.log(formatSummary(verdicts));
  return verdicts.every((v) => v.pass) ? 0 : 1;
}

process.exit(main());
