/**
 * Unit suite for `runContextInit` / `runContextRefresh`
 * (`packages/lore/src/flows/context-flow.ts`,
 * spec-context-verb-family-two-zone-claude-md-anatomy-lore). Exercises the
 * flow against `InMemoryFsPort` (`@lore/core`) — the compiled-binary e2e
 * (`tests/e2e/context-verbs-compiled.bun.test.ts`, AC-CTX-3) covers the real
 * `node:fs` + AI-orchestration path end to end; this suite pins the flow's
 * OWN deterministic contract in isolation (no AI, no real disk).
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   §Public Interface, §Design Decisions D1/D2/D3/D5; task
 *   task-skill-implement-context-facts-collection-flow.
 */

import { describe, expect, it } from "vitest";
import { CLAUDE_MD_MARKER_END, CLAUDE_MD_MARKER_START, InMemoryFsPort } from "@lore/core";
import { runContextInit, runContextRefresh } from "../../../src/flows/context-flow.js";

describe("runContextInit", () => {
  it("HAPPY: writes a fresh CLAUDE.md with the managed zone and a skeleton narrative when no narrative is resolved", async () => {
    const fs = new InMemoryFsPort({});
    const result = await runContextInit({ fs }, "", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.narrative).toBe("skeleton");
    const content = await fs.readFile("CLAUDE.md");
    expect(content).not.toBeNull();
    expect(content).toContain(CLAUDE_MD_MARKER_START);
    expect(content).toContain(CLAUDE_MD_MARKER_END);
    expect(content?.endsWith("\n")).toBe(true);
    expect(content).toContain("placeholder");
  });

  it("HAPPY: an explicitly resolved narrative becomes the Z2 placeholder content", async () => {
    const fs = new InMemoryFsPort({});
    const result = await runContextInit({ fs }, "", { narrative: "# My Rules\n\nNever do X.\n" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.narrative).toBe("generated");
    const content = await fs.readFile("CLAUDE.md");
    expect(content).toContain("Never do X.");
  });

  it("NEGATIVE: refuses to re-init when CLAUDE.md already exists and --force was not passed", async () => {
    const fs = new InMemoryFsPort({ "CLAUDE.md": "# hand-written\n" });
    const result = await runContextInit({ fs }, "", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    // Never touched the existing file on refusal.
    expect(await fs.readFile("CLAUDE.md")).toBe("# hand-written\n");
  });

  it("STATE: --force re-init preserves the existing file's bytes as Z2 and ignores any resolved narrative", async () => {
    const fs = new InMemoryFsPort({ "CLAUDE.md": "# hand-written prose\n" });
    const result = await runContextInit({ fs }, "", { narrative: "IGNORE ME", force: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.narrative).toBe("existing");
    const content = await fs.readFile("CLAUDE.md");
    expect(content).toContain("# hand-written prose");
    expect(content).not.toContain("IGNORE ME");
  });
});

describe("runContextRefresh", () => {
  it("ERROR: fails loud when no CLAUDE.md exists yet, naming `lore context init`", async () => {
    const fs = new InMemoryFsPort({});
    const result = await runContextRefresh({ fs }, "");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toContain("lore context init");
  });

  it("REGRESSION: refresh immediately after init is idempotent (byte-identical content, every section unchanged)", async () => {
    const fs = new InMemoryFsPort({});
    const initResult = await runContextInit({ fs }, "", {});
    expect(initResult.ok).toBe(true);
    const before = await fs.readFile("CLAUDE.md");

    const refreshResult = await runContextRefresh({ fs }, "");
    expect(refreshResult.ok).toBe(true);
    if (!refreshResult.ok) return;
    expect(refreshResult.value.sections.every((s) => s.state === "unchanged")).toBe(true);

    const after = await fs.readFile("CLAUDE.md");
    expect(after).toBe(before);
  });

  it("BOUNDARY: a hand-edit inside a managed section reports diverged_skip and leaves file bytes untouched", async () => {
    const fs = new InMemoryFsPort({});
    await runContextInit({ fs }, "", {});
    const original = await fs.readFile("CLAUDE.md");
    expect(original).not.toBeNull();

    const lines = (original as string).split("\n");
    const fingerprintLineIdx = lines.findIndex((line) => line.includes("section=module-index "));
    expect(fingerprintLineIdx).toBeGreaterThanOrEqual(0);
    lines[fingerprintLineIdx + 1] = `${lines[fingerprintLineIdx + 1]} <<< HAND EDIT >>>`;
    const handEdited = lines.join("\n");
    await fs.writeFile("CLAUDE.md", handEdited);

    const refreshResult = await runContextRefresh({ fs }, "");
    expect(refreshResult.ok).toBe(true);
    if (!refreshResult.ok) return;
    const moduleIndexState = refreshResult.value.sections.find((s) => s.id === "module-index")?.state;
    expect(moduleIndexState).toBe("diverged_skip");

    const after = await fs.readFile("CLAUDE.md");
    expect(after).toBe(handEdited);
  });

  // ─── AC-CTX-8: refresh pre-write admission (claude-md ceiling) ─────────────
  // Pins the second half of knowledge-retro-context-refresh-module-index-
  // walk-pollutes: `lore context refresh` spliced a 501-line/40,937-byte
  // CLAUDE.md and wrote it with exit 0, even though `lore status
  // --check-claude-md` immediately reported BREACHED against the same
  // config-sourced ceiling. `contextRefresh` must run that same admission
  // check (claude-md-check.ts's `lintMemoryFiles`, root ceiling via
  // `resolveMemoryFileBudgets(undefined)` — the same defaults
  // `collectContextFacts` already reads, default root: max_lines 300 /
  // max_bytes 30720) on the SPLICED candidate BEFORE writing.
  //
  // `renderModuleIndexBody` emits exactly one bullet line per discovered
  // top-level module directory with no other content growth, so a fixture of
  // N single-file top-level directories deterministically adds exactly N
  // lines to the spliced candidate on top of the 15-line zero-module
  // baseline (measured directly against current src): 285 modules lands
  // EXACTLY at the 300-line ceiling; 286 lands one line over it.

  /** Mirrors claude-md-check.ts's own line-counting convention (module header: "mirrors receipt-log.ts's established convention"). */
  function countLines(content: string): number {
    const parts = content.split("\n");
    return content.endsWith("\n") ? parts.length - 1 : parts.length;
  }

  /** Grows `fs`'s tree by `count` distinct single-file top-level module directories (`m0000/x.ts`, `m0001/x.ts`, ...). */
  async function growModuleIndex(fs: InMemoryFsPort, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await fs.writeFile(`m${String(i).padStart(4, "0")}/x.ts`, "x");
    }
  }

  it("BOUNDARY: a splice landing exactly at the root max_lines ceiling still writes; one line past it is refused", async () => {
    // Side A — exactly at the ceiling (300 lines): allowed, byte-identical to
    // pre-change behavior. Already green under current src on its own (today
    // there is no ceiling check at all) — this half is a non-regression
    // anchor, not a RED signal by itself.
    const atCeilingFs = new InMemoryFsPort({});
    await runContextInit({ fs: atCeilingFs }, "", {});
    await growModuleIndex(atCeilingFs, 285);
    const atCeilingResult = await runContextRefresh({ fs: atCeilingFs }, "");
    expect(atCeilingResult.ok).toBe(true);
    if (atCeilingResult.ok) {
      const atCeilingContent = await atCeilingFs.readFile("CLAUDE.md");
      expect(atCeilingContent).not.toBeNull();
      expect(countLines(atCeilingContent as string)).toBe(300);
    }

    // Side B — one line past the ceiling (301 lines): must be refused with NO
    // write. RED under current src: today's refresh writes unconditionally
    // and returns ok:true here too (verified against current src: n=286 ->
    // refresh.ok=true, afterLines=301, unchanged=false).
    const overCeilingFs = new InMemoryFsPort({});
    await runContextInit({ fs: overCeilingFs }, "", {});
    const beforeOverCeiling = await overCeilingFs.readFile("CLAUDE.md");
    await growModuleIndex(overCeilingFs, 286);
    const overCeilingResult = await runContextRefresh({ fs: overCeilingFs }, "");
    expect(overCeilingResult.ok).toBe(false);
    const afterOverCeiling = await overCeilingFs.readFile("CLAUDE.md");
    expect(afterOverCeiling).toBe(beforeOverCeiling);
  });

  it("NEGATIVE: a would-be ceiling breach names the findings in a non-ok Result and performs NO write", async () => {
    const fs = new InMemoryFsPort({});
    await runContextInit({ fs }, "", {});
    const before = await fs.readFile("CLAUDE.md");

    // 320 modules is comfortably over the 300-line root ceiling (35 lines
    // over), isolating "clearly breached" from the exact boundary pinned by
    // the BOUNDARY case above.
    await growModuleIndex(fs, 320);

    const refreshResult = await runContextRefresh({ fs }, "");
    // RED under current src: today this returns ok:true and writes (verified
    // against current src via the same 285/286-module harness above scaled
    // up — current runContextRefresh has no admission check to refuse with).
    expect(refreshResult.ok).toBe(false);
    if (refreshResult.ok) return;
    // Every other refusal in this module (already-exists, no-CLAUDE.md-yet)
    // uses VALIDATION_ERROR with a human-readable `message` — the same
    // family is the natural fit here (LoreError has no dedicated
    // ceiling-breach code); the message must name what breached, mirroring
    // lintMemoryFiles's own wording ("... exceeding the ... ceiling of ...").
    expect(refreshResult.error.code).toBe("VALIDATION_ERROR");
    if (refreshResult.error.code !== "VALIDATION_ERROR") return;
    expect(refreshResult.error.message).toMatch(/ceiling/i);

    const after = await fs.readFile("CLAUDE.md");
    expect(after).toBe(before);
  });

  it("STATE: a within-budget refresh writes exactly as before the admission check existed", async () => {
    // Already green under current src by construction (AC-CTX-8's own text:
    // "a within-budget splice writes as before / byte-identical to
    // pre-change behavior") — a non-regression anchor for the admission
    // check's non-interference with the ordinary path, not a RED signal.
    const fs = new InMemoryFsPort({
      "packages/core/CLAUDE.md": "# core",
      "packages/lore/src/index.ts": "export {};",
    });
    const initResult = await runContextInit({ fs }, "", {});
    expect(initResult.ok).toBe(true);
    const before = await fs.readFile("CLAUDE.md");

    const refreshResult = await runContextRefresh({ fs }, "");
    expect(refreshResult.ok).toBe(true);
    if (!refreshResult.ok) return;
    expect(refreshResult.value.sections.every((s) => s.state === "unchanged")).toBe(true);

    const after = await fs.readFile("CLAUDE.md");
    expect(after).toBe(before);
  });
});
