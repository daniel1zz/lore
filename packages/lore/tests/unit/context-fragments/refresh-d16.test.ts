// @layer unit-refresh-flow (in-process refresh service; owner drives the compiled dist/lore)
/**
 * @spec_ref AC-CF-22
 *
 * D16 (spec-context-fragments-config-driven-layered-rule-injection, task
 * task-skill-implement-d16-rules-writes-independent-of-claude-md): the lore rules-file write set
 * of `runContextRefresh` is INDEPENDENT of the CLAUDE.md Z1 splice. When the AC-CTX-8 ceiling
 * admission refuses the CLAUDE.md candidate, the rules files are still written, CLAUDE.md stays
 * byte-unchanged, and the returned error names the CLAUDE.md refusal and lists the rules files
 * written. A CAS conflict on any rules file still suppresses ALL rules writes (D8).
 *
 * MOCK RISK: in-memory fs only models read/write ordering, not a kernel-level race.
 */

import { describe, expect, it } from "vitest";
import { InMemoryFsPort, resolveMemoryFileBudgets } from "@lore/core";
import type { FsWritePort } from "@lore/core";
import { runContextRefresh } from "../../../src/flows/context-flow.js";

const FRAGMENT_A = "---\nid: d16-a\ntitle: D16 A\naudience: [main]\nmode: static\n---\nSentinel body D16-A-1.\n";
const FRAGMENT_B = "---\nid: d16-b\ntitle: D16 B\naudience: [main]\nmode: static\n---\nSentinel body D16-B-1.\n";
const RULES_A = ".claude/rules/lore-d16-a.md";
const RULES_B = ".claude/rules/lore-d16-b.md";

/** Hand-written CLAUDE.md with no Z1 markers, long enough that the appended Z1 block breaches the root ceiling. */
const OVERSIZE_CLAUDE_MD = `# Hand written\n\n${Array.from({ length: 400 }, (_, i) => `rule line ${i}`).join("\n")}\n`;
/** Small CLAUDE.md carrying every root-required section, so `enforce` admits the spliced candidate. */
const SMALL_CLAUDE_MD =
  "# Hand written\n\n" +
  ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
    .map((heading) => `## ${heading}\n\nshort\n`)
    .join("\n");

/** Fs that rewrites `RULES_B` right after its first read once armed (an interleaving writer). */
class InterleavingFs implements FsWritePort {
  armed = false;
  private fired = false;
  writes: string[] = [];
  constructor(private readonly inner: InMemoryFsPort) {}
  async readFile(path: string): Promise<string | null> {
    const value = await this.inner.readFile(path);
    if (this.armed && !this.fired && path === RULES_B) {
      this.fired = true;
      await this.inner.writeFile(path, "# someone else\n");
    }
    return value;
  }
  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }
  listDir(path: string): Promise<string[]> {
    return this.inner.listDir(path);
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.writes.push(path);
    await this.inner.writeFile(path, content);
  }
}

/** Schema-default budgets with adoption `enforce`: the default `warn` downgrades the ceiling to advisory. */
const ENFORCE_BUDGETS = { ...resolveMemoryFileBudgets(undefined), adoption: "enforce" as const };

/** `LoreError` is a union and not every variant carries `message`. */
function messageOf(error: object): string {
  return "message" in error && typeof error.message === "string" ? error.message : "";
}

function buildDeps(fs: FsWritePort) {
  return {
    fs,
    budgets: ENFORCE_BUDGETS,
    assetsRoot: "assets",
    home: "/home/test",
    xdgConfigHome: "/home/test/.config",
    globalConfig: {},
    projectConfig: {},
    claudeSettings: { read: async () => ({}) },
  } as unknown as Parameters<typeof runContextRefresh>[0];
}

function setup(claudeMd: string) {
  const inner = new InMemoryFsPort({
    "assets/context/d16-a.md": FRAGMENT_A,
    "assets/context/d16-b.md": FRAGMENT_B,
    "CLAUDE.md": claudeMd,
  });
  const fs = new InterleavingFs(inner);
  return { inner, fs, deps: buildDeps(fs) };
}

