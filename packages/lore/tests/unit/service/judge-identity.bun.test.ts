/**
 * @spec_ref spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit (AC-JR-3, BR-1535 S5)
 *
 * The judge's identity for per-unit reuse. With the project's own provider, `claude -p`, the model is unknown unless the call is
 * invoked with one explicitly: `ai.assess.model` makes the claude-cli provider pass `--model <id>` and report that id; with none
 * configured (or a custom judge command that cannot take the flag) the model stays unknown, reuse is off and the recorded cause
 * names the config key to set. A stub `claude` script proves the flag really reaches the spawned command.
 *
 * Dimensions: HAPPY (configured model is passed and reported), NEGATIVE (none configured, custom command), BOUNDARY (HTTP
 * provider's own model id), ERROR (a failing spawn names nothing), STATE (the ledger records the cause), REGRESSION (no flag
 * is injected without a model).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoOpTelemetry } from "@lore/core";
import { ClaudeCliProvider } from "../../../src/ai/claude-cli-provider.js";
import { HttpAIProvider } from "../../../src/ai/http-provider.js";
import { buildHermeticSpawnSpec } from "../../../src/ai/hermetic-spawn.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { UnitLedger } from "../../../src/service/judge-unit-ledger.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-judge-identity-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** An executable named `claude` (basename decides) that records its arguments and answers `ok`. */
function stubClaude(name = "claude"): { command: string; argsFile: string } {
  const argsFile = join(dir, "args.txt");
  const command = join(dir, name);
  writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\ncat > /dev/null\nprintf 'ok'\n`);
  chmodSync(command, 0o755);
  return { command, argsFile };
}

const runtime = () => ({ env: { PATH: process.env["PATH"] ?? "" }, tmpDir: dir });
const serviceFor = (provider: ClaudeCliProvider | HttpAIProvider, model?: string) =>
  new AIProviderService(new Map([[provider.name, provider]]), provider.name, {}, new NoOpTelemetry(), false, 8000, { max_diff_chars: 80000, ...(model !== undefined ? { model } : {}) });

describe("hermetic spawn spec and --model", () => {
  const cfg = (command: string) => ({ command, args: ["-p"], timeout_ms: 1000 });
  const ctx = { sourceEnv: {}, tmpDir: "/tmp" };
  it("AC-JR-3 the claude binary is given --model <id> after the isolation flag", () => {
    expect(buildHermeticSpawnSpec(cfg("claude"), { ...ctx, model: "claude-opus-4-8" }).args).toEqual(["-p", "--setting-sources", "", "--model", "claude-opus-4-8"]);
  });
  it("AC-JR-3 no model, no flag; a custom command is never given the flag", () => {
    expect(buildHermeticSpawnSpec(cfg("claude"), ctx).args).toEqual(["-p", "--setting-sources", ""]);
    expect(buildHermeticSpawnSpec(cfg("./judge.sh"), { ...ctx, model: "claude-opus-4-8" }).args).toEqual(["-p"]);
  });
});

describe("judgeIdentity", () => {
  it("AC-JR-3 claude-cli with ai.assess.model is invoked with --model and reports that id", async () => {
    const { command, argsFile } = stubClaude();
    const service = serviceFor(new ClaudeCliProvider("claude-cli", { command, args: ["-p"], timeout_ms: 20000 }, runtime()), "claude-opus-4-8");
    expect(service.judgeIdentity()).toEqual({ provider: "claude-cli", model: "claude-opus-4-8", settings: {} });
    const reply = await service.judgeMilestoneMeasured("a prompt", "A plan");
    expect(reply.ok && reply.value.text).toBe("ok");
    expect(reply.ok && reply.value.model).toBe("claude-opus-4-8");
    expect(readFileSync(argsFile, "utf8").split("\n")).toContain("--model");
    expect(readFileSync(argsFile, "utf8").split("\n")).toContain("claude-opus-4-8");
  });

  it("AC-JR-3 claude-cli with no ai.assess.model names no model, passes no --model and the hint names the config key", async () => {
    const { command, argsFile } = stubClaude();
    const service = serviceFor(new ClaudeCliProvider("claude-cli", { command, args: ["-p"], timeout_ms: 20000 }, runtime()));
    const identity = service.judgeIdentity();
    expect(identity.model).toBeUndefined();
    expect(identity.modelHint).toContain("ai.assess.model");
    const reply = await service.judgeMilestoneMeasured("a prompt", "A plan");
    expect(reply.ok && reply.value.model).toBeUndefined();
    expect(readFileSync(argsFile, "utf8")).not.toContain("--model");
  });

  it("AC-JR-3 a custom judge command takes no explicit model: it stays unknown even with ai.assess.model set", () => {
    const { command } = stubClaude("my-judge.sh");
    const service = serviceFor(new ClaudeCliProvider("claude-cli", { command, args: [], timeout_ms: 20000 }, runtime()), "claude-opus-4-8");
    expect(service.judgeIdentity().model).toBeUndefined();
  });

  it("AC-JR-3 the HTTP provider reports ai.assess.model, else its own configured model", () => {
    const http = new HttpAIProvider("http", { url: "http://localhost:1/v1/messages", model: "own-model", max_tokens: 10, timeout_ms: 1000, headers: {} } as never);
    expect(serviceFor(http).judgeIdentity().model).toBe("own-model");
    expect(serviceFor(http, "assess-model").judgeIdentity().model).toBe("assess-model");
  });

  it("AC-JR-3 the review records reuse disabled with a cause naming ai.assess.model when the model is unknown", () => {
    const { command } = stubClaude();
    const identity = serviceFor(new ClaudeCliProvider("claude-cli", { command, args: ["-p"], timeout_ms: 20000 }, runtime())).judgeIdentity();
    const store = { getJudgeVerdict: async () => null, insertJudgeVerdictIfAbsent: async () => null, replaceJudgeVerdictIfEquals: async () => null, pruneJudgeVerdictsNotReadSince: async () => null };
    const ledger = new UnitLedger(store as never, identity, "plan@t#1", () => new Date(), "template");
    expect(ledger.enabled).toBe(false);
    expect(ledger.disabledCause).toContain("ai.assess.model");
  });
});
