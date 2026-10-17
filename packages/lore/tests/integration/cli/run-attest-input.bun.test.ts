// @spawns packages/lore/src/index.ts
/**
 * @spec_ref AC-RID-1
 *
 * `lore run attest-input` (spec run-identity-slice-1 D10 / D12): a Claude Code PreToolUse payload on stdin
 * becomes hook JSON whose `updatedInput` carries the run. ⛔ The output must NEVER contain
 * `permissionDecision` — `"allow"` would skip the user's permission prompt for every command mentioning lore.
 *
 * Six dimensions: HAPPY (Bash, subagent Bash, MCP), NEGATIVE (non-lore Bash, other tool, malformed stdin),
 * BOUNDARY (caller-forged flag overwritten, unsafe session id), REGRESSION (no permissionDecision anywhere).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

let root: string;
let corpus: string;

function runLore(args: string[], stdin?: string): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd: corpus,
    ...(stdin !== undefined ? { stdin: new TextEncoder().encode(stdin) } : {}),
    env: { ...process.env, HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "xdg"), EDITOR: "true", CLAUDECODE: "1" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-run-attest-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

const payload = (over: Record<string, unknown>): string =>
  JSON.stringify({ session_id: "S1", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" }, ...over });

interface HookOut {
  hookSpecificOutput: Record<string, unknown> & { updatedInput: Record<string, unknown> };
}

describe("lore run attest-input", () => {
  it("HAPPY: a Bash lore command gets --harness-run cc:<session>; other tool_input keys survive", () => {
    const r = runLore(
      ["run", "attest-input"],
      payload({ tool_input: { command: "lore claim t", description: "claim it" } }),
    );
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as HookOut;
    expect(out.hookSpecificOutput["hookEventName"]).toBe("PreToolUse");
    expect(out.hookSpecificOutput.updatedInput["command"]).toBe("lore --harness-run cc:S1 claim t");
    expect(out.hookSpecificOutput.updatedInput["description"]).toBe("claim it");
  }, 120_000);

  it("HAPPY: a subagent payload derives cc:<session>:<agent>", () => {
    const r = runLore(["run", "attest-input"], payload({ agent_id: "A9", tool_input: { command: "echo x && lore get y" } }));
    const out = JSON.parse(r.stdout) as HookOut;
    expect(out.hookSpecificOutput.updatedInput["command"]).toBe("echo x && lore --harness-run cc:S1:A9 get y");
  }, 120_000);

  it("HAPPY: an mcp__lore__ tool gets harness_run in its input", () => {
    const r = runLore(
      ["run", "attest-input"],
      payload({ tool_name: "mcp__lore__lore_claim", tool_input: { task: "t" } }),
    );
    const out = JSON.parse(r.stdout) as HookOut;
    expect(out.hookSpecificOutput.updatedInput).toEqual({ task: "t", harness_run: "cc:S1" });
  }, 120_000);

  it("BOUNDARY: a caller-forged --harness-run is replaced by the derived run", () => {
    const r = runLore(["run", "attest-input"], payload({ tool_input: { command: "lore claim t --harness-run cc:forged" } }));
    const out = JSON.parse(r.stdout) as HookOut;
    expect(out.hookSpecificOutput.updatedInput["command"]).toBe("lore --harness-run cc:S1 claim t");
  }, 120_000);

  it("REGRESSION (D12): no output ever carries permissionDecision", () => {
    const payloads = [
      payload({ tool_input: { command: "lore claim t" } }),
      payload({ agent_id: "A9", tool_input: { command: "lore claim t && rm -rf x" } }),
      payload({ tool_name: "mcp__lore__lore_get", tool_input: { id: "x" } }),
    ];
    for (const p of payloads) {
      const r = runLore(["run", "attest-input"], p);
      expect(r.stdout.length).toBeGreaterThan(0); // liveness: something was printed
      expect(r.stdout).not.toContain("permissionDecision");
    }
  }, 120_000);

  it("NEGATIVE: a Bash command with no lore invocation prints nothing and exits 0", () => {
    const r = runLore(["run", "attest-input"], payload({ tool_input: { command: "echo lore is great" } }));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
  }, 120_000);

  it("NEGATIVE: a non-lore, non-Bash tool prints nothing and exits 0", () => {
    const r = runLore(["run", "attest-input"], payload({ tool_name: "Read", tool_input: { file_path: "/x" } }));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
  }, 120_000);

  it("NEGATIVE: malformed stdin prints nothing and exits 0", () => {
    for (const bad of ["not json", "{}", ""]) {
      const r = runLore(["run", "attest-input"], bad);
      expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
    }
  }, 120_000);

  it("BOUNDARY: a session id that cannot form a safe run id prints nothing and exits 0", () => {
    const r = runLore(["run", "attest-input"], payload({ session_id: "s;rm -rf /", tool_input: { command: "lore claim t" } }));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
  }, 120_000);
});
