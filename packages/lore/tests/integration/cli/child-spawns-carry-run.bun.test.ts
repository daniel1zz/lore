// @spawns-external sh runs the floor runner's `sh -c <command>` shape with an ambient environment that names no run
/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-11
 * @task task-red-tests-export-prefix-ancestry-verification-refusal (RED; implementation lands in a later task of the same plan)
 *
 * The DESCENDANT child processes lore spawns and waits for carry the caller's run in their ENVIRONMENT (LORE_HARNESS_RUN)
 * and pass no run flag. A detached job (the post-integrate review batch) outlives its caller and is not a descendant: it
 * writes under a delegated child run and is covered by AC-DJ-1 (detached-job-delegated-run.bun.test.ts, #501):
 *   - integrate's migrate step (`runSchemaMigration`): the command handed to the runner names no run flag;
 *   - the human channel (`createProductionHumanChannelPorts`): the argv it surfaces to the channel check names no run flag
 *     (agent ancestry is read from the value in the environment, not from argv).
 *
 * Behaviour level over existing public functions. The two write-through-a-real-child cases (a migrate child that stamps its
 * write) belong to the end-to-end shell-form tests of the same plan (AC-RV-2); this file pins the spawn contracts.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Invocation } from "@lore/core";
import { createProductionHumanChannelPorts } from "../../../src/adapters/real-human-channel-port.js";
import { checkHumanChannelPreconditions, type HumanChannelPorts } from "../../../src/service/human-channel.js";
import { runSchemaMigration } from "../../../src/service/integrate-service.js";

const RUN = "cc:child-spawn-session";
const CALLER_FLAG = ["--harness", "run"].join("-");

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lore-child-spawns-"));
  mkdirSync(join(root, "corpus"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("AC-RV-11: spawned descendant lore children inherit the verified run", () => {
  it("integrate's migrate step: the command handed to the runner names no run flag", () => {
    const commands: string[] = [];
    runSchemaMigration(
      (command) => {
        commands.push(command);
        return { status: 0, output: '{"ok":true,"data":{"upgraded":false,"from":1,"to":1}}' };
      },
      "lore migrate schema",
      root,
      join(root, "corpus"),
      RUN,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toContain(CALLER_FLAG);
  });

  it("integrate's migrate step: the child shell's environment carries LORE_HARNESS_RUN (the floor runner's shell form)", () => {
    const seenEnv = join(root, "migrate-env.txt");
    // the same shape the production floor runner has: `sh -c <command>` with an ambient env that names no run
    const runner = (command: string, cwd: string) => {
      const result = spawnSync("sh", ["-c", command], { cwd, encoding: "utf8", env: { PATH: process.env["PATH"] } });
      return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    };
    const report = '{"ok":true,"data":{"upgraded":false,"from":1,"to":1}}';
    // the trailing `#` keeps the appended ` --json` out of the shell command
    const migrate = `printenv LORE_HARNESS_RUN > '${seenEnv}'; echo '${report}' #`;
    const outcome = runSchemaMigration(runner, migrate, root, join(root, "corpus"), RUN);
    expect(outcome.state).toBe("current");
    expect(readFileSync(seenEnv, "utf8").trim()).toBe(RUN);
  });

  it("human channel: the argv surfaced to the channel check names no run flag for an agent run", () => {
    const inv = {
      cwd: root,
      env: { CLAUDECODE: "1", LORE_HARNESS_RUN: RUN },
      argv: ["session", "start", "--human", "dana"],
      identity: { harnessRun: RUN, claimed: "agent:session-child-sp", claimedSource: "run" },
    } as unknown as Invocation;
    const ports = createProductionHumanChannelPorts(inv);
    expect(ports.argv()).not.toContain(CALLER_FLAG);
    expect(ports.env()["LORE_HARNESS_RUN"]).toBe(RUN);
  });

  it("human channel: the agent-ancestry refusal reads the run VALUE from the environment, not argv", () => {
    // every other check passes (terminals present, no agent marker, empty process table, no controlling terminal to open), so
    // the ONLY thing that can end in `agent-ancestry` here is the run value in the environment
    const portsWith = (env: Record<string, string>): HumanChannelPorts => ({
      stdinIsTty: () => true,
      stdoutIsTty: () => true,
      env: () => env,
      argv: () => [],
      selfPid: () => 4242,
      readProcessTable: () => ({ ok: true, value: [] }),
      newNonce: () => "nonce",
      openTerminal: () => null,
    });
    const carried = checkHumanChannelPreconditions(portsWith({ LORE_HARNESS_RUN: RUN }));
    expect(carried.ok).toBe(false);
    expect(carried.ok ? "" : carried.error.message).toBe("agent-ancestry: the environment carries an agent run identity (LORE_HARNESS_RUN)");
    // control: the same ports without the value get past that check and stop at the missing terminal
    const without = checkHumanChannelPreconditions(portsWith({}));
    expect(without.ok ? "" : without.error.rule).toBe("tty-required");
  });
});
