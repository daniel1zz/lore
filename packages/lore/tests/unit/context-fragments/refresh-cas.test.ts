/**
 * @spec_ref AC-CF-13
 *
 * RED suite: `runContextRefresh` writes each lore rules file (`.claude/rules/lore-<id>.md`) compare-and-swap
 * (D15 re-baseline, owner decision 2026-10-07: was CLAUDE.md Z1 section CAS)
 * (spec-context-fragments-config-driven-layered-rule-injection, D8 + AC-CF-13,
 * task task-skill-test-refresh-cas-red-lost-update-refusal).
 *
 * Spec statements encoded (written before reading the new behaviour, which
 * does not exist yet):
 *   - D8: read file + hash -> splice -> write ONLY if the on-disk hash is
 *     unchanged, else refuse with `CONFLICT`; a lost update is impossible.
 *   - AC-CF-13: an interleaved write between refresh's read and its write
 *     -> err CONFLICT, and the file equals the interleaved writer's bytes.
 *   - AC-CF-6 / D15 (used only as the no-interleave control): the refreshed
 *     rules file starts with the `lore:managed fragment=<id> hash=<8hex>`
 *     fingerprint line and carries the fragment body.
 *
 * Deps shape assumed from the spec ("Deps (all injected)"): `fs`,
 * `assetsRoot`, `globalConfig`, `projectConfig` (+ home/xdgConfigHome/
 * claudeSettings, supplied as inert values). Shipped fragments are read from
 * `<assetsRoot>/context/*.md` (spec file map `assets/context/*.md`). The
 * third argument `{ scope: "project" }` follows the spec's
 * `runContextRefresh(deps, root, { scope })`.
 *
 * MOCK RISK: the fake fs only models read/write ordering; it cannot model a
 * real kernel-level race. The interleave fires on the FIRST read of the rules file
 * after arming, so it lands between refresh's read and its write regardless
 * of how many further reads the implementation does.
 */

import { describe, expect, it } from "vitest";
import { InMemoryFsPort } from "@lore/core";
import type { FsWritePort, LoreError, Result } from "@lore/core";
import { runContextInit, runContextRefresh } from "../../../src/flows/context-flow.js";

const FRAGMENT_MD =
  "---\nid: cas-probe-rule\ntitle: CAS probe rule\ninject: [launch]\n---\n" +
  "Sentinel body CAS-PROBE-7731.\n";

const RULES_FILE = ".claude/rules/lore-cas-probe-rule.md";

/** Fs whose rules-file bytes are replaced by `interleaved` right after the first read once armed. */
class InterleavingFs implements FsWritePort {
  private armed = false;
  private fired = false;
  writes: Array<{ path: string; content: string }> = [];

  constructor(
    private readonly inner: InMemoryFsPort,
    private readonly interleaved: string | null,
  ) {}

  arm(): void {
    this.armed = true;
  }

  async readFile(path: string): Promise<string | null> {
    const value = await this.inner.readFile(path);
    if (this.armed && !this.fired && path === RULES_FILE && this.interleaved !== null) {
      this.fired = true;
      await this.inner.writeFile(path, this.interleaved); // the other writer lands AFTER our read
    }
    return value;
  }
  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }
  listDir(path: string): Promise<string[]> {
    return this.inner.listDir(path);
  }
  async writeFile(path: string, content: string): Promise<Result<void, LoreError>> {
    this.writes.push({ path, content });
    return this.inner.writeFile(path, content);
  }
}

async function setup(interleaved: string | null) {
  const inner = new InMemoryFsPort({ "assets/context/cas-probe-rule.md": FRAGMENT_MD });
  const fs = new InterleavingFs(inner, interleaved);
  const init = await runContextInit({ fs }, "", {});
  expect(init.ok).toBe(true);
  fs.writes.length = 0;
  // Spec deps (assetsRoot/configs/...) are not on the current ContextFlowDeps type; red until D8 lands.
  const deps = {
    fs,
    assetsRoot: "assets",
    home: "/home/test",
    xdgConfigHome: "/home/test/.config",
    globalConfig: {},
    projectConfig: {},
    claudeSettings: { read: async () => ({}) },
  } as unknown as Parameters<typeof runContextRefresh>[0];
  return { inner, fs, deps };
}

describe("AC-CF-13 refresh is compare-and-swap (D8)", () => {
  it("HAPPY: without interleaving, refresh returns ok and writes the lore rules file with fingerprint first line + fragment body", async () => {
    const { inner, deps } = await setup(null);
    const result = await runContextRefresh(deps, "", { scope: "project" } as never);
    expect(result.ok).toBe(true);
    const content = await inner.readFile(RULES_FILE);
    expect(content).toMatch(/^<!-- lore:managed fragment=cas-probe-rule hash=[0-9a-f]{8} -->\n/);
    expect(content).toContain("CAS-PROBE-7731");
    expect(await inner.readFile("CLAUDE.md")).not.toContain("CAS-PROBE-7731");
  });

  it.each([
    ["first interleaved writer", "# someone else wrote this first\n"],
    ["a different interleaved writer", "# totally different bytes\n\nwith two paragraphs\n"],
  ])("NEGATIVE: %s between read and write -> err CONFLICT and the rules file equals the interleaved bytes", async (_label, bytes) => {
    const { inner, fs, deps } = await setup(bytes);
    fs.arm();
    const result = await runContextRefresh(deps, "", { scope: "project" } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { code: string }).code).toBe("CONFLICT");
    expect(await inner.readFile(RULES_FILE)).toBe(bytes);
  });

  it("STATE: a refused refresh performs no write to the contested rules file (lost update impossible, not merely repaired afterwards)", async () => {
    const { fs, deps } = await setup("# interleaved\n");
    fs.arm();
    await runContextRefresh(deps, "", { scope: "project" } as never);
    expect(fs.writes.filter((w) => w.path === RULES_FILE)).toEqual([]);
  });

  it("REGRESSION: after a CONFLICT, an immediate retry (no interleaving) succeeds and never clobbers the interleaved writer's file — retry is safe", async () => {
    const { inner, fs, deps } = await setup("# interleaved\n");
    fs.arm();
    const first = await runContextRefresh(deps, "", { scope: "project" } as never);
    expect(first.ok).toBe(false);
    const second = await runContextRefresh(deps, "", { scope: "project" } as never);
    expect(second.ok).toBe(true);
    // The interleaved bytes carry no valid fingerprint -> D15(b): untouched (diverged_skip), not overwritten.
    expect(await inner.readFile(RULES_FILE)).toBe("# interleaved\n");
  });
});
