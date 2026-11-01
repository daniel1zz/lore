/**
 * @spec_ref spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit (BR-1535 S2, S5)
 *
 * The judge's identity for per-unit reuse. With `ai.assess.model` set, the claude-cli provider is invoked with `--model <id>
 * --output-format json` and reports the model the JSON reply names (`modelUsage`), the HTTP provider reports the response's `model`;
 * lookups use the configured name, stores use the reply's name. With none configured, or a provider that cannot report a model (a
 * custom command), the identity says so and the ledger turns reuse off from the start with a cause naming the config key. The fixed
 * provider arguments (never the per-call ones) are the identity's settings. A stub `claude` script proves the flags reach the process.
 *
 * Dimensions: HAPPY (configured model passed, reply model reported), NEGATIVE (none configured, custom command), BOUNDARY (several
 * models in `modelUsage`, HTTP model), ERROR (a non-JSON reply and an `is_error` reply), STATE (the ledger records the cause),
 * REGRESSION (no flag is injected without a model; per-call args never reach the settings).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoOpTelemetry } from "@lore/core";
import { ClaudeCliProvider } from "../../../src/ai/claude-cli-provider.js";
import { HttpAIProvider } from "../../../src/ai/http-provider.js";
import { buildHermeticSpawnSpec, fixedProviderArgs, parseClaudeJsonReply } from "../../../src/ai/hermetic-spawn.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { UnitLedger } from "../../../src/service/judge-unit-ledger.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-judge-identity-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const JSON_REPLY = (result: string, usage: Record<string, number>) =>
  JSON.stringify({ result, is_error: false, modelUsage: Object.fromEntries(Object.entries(usage).map(([id, outputTokens]) => [id, { outputTokens }])) });

/** An executable named `claude` (basename decides) that records its arguments and prints `reply`. */
function stubClaude(reply: string, name = "claude"): { command: string; argsFile: string } {
  const argsFile = join(dir, "args.txt");
  const command = join(dir, name);
  const replyFile = join(dir, "reply.txt");
  writeFileSync(replyFile, reply);
  writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\ncat > /dev/null\ncat "${replyFile}"\n`);
  chmodSync(command, 0o755);
  return { command, argsFile };
}

const runtime = () => ({ env: { PATH: process.env["PATH"] ?? "" }, tmpDir: dir });
const serviceFor = (provider: ClaudeCliProvider | HttpAIProvider, model?: string) =>
  new AIProviderService(new Map([[provider.name, provider]]), provider.name, {}, new NoOpTelemetry(), false, 8000, { max_diff_chars: 80000, ...(model !== undefined ? { model } : {}) });

describe("hermetic spawn spec, fixed args and the JSON reply", () => {
  const cfg = (command: string) => ({ command, args: ["-p"], timeout_ms: 1000 });
  const ctx = { sourceEnv: {}, tmpDir: "/tmp" };

  it("BR-1535 the claude binary is given --model <id> and --output-format json after the isolation flag", () => {
    expect(buildHermeticSpawnSpec(cfg("claude"), { ...ctx, model: "claude-opus-4-8" }).args).toEqual(["-p", "--setting-sources", "", "--model", "claude-opus-4-8", "--output-format", "json"]);
  });

  it("BR-1535 no model, no flag; a custom command is never given the flags", () => {
    expect(buildHermeticSpawnSpec(cfg("claude"), ctx).args).toEqual(["-p", "--setting-sources", ""]);
    expect(buildHermeticSpawnSpec(cfg("./judge.sh"), { ...ctx, model: "claude-opus-4-8" }).args).toEqual(["-p"]);
  });

  it("BR-1535 fixed provider args keep effort and sampling flags and drop every per-call flag, spaced or with =", () => {
    expect(fixedProviderArgs(["-p", "--effort", "high", "--temperature=0.2", "--model", "x", "--output-format=json", "--json-schema", "s.json", "--max-tokens", "10", "--prompt-file", "p.txt"])).toEqual([
      "-p",
      "--effort",
      "high",
      "--temperature=0.2",
    ]);
  });

  it("BR-1535 the answering model is the model of modelUsage with the most output tokens; errors and non-JSON are refused", () => {
    expect(parseClaudeJsonReply(JSON_REPLY("hi", { "claude-haiku-x": 3, "claude-opus-y": 120 }))).toEqual({ ok: true, value: { text: "hi", model: "claude-opus-y" } });
    expect(parseClaudeJsonReply(JSON.stringify({ result: "hi" }))).toEqual({ ok: true, value: { text: "hi", model: undefined } });
    expect(parseClaudeJsonReply("plain text").ok).toBe(false);
    expect(parseClaudeJsonReply(JSON.stringify({ result: "boom", is_error: true })).ok).toBe(false);
    expect(parseClaudeJsonReply(JSON.stringify({ nope: 1 })).ok).toBe(false);
  });
});

describe("judgeIdentity and the reply's model", () => {
  it("BR-1535 claude-cli with ai.assess.model is invoked with --model and --output-format json, and reports the model the reply names", async () => {
    const { command, argsFile } = stubClaude(JSON_REPLY("an answer", { "claude-sonnet-full-id": 40 }));
    const service = serviceFor(new ClaudeCliProvider("claude-cli", { command, args: ["-p", "--effort", "high"], timeout_ms: 20000 }, runtime()), "sonnet");
    // the configured name is an alias; the identity carries it for lookups, the fixed args as the settings
    expect(service.judgeIdentity()).toMatchObject({ provider: "claude-cli", model: "sonnet", reportsAnsweringModel: true, settings: { args: "-p --effort high" } });
    const reply = await service.judgeMilestoneMeasured("a prompt", "A plan");
    expect(reply.ok && reply.value.text).toBe("an answer");
    // the model is what the REPLY named, not the requested alias
    expect(reply.ok && reply.value.model).toBe("claude-sonnet-full-id");
    const args = readFileSync(argsFile, "utf8").split("\n");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
  });

  it("BR-1535 claude-cli with no ai.assess.model names no model, passes no --model and reads the plain reply", async () => {
    const { command, argsFile } = stubClaude("plain answer");
    const service = serviceFor(new ClaudeCliProvider("claude-cli", { command, args: ["-p"], timeout_ms: 20000 }, runtime()));
    const identity = service.judgeIdentity();
    expect(identity.model).toBeUndefined();
    expect(identity.modelHint).toContain("ai.assess.model");
    const reply = await service.judgeMilestoneMeasured("a prompt", "A plan");
    expect(reply.ok && reply.value.text).toBe("plain answer");
    expect(reply.ok && reply.value.model).toBeUndefined();
    expect(readFileSync(argsFile, "utf8")).not.toContain("--model");
  });

  it("BR-1535 a claude reply that is not the JSON it was asked for is an AI provider error", async () => {
    const { command } = stubClaude("not json at all");
    const service = serviceFor(new ClaudeCliProvider("claude-cli", { command, args: ["-p"], timeout_ms: 20000 }, runtime()), "sonnet");
    const reply = await service.judgeMilestoneMeasured("a prompt", "A plan");
    expect(reply.ok).toBe(false);
    expect(!reply.ok && reply.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("BR-1535 a custom judge command reports no answering model, even with ai.assess.model set", () => {
    const { command } = stubClaude("x", "my-judge.sh");
    const service = serviceFor(new ClaudeCliProvider("claude-cli", { command, args: [], timeout_ms: 20000 }, runtime()), "claude-opus-4-8");
    expect(service.judgeIdentity().reportsAnsweringModel).toBe(false);
  });

  it("BR-1535 the HTTP provider reports the response's model field", () => {
    const http = new HttpAIProvider("http", { url: "http://localhost:1/v1/messages", model: "own-model", max_tokens: 10, timeout_ms: 1000, headers: {} } as never);
    expect(serviceFor(http, "assess-model").judgeIdentity()).toMatchObject({ model: "assess-model", reportsAnsweringModel: true });
    expect(serviceFor(http).judgeIdentity().model).toBeUndefined();
  });

  it("BR-1535 the HTTP reply's model field is the model that answered, and a call's model is what the request names", async () => {
    let requested: unknown;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        requested = ((await req.json()) as { model?: string }).model;
        return Response.json({ id: "m1", type: "message", role: "assistant", model: "served-model-id", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } });
      },
    });
    try {
      const http = new HttpAIProvider("http", { url: `http://localhost:${String(server.port)}/v1/messages`, model: "own-model", max_tokens: 10, timeout_ms: 5000, headers: {} } as never);
      const reply = await serviceFor(http, "assess-alias").judgeMilestoneMeasured("a prompt", "A plan");
      expect(requested).toBe("assess-alias");
      expect(reply.ok && reply.value.model).toBe("served-model-id");
    } finally {
      await server.stop(true);
    }
  });

  it("BR-1535 the ledger is off from the start, with a cause naming ai.assess.model, when no model is configured; and for a provider that reports none", () => {
    const { command } = stubClaude("x");
    const claude = serviceFor(new ClaudeCliProvider("claude-cli", { command, args: ["-p"], timeout_ms: 20000 }, runtime())).judgeIdentity();
    const store = { getJudgeVerdict: async () => null, insertJudgeVerdictIfAbsent: async () => null, replaceJudgeVerdictIfEquals: async () => null, pruneJudgeVerdictsNotReadSince: async () => null };
    const none = new UnitLedger(store as never, claude, "plan@t#1", () => new Date(), "template");
    expect(none.enabled).toBe(false);
    expect(none.disabledCause).toContain("ai.assess.model");
    const custom = serviceFor(new ClaudeCliProvider("claude-cli", { command: stubClaude("x", "my-judge.sh").command, args: [], timeout_ms: 20000 }, runtime()), "m").judgeIdentity();
    const off = new UnitLedger(store as never, custom, "plan@t#1", () => new Date(), "template");
    expect(off.enabled).toBe(false);
    expect(off.disabledCause).toMatch(/does not report the model/);
  });
});
