/**
 * @spec_ref AC-STR-6
 *
 * RED suite: `lore context` write gate honours adoption mode
 * (spec-claude-md-root-section-structure-check-and-adoption-mode, AC-STR-6,
 * task task-skill-test-lore-context-write-gate-honours-adoption-red).
 *
 * Spec statements encoded here (written before reading the implementation of
 * the new behaviour):
 *   - adoption `enforce` + root CLAUDE.md candidate missing a required H2
 *     -> the flow returns an error naming `section_missing` (and the section),
 *     and the target file bytes are UNCHANGED.
 *   - adoption `warn` + same input -> the file IS written and the result
 *     reports the finding as an advisory `downgraded` finding whose
 *     `downgraded_kind` is `section_missing`.
 *   - adoption key absent (defaults) -> behaves as `warn`.
 *
 * The gate is `runContextRefresh` (the only context verb that runs pre-write
 * admission). Adoption mode travels in the resolved `MemoryFileBudgets`
 * (`context.memory_files.adoption`, resolved by `resolveMemoryFileBudgets`).
 * The spec does not fix the property name on the flow's report, so the
 * "reports downgraded" assertions search the serialized report for the
 * `downgraded_kind` pair instead of pinning a field path (spec gap, flagged).
 */

import { describe, expect, it } from "vitest";
import { InMemoryFsPort, resolveMemoryFileBudgets } from "@lore/core";
import type { MemoryFileBudgets } from "@lore/core";
import { runContextRefresh } from "../../../src/flows/context-flow.js";

/** The five required root H2 sections, in contract order (spec Public Interface). */
const ALL_SECTIONS = ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"];

/** Builds a root CLAUDE.md whose H2 list is exactly `sections` (each with real body content). */
function rootFile(sections: readonly string[]): string {
  return `${sections.map((s) => `## ${s}\n\nBody text for ${s}.\n`).join("\n")}`;
}

/** Resolved budgets with an explicit adoption mode (explicit enforce: absent key means warn). */
function budgetsWith(adoption: "enforce" | "warn"): MemoryFileBudgets {
  const defaults = resolveMemoryFileBudgets(undefined);
  // The `adoption` field does not exist on today's type; the cast is the point of the RED test.
  return { ...defaults, adoption } as unknown as MemoryFileBudgets;
}

const without = (name: string): string[] => ALL_SECTIONS.filter((s) => s !== name);

describe("lore context write gate honours adoption (AC-STR-6)", () => {
  describe("adoption enforce", () => {
    it("NEGATIVE: refuses a candidate missing '## Commands' with an error naming section_missing", async () => {
      const fs = new InMemoryFsPort({ "CLAUDE.md": rootFile(without("Commands")) });
      const result = await runContextRefresh({ fs, budgets: budgetsWith("enforce") }, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(JSON.stringify(result.error)).toContain("section_missing");
    });

    it("NEGATIVE: the refusal names the missing section ('Commands')", async () => {
      const fs = new InMemoryFsPort({ "CLAUDE.md": rootFile(without("Commands")) });
      const result = await runContextRefresh({ fs, budgets: budgetsWith("enforce") }, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(JSON.stringify(result.error)).toContain("Commands");
    });

    it("STATE: a refused write leaves the target file bytes unchanged", async () => {
      const original = rootFile(without("Commands"));
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      await runContextRefresh({ fs, budgets: budgetsWith("enforce") }, "");
      expect(await fs.readFile("CLAUDE.md")).toBe(original);
    });

    it("NEGATIVE: a different missing section ('Architecture') is named, not a hardcoded 'Commands'", async () => {
      const original = rootFile(without("Architecture"));
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      const result = await runContextRefresh({ fs, budgets: budgetsWith("enforce") }, "");
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
      const result = await runContextRefresh({ fs, budgets: budgetsWith("enforce") }, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(JSON.stringify(result.error)).toContain("section_order");
      expect(await fs.readFile("CLAUDE.md")).toBe(original);
    });

    it("CONTROL: a fully conforming candidate is still written under enforce (the gate is not a blanket refusal)", async () => {
      const original = rootFile(ALL_SECTIONS);
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      const result = await runContextRefresh({ fs, budgets: budgetsWith("enforce") }, "");
      expect(result.ok).toBe(true);
      expect(await fs.readFile("CLAUDE.md")).not.toBe(original);
    });
  });

  describe("adoption warn", () => {
    it("HAPPY: the same non-conforming input is written (file bytes change: managed zone added)", async () => {
      const original = rootFile(without("Commands"));
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      const result = await runContextRefresh({ fs, budgets: budgetsWith("warn") }, "");
      expect(result.ok).toBe(true);
      const after = await fs.readFile("CLAUDE.md");
      expect(after).not.toBe(original);
      expect(after).toContain("Body text for Architecture.");
    });

    it("HAPPY: the result reports an advisory downgraded finding with downgraded_kind section_missing", async () => {
      const fs = new InMemoryFsPort({ "CLAUDE.md": rootFile(without("Commands")) });
      const result = await runContextRefresh({ fs, budgets: budgetsWith("warn") }, "");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const serialized = JSON.stringify(result.value);
      expect(serialized).toContain('"downgraded_kind":"section_missing"');
    });

    it("HAPPY: a conforming file reports no downgraded finding in warn mode", async () => {
      const conforming = new InMemoryFsPort({ "CLAUDE.md": rootFile(ALL_SECTIONS) });
      const okResult = await runContextRefresh({ fs: conforming, budgets: budgetsWith("warn") }, "");
      expect(okResult.ok).toBe(true);
      if (!okResult.ok) return;
      expect(JSON.stringify(okResult.value)).not.toContain("downgraded_kind");
    });
  });

  describe("adoption absent (defaults)", () => {
    it("STATE: schema-default budgets (no adoption key supplied) behave as warn: written, reported downgraded", async () => {
      const original = rootFile(without("Commands"));
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      const result = await runContextRefresh({ fs, budgets: resolveMemoryFileBudgets(undefined) }, "");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(await fs.readFile("CLAUDE.md")).not.toBe(original);
      expect(JSON.stringify(result.value)).toContain('"downgraded_kind":"section_missing"');
    });

    it("STATE: deps without any budgets (flow's own default resolution) behave as warn", async () => {
      const original = rootFile(without("Commands"));
      const fs = new InMemoryFsPort({ "CLAUDE.md": original });
      const result = await runContextRefresh({ fs }, "");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(JSON.stringify(result.value)).toContain('"downgraded_kind":"section_missing"');
    });
  });
});
