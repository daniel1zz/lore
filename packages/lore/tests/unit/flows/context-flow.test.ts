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
import { CLAUDE_MD_MARKER_END, CLAUDE_MD_MARKER_START, InMemoryFsPort, resolveMemoryFileBudgets } from "@lore/core";
import { runContextInit, runContextRefresh } from "../../../src/flows/context-flow.js";

/**
 * A Z2 narrative that carries the three root sections the managed zone does not supply, so the init'd file CONFORMS to the
 * required-section structure: limits are always enforced, so a refresh of a nonconforming file is refused.
 */
const CONFORMING_NARRATIVE = "## What This Is\n\nA fixture.\n\n## Commands\n\n- make test\n\n## Architecture\n\nLayers.\n";

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
    const initResult = await runContextInit({ fs }, "", { narrative: CONFORMING_NARRATIVE });
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
    await runContextInit({ fs }, "", { narrative: CONFORMING_NARRATIVE });
    const original = await fs.readFile("CLAUDE.md");
    expect(original).not.toBeNull();

    const lines = (original as string).split("\n");
    const fingerprintLineIdx = lines.findIndex((line) => line.includes("section=module-index "));
    expect(fingerprintLineIdx).toBeGreaterThanOrEqual(0);
    // reason: edit the section's BODY, not its `## Module Index` heading: a mangled heading would make the required
    // section vanish, and limits are always enforced, so the refresh would be refused instead of reporting diverged_skip.
    const headingIdx = lines.findIndex((line, i) => i > fingerprintLineIdx && line.startsWith("## "));
    const bodyIdx = lines.findIndex((line, i) => i > headingIdx && line.trim() !== "" && !line.startsWith("<!--"));
    expect(bodyIdx).toBeGreaterThan(headingIdx);
    lines[bodyIdx] = `${lines[bodyIdx]} <<< HAND EDIT >>>`;
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

  /**
   * Grows `fs`'s module index by `count` distinct top-level module directories that each carry a memory file
   * (`m0000/CLAUDE.md`, ...): since spec-module-index-lists-only-folders-with-a-memory-file-managed only such
   * folders get an index line.
   */
  async function growModuleIndex(fs: InMemoryFsPort, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await fs.writeFile(`m${String(i).padStart(4, "0")}/CLAUDE.md`, "# m\n\n## Purpose\n\nx.\n");
    }
  }

  it("BOUNDARY: a splice landing one line under the root eviction floor still writes; at the floor it is refused", async () => {
    // task-a-module-claude-md-at-its-byte-ceiling-silently-relocates moved the
    // lowest DETERMINISTIC admission boundary from the ceiling down to the
    // eviction floor (`evict_threshold_fraction`, default 0.97 -> 291 lines of
    // the 300-line root ceiling). The proposition this case pins is unchanged —
    // one unit under the lowest refusing boundary writes, at it refuses — only
    // the boundary itself moved. Derived from config, never a literal, so a
    // config change moves the fixture with it.
    const budgets = resolveMemoryFileBudgets(undefined);
        const lineFloor = Math.ceil(budgets.root.max_lines * budgets.evict_threshold_fraction);
    // `renderModuleIndexBody` adds exactly one line per memory-file module dir on top of a fixed baseline once at
    // least one module is listed; the baseline is MEASURED from one refresh, never a literal.
    const probeFs = new InMemoryFsPort({});
    await runContextInit({ fs: probeFs }, "", { narrative: CONFORMING_NARRATIVE });
    await growModuleIndex(probeFs, 1);
    expect((await runContextRefresh({ fs: probeFs }, "")).ok).toBe(true);
    const BASELINE_LINES = countLines((await probeFs.readFile("CLAUDE.md")) as string) - 1;
    const modulesForLines = (lines: number): number => lines - BASELINE_LINES;

    // Side A — one line under the floor: allowed.
    const underFloorFs = new InMemoryFsPort({});
    await runContextInit({ fs: underFloorFs }, "", { narrative: CONFORMING_NARRATIVE });
    await growModuleIndex(underFloorFs, modulesForLines(lineFloor - 1));
    const underFloorResult = await runContextRefresh({ fs: underFloorFs }, "");
    expect(underFloorResult.ok).toBe(true);
    if (underFloorResult.ok) {
      const underFloorContent = await underFloorFs.readFile("CLAUDE.md");
      expect(underFloorContent).not.toBeNull();
      expect(countLines(underFloorContent as string)).toBe(lineFloor - 1);
    }

    // Side B — exactly AT the floor: must be refused with NO write.
    const atFloorFs = new InMemoryFsPort({});
    await runContextInit({ fs: atFloorFs }, "", { narrative: CONFORMING_NARRATIVE });
    const beforeAtFloor = await atFloorFs.readFile("CLAUDE.md");
    await growModuleIndex(atFloorFs, modulesForLines(lineFloor));
    const atFloorResult = await runContextRefresh({ fs: atFloorFs, budgets }, "");
    expect(atFloorResult.ok).toBe(false);
    if (!atFloorResult.ok && atFloorResult.error.code === "VALIDATION_ERROR") {
      expect(atFloorResult.error.message).toMatch(/ceiling of|eviction floor/i);
    }
    const afterAtFloor = await atFloorFs.readFile("CLAUDE.md");
    expect(afterAtFloor).toBe(beforeAtFloor);

    // Side C (REGRESSION) — one line past the CEILING is still refused, so
    // arming the floor did not replace the ceiling check with a weaker one.
    const overCeilingFs = new InMemoryFsPort({});
    await runContextInit({ fs: overCeilingFs }, "", { narrative: CONFORMING_NARRATIVE });
    const beforeOverCeiling = await overCeilingFs.readFile("CLAUDE.md");
    await growModuleIndex(overCeilingFs, modulesForLines(budgets.root.max_lines + 1));
    const overCeilingResult = await runContextRefresh({ fs: overCeilingFs, budgets }, "");
    expect(overCeilingResult.ok).toBe(false);
    expect(await overCeilingFs.readFile("CLAUDE.md")).toBe(beforeOverCeiling);
  });

  it("NEGATIVE: a would-be ceiling breach names the findings in a non-ok Result and performs NO write", async () => {
    const fs = new InMemoryFsPort({});
    await runContextInit({ fs }, "", { narrative: CONFORMING_NARRATIVE });
    const before = await fs.readFile("CLAUDE.md");

    // 320 modules is comfortably over the 300-line root ceiling (35 lines
    // over), isolating "clearly breached" from the exact boundary pinned by
    // the BOUNDARY case above.
    await growModuleIndex(fs, 320);

    const refreshResult = await runContextRefresh({ fs, budgets: resolveMemoryFileBudgets(undefined) }, "");
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

  // ─── AC-CTX-8 config gap: threaded `deps.budgets` must be the admission
  // source, never the schema-default fallback ─────────────────────────────
  // AC-CTX-8 requires `runContextRefresh` to admit against the SAME budget
  // source as `lore status --check-claude-md` (config-aware, e.g. this
  // repo's `.lore/config.yaml` override root.max_lines: 220). Before the
  // fix, both `collectContextFacts` and the admission check always called
  // `resolveMemoryFileBudgets(undefined)` internally — a config override
  // tightening `root.max_lines` below a candidate's size (while the
  // candidate stays under the schema DEFAULT of 300) was silently ignored
  // and the write proceeded anyway.
  it("NEGATIVE: an injected budgets override tightening root.max_lines below the DEFAULT ceiling causes refresh to refuse", async () => {
    const fs = new InMemoryFsPort({});
    await runContextInit({ fs }, "", { narrative: CONFORMING_NARRATIVE });

    // Zero-module baseline is 15 lines (see the BOUNDARY case above); 50
    // modules lands at 65 lines — comfortably under the schema DEFAULT
    // root ceiling (300) but over a config-overridden root.max_lines: 60.
    await growModuleIndex(fs, 50);
    const before = await fs.readFile("CLAUDE.md");

    const defaultBudgets = resolveMemoryFileBudgets(undefined);
    const tightenedBudgets = { ...defaultBudgets, root: { ...defaultBudgets.root, max_lines: 60 } };

    // RED under pre-fix src: `runContextRefresh` ignored `deps.budgets`
    // entirely (always called `resolveMemoryFileBudgets(undefined)`
    // internally), so this returned ok:true and wrote the file — the exact
    // config-plumbing gap AC-CTX-8 names.
    const refreshResult = await runContextRefresh({ fs, budgets: tightenedBudgets }, "");
    expect(refreshResult.ok).toBe(false);
    if (refreshResult.ok) return;
    expect(refreshResult.error.code).toBe("VALIDATION_ERROR");
    if (refreshResult.error.code !== "VALIDATION_ERROR") return;
    expect(refreshResult.error.message).toMatch(/ceiling/i);

    const after = await fs.readFile("CLAUDE.md");
    expect(after).toBe(before);
  });

  it("REGRESSION: the same candidate under an untightened (default) budgets override still writes", async () => {
    const fs = new InMemoryFsPort({});
    await runContextInit({ fs }, "", { narrative: CONFORMING_NARRATIVE });
    await growModuleIndex(fs, 50);

    const defaultBudgets = resolveMemoryFileBudgets(undefined);
    const refreshResult = await runContextRefresh({ fs, budgets: defaultBudgets }, "");
    expect(refreshResult.ok).toBe(true);
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
    const initResult = await runContextInit({ fs }, "", { narrative: CONFORMING_NARRATIVE });
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