describe("AC-CF-22 rules writes are independent of the CLAUDE.md ceiling refusal (D16)", () => {
  it("NEGATIVE+HAPPY: ceiling refusal on CLAUDE.md -> err naming CLAUDE.md and the rules files written; rules written; CLAUDE.md byte-unchanged", async () => {
    const { inner, deps } = setup(OVERSIZE_CLAUDE_MD);
    const result = await runContextRefresh(deps, "", { scope: "project" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(messageOf(result.error)).toContain("refusing to write CLAUDE.md");
    expect(messageOf(result.error)).toContain("ceiling");
    expect(messageOf(result.error)).toContain(RULES_A);
    expect(messageOf(result.error)).toContain(RULES_B);
    expect(await inner.readFile(RULES_A)).toMatch(/^<!-- lore:managed fragment=d16-a hash=[0-9a-f]{8} -->\n/);
    expect(await inner.readFile(RULES_B)).toContain("D16-B-1");
    expect(await inner.readFile("CLAUDE.md")).toBe(OVERSIZE_CLAUDE_MD);
  });

  it("REGRESSION control: a small CLAUDE.md still returns ok, splices Z1 and writes the rules files", async () => {
    const { inner, deps } = setup(SMALL_CLAUDE_MD);
    const result = await runContextRefresh(deps, "", { scope: "project" });
    expect(result.ok ? "ok" : messageOf(result.error)).toBe("ok"); // surfaces the refusal text on failure
    expect(await inner.readFile(RULES_A)).toContain("D16-A-1");
    expect(await inner.readFile("CLAUDE.md")).not.toBe(SMALL_CLAUDE_MD);
  });

  it("STATE: a CAS conflict on one rules file suppresses ALL rules writes even when CLAUDE.md is refused", async () => {
    const { inner, fs, deps } = setup(OVERSIZE_CLAUDE_MD);
    fs.armed = true;
    const result = await runContextRefresh(deps, "", { scope: "project" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CONFLICT");
    expect(fs.writes).toEqual([]);
    expect(await inner.readFile(RULES_A)).toBeNull();
    expect(await inner.readFile("CLAUDE.md")).toBe(OVERSIZE_CLAUDE_MD);
  });

  it("rulesOnly: returns ok, writes the rules files, never reads/splices CLAUDE.md (even oversize or absent); without fragment deps it fails loud", async () => {
    const { inner, deps } = setup(OVERSIZE_CLAUDE_MD);
    const result = await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    expect(result.ok ? "ok" : messageOf(result.error)).toBe("ok");
    expect(await inner.readFile(RULES_A)).toContain("D16-A-1");
    expect(await inner.readFile("CLAUDE.md")).toBe(OVERSIZE_CLAUDE_MD);

    const noClaudeMd = new InMemoryFsPort({ "assets/context/d16-a.md": FRAGMENT_A });
    const ok = await runContextRefresh(buildDeps(new InterleavingFs(noClaudeMd)), "", { scope: "project", rulesOnly: true });
    expect(ok.ok).toBe(true);
    expect(await noClaudeMd.readFile("CLAUDE.md")).toBeNull();

    const bare = await runContextRefresh({ fs: new InterleavingFs(inner) }, "", { scope: "project", rulesOnly: true });
    expect(bare.ok).toBe(false);
  });

  it("BOUNDARY: ceiling refusal with NO fragment deps (nothing to write) keeps the plain refusal and writes nothing", async () => {
    const inner = new InMemoryFsPort({ "CLAUDE.md": OVERSIZE_CLAUDE_MD });
    const fs = new InterleavingFs(inner);
    const result = await runContextRefresh({ fs, budgets: ENFORCE_BUDGETS } as Parameters<typeof runContextRefresh>[0], "",{ scope: "project" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(messageOf(result.error)).toContain("refusing to write CLAUDE.md");
    expect(fs.writes).toEqual([]);
  });
});
