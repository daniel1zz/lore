/**
 * `lore set --refine/--regenerate` on a locked record — the gate refuses BEFORE the paid AI call.
 *
 * Spec: spec-documents-are-living-or-records-a-locked-record-is-never (D4, D15). Rules: BR-1048, BR-1050.
 *
 * Dimensions:
 *   NEGATIVE    approved retro + --refine and no --correction -> exit 4, AI seam never invoked
 *   NEGATIVE    approved retro + --regenerate -> exit 4, AI seam never invoked
 *   ERROR       --correction + --refine -> usage error exit 2 naming both flags, AI seam never invoked
 *   REGRESSION  a living doc + --refine still reaches the AI seam (the pre-flight does not block it)
 *
 * The AI seam is `AIProviderService.prototype.refineContent/regenerateContent`, spied per test; `--ai` is
 * placed on process.argv because set.ts reads the tri-state from argv.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { liveInvocation } from "../../live-invocation.js";
import type { Invocation } from "@lore/core";

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

/** The AI seam answers with an error so a (wrongly) reached call never hangs on a real provider. */
const AI_STUB_ERROR = { ok: false, error: { code: "STORE_ERROR", message: "stubbed ai" } };

function stubRefine() {
  return vi.spyOn(AIProviderService.prototype, "refineContent").mockResolvedValue(AI_STUB_ERROR as never);
}

let tmpDir: string;
let originalCwd: string;
let originalArgv: string[];

function silence(): { stderr: string[]; restore: () => void } {
  const stderr: string[] = [];
  const e = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  const l = vi.spyOn(console, "log").mockImplementation(() => undefined);
  return {
    stderr,
    restore: () => {
      e.mockRestore();
      l.mockRestore();
    },
  };
}

// reason: a template-literal dynamic import is not resolvable by vite under the Bun runtime
// ("Unknown variable dynamic import"); a literal per command keeps the lazy load and the module graph static.
const COMMAND_LOADERS = {
  create: () => import("../../../src/adapters/cli/commands/create.js"),
  init: () => import("../../../src/adapters/cli/commands/init.js"),
  set: () => import("../../../src/adapters/cli/commands/set.js"),
} as const;

async function importCmd(file: keyof typeof COMMAND_LOADERS): Promise<RunnableCommand> {
  const mod = (await COMMAND_LOADERS[file]()) as { default?: RunnableCommand };
  if (!mod.default?.run) throw new Error(`${file} command not exported`);
  return mod.default;
}

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

async function run(cmd: RunnableCommand, args: Record<string, unknown>): Promise<string> {
  const out = silence();
  // reason: set.ts reports usage errors with process.exit(2); surface it as the exit code instead of killing the runner.
  const exit = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null): never => {
    throw new ExitSignal(typeof code === "number" ? code : 0);
  });
  try {
    await cmd.run({ args, inv: liveInvocation() });
  } catch (e: unknown) {
    if (!(e instanceof ExitSignal)) throw e;
    process.exitCode = e.code;
  } finally {
    exit.mockRestore();
    out.restore();
  }
  return out.stderr.join("");
}

async function createDoc(args: Record<string, unknown>): Promise<string> {
  const create = await importCmd("create");
  const lines: string[] = [];
  const l = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  const e = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await create.run({ args: { ai: false, ...args }, inv: liveInvocation() });
  } finally {
    l.mockRestore();
    e.mockRestore();
  }
  const slug = lines.join("\n").match(/(?:knowledge|prd)-[\w-]+/)?.[0];
  if (slug === undefined) throw new Error(`no slug in create output: ${lines.join("\n")}`);
  return slug;
}

beforeEach(async () => {
  process.exitCode = 0;
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-set-preflight-"));
  originalCwd = process.cwd();
  originalArgv = process.argv;
  process.chdir(tmpDir);
  process.argv = [...originalArgv, "--ai"];
  const init = await importCmd("init");
  const out = silence();
  try {
    await init.run({ args: { name: "preflight-corpus", description: "" }, inv: liveInvocation() });
  } finally {
    out.restore();
  }
});

afterEach(() => {
  process.exitCode = 0;
  process.argv = originalArgv;
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("lore set AI rewrite on a locked record", () => {
  it("NEGATIVE: --refine on an approved retro exits 4 and never invokes the AI seam", async () => {
    const refine = stubRefine();
    const slug = await createDoc({ type: "knowledge", "sub-type": "retro", title: "A retro", content: "what happened" });
    const set = await importCmd("set");

    const stderr = await run(set, { id: slug, refine: "make it shorter" });

    expect(refine).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(4);
    expect(stderr).toContain("locked record");
  });

  it("NEGATIVE: --regenerate on an approved retro exits 4 and never invokes the AI seam", async () => {
    const regen = vi
      .spyOn(AIProviderService.prototype, "regenerateContent")
      .mockResolvedValue(AI_STUB_ERROR as never);
    const slug = await createDoc({ type: "knowledge", "sub-type": "retro", title: "A retro", content: "what happened" });
    const set = await importCmd("set");

    await run(set, { id: slug, regenerate: true });

    expect(regen).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(4);
  });

  it("ERROR: --correction + --refine is a usage error (exit 2) naming both flags, AI seam never invoked", async () => {
    const refine = stubRefine();
    const slug = await createDoc({ type: "knowledge", "sub-type": "retro", title: "A retro", content: "what happened" });
    const set = await importCmd("set");

    const stderr = await run(set, { id: slug, refine: "shorter", correction: "typo" });

    expect(refine).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    expect(stderr).toContain("--correction");
    expect(stderr).toContain("--refine");
  });

  it("REGRESSION: a living doc + --refine still reaches the AI seam", async () => {
    const refine = stubRefine();
    const slug = await createDoc({ type: "prd", title: "Living prd", content: "## Overview\n\nbody" });
    const set = await importCmd("set");

    await run(set, { id: slug, refine: "shorter" });

    expect(refine).toHaveBeenCalledTimes(1);
  });
});
