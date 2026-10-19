/**
 * @spec_ref AC-STR-6
 *
 * The `lore context` write gate refuses a nonconforming root file ALWAYS: the adoption mode that once downgraded the
 * refusal to a written file plus an advisory `downgraded` finding is retired
 * (task-memory-file-limits-are-always-enforced-the-warn-adoption; spec
 * spec-claude-md-root-section-structure-check-and-adoption-mode AC-STR-6, whose warn half is superseded by BR-887).
 *
 *   - root CLAUDE.md candidate missing a required H2 -> the flow returns an error naming `section_missing`
 *     (and the section), and the target file bytes are UNCHANGED, with budgets resolved from schema defaults, with
 *     no budgets supplied at all, and with explicit budgets alike.
 *   - a conforming candidate is still written (the gate is not a blanket refusal) and reports nothing downgraded.
 *
 * The gate is `runContextRefresh` (the only context verb that runs pre-write admission).
 */

import { describe, expect, it } from "vitest";
import { InMemoryFsPort, resolveMemoryFileBudgets } from "@lore/core";
import { runContextRefresh } from "../../../src/flows/context-flow.js";

/** The five required root H2 sections, in contract order (spec Public Interface). */
const ALL_SECTIONS = ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"];

/** Builds a root CLAUDE.md whose H2 list is exactly `sections` (each with real body content). */
function rootFile(sections: readonly string[]): string {
  return `${sections.map((s) => `## ${s}\n\nBody text for ${s}.\n`).join("\n")}`;
}

/** Budgets as every project now resolves them: the schema defaults, with no adoption setting to choose. */
function budgetsWith(): ReturnType<typeof resolveMemoryFileBudgets> {
  return resolveMemoryFileBudgets(undefined);
}

const without = (name: string): string[] => ALL_SECTIONS.filter((s) => s !== name);

/**
 * The hand-written (Z2) required sections: `## Module Index` and `## Finding Live Project State` are emitted by the
 * managed zone itself (spec-module-index-lists-only-folders-with-a-memory-file-managed, AC-MI-2), so a candidate that
 * also hand-writes them would carry each twice (`section_duplicate`).
 */
const HAND_WRITTEN_SECTIONS = ALL_SECTIONS.filter((s) => s !== "Module Index" && s !== "Finding Live Project State");

describe("lore context write gate always refuses a nonconforming root file (AC-STR-6, BR-887)", () => {
  describe("explicit schema-default budgets", () => {
    it("NEGATIVE: refuses a candidate missing '## Commands' with an error naming section_missing", async () => {
      const fs = new InMemoryFsPort({ "CLAUDE.md": rootFile(without("Commands")) });
      const result = await runContextRefresh({ fs, budgets: budgetsWith() }, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(JSON.stringify(result.error)).toContain("section_missing");
    });

    it("NEGATIVE: the refusal names the missing section ('Commands')", async () => {
      const fs = new InMemoryFsPort({ "CLAUDE.md": rootFile(without("Commands")) });
      const result = await runContextRefresh({ fs, budgets: budgetsWith() }, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(JSON.stringify(result.error)).toContain("Commands");
    });

    it("STATE: a refused write leaves the target file bytes unchanged", async () => {
      const original = rootFile(without("Commands"));
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      await runContextRefresh({ fs, budgets: budgetsWith() }, "");
      expect(await fs.readFile("CLAUDE.md")).toBe(original);
    });

    it("NEGATIVE: a different missing section ('Architecture') is named, not a hardcoded 'Commands'", async () => {
      const original = rootFile(without("Architecture"));
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      const result = await runContextRefresh({ fs, budgets: budgetsWith() }, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const text = JSON.stringify(result.error);
      expect(text).toContain("section_missing");
      expect(text).toContain("Architecture");
      expect(await fs.readFile("CLAUDE.md")).toBe(original);
    });

    it("NEGATIVE: out-of-order sections (Commands placed after Architecture) are refused naming section_order", async () => {
      const swapped = ["What This Is", "Architecture", "Commands", "Module Index", "Finding Live Project State"];
      const original = rootFile(swapped);
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      const result = await runContextRefresh({ fs, budgets: budgetsWith() }, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(JSON.stringify(result.error)).toContain("section_order");
      expect(await fs.readFile("CLAUDE.md")).toBe(original);
    });

    it("CONTROL: a fully conforming candidate is still written under enforce (the gate is not a blanket refusal)", async () => {
      const original = rootFile(HAND_WRITTEN_SECTIONS);
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      const result = await runContextRefresh({ fs, budgets: budgetsWith() }, "");
      expect(result.ok).toBe(true);
      expect(await fs.readFile("CLAUDE.md")).not.toBe(original);
    });
  });

  describe("no adoption mode to choose", () => {
    it("REGRESSION: schema-default budgets refuse the same input the retired default `warn` wrote (falsifier: today's warn default)", async () => {
      const original = rootFile(without("Commands"));
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      const result = await runContextRefresh({ fs, budgets: resolveMemoryFileBudgets(undefined) }, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(JSON.stringify(result.error)).toContain("section_missing");
      expect(await fs.readFile("CLAUDE.md")).toBe(original);
    });

    it("REGRESSION: deps without any budgets (the flow's own default resolution) refuse it too", async () => {
      const original = rootFile(without("Commands"));
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      const result = await runContextRefresh({ fs }, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(JSON.stringify(result.error)).toContain("section_missing");
      expect(await fs.readFile("CLAUDE.md")).toBe(original);
    });

    it("HAPPY: a conforming file reports nothing downgraded and the report carries no downgraded field", async () => {
      const conforming = new InMemoryFsPort({ "CLAUDE.md": rootFile(HAND_WRITTEN_SECTIONS) });
      const okResult = await runContextRefresh({ fs: conforming }, "");
      expect(okResult.ok).toBe(true);
      if (!okResult.ok) return;
      expect(JSON.stringify(okResult.value)).not.toContain("downgraded");
    });
  });
});
