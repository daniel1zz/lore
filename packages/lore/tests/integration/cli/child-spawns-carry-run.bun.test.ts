/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-11
 * @task task-red-tests-export-prefix-ancestry-verification-refusal (RED; implementation lands in a later task of the same plan)
 *
 * The child processes lore spawns carry the caller's run in their ENVIRONMENT (LORE_HARNESS_RUN) and pass no run flag:
 *   - the review batch (`spawnDetachedReviewBatch`): the child is a recording script, so its argv and env are observed;
 *   - integrate's migrate step (`runSchemaMigration`): the command handed to the runner names no run flag;
 *   - the human channel (`createProductionHumanChannelPorts`): the argv it surfaces to the channel check names no run flag
 *     (agent ancestry is read from the value in the environment, not from argv).
 *
 * Behaviour level over existing public functions. The two write-through-a-real-child cases (a migrate child that stamps its
 * write) belong to the end-to-end shell-form tests of the same plan (AC-RV-2); this file pins the spawn contracts.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Invocation } from "@lore/core";
import { createProductionHumanChannelPorts } from "../../../src/adapters/real-human-channel-port.js";
import { spawnDetachedReviewBatch } from "../../../src/adapters/cli/review-batch-wiring.js";
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

async function waitForFile(path: string, milliseconds: number): Promise<string> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (existsSync(path) && readFileSync(path, "utf8").includes("END")) return readFileSync(path, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`the child never wrote ${path}`);
}

describe("AC-RV-11: spawned lore children inherit the verified run", () => {
  it("review batch: the child's environment carries LORE_HARNESS_RUN and its argv carries no run flag", async () => {
    const recorder = join(root, "recorder.sh");
    const record = join(root, "record.txt");
    writeFileSync(recorder, `#!/bin/sh\n{ echo "ENV=$LORE_HARNESS_RUN"; echo "ARGV=$*"; echo END; } > '${record}'\n`);
    chmodSync(recorder, 0o755);

    const spawned = spawnDetachedReviewBatch({
      cwd: root,
      corpusDir: join(root, "corpus"),
      execPath: recorder,
      isCompiled: true,
      env: { PATH: process.env["PATH"] },
      harnessRun: RUN,
    });
    expect(spawned.ok).toBe(true);

    const seen = await waitForFile(record, 15_000);
    expect(seen).toContain(`ENV=${RUN}`);
    expect(seen).not.toContain(CALLER_FLAG);
  }, 30_000);

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
});
