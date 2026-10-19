/**
 * Architecture-card link line of module memory files: the pure line helpers (`@lore/core`), the pure card
 * reader (`extractModuleCardRefs`) and `runContextRefresh`'s card pass (task
 * task-module-claude-md-files-do-not-link-their-architecture-2).
 *
 * Covers: HAPPY (link written, idempotent), NEGATIVE (dangling/stale link flagged by --check), BOUNDARY (no cards ->
 * no line and no error; a module with no card untouched), ERROR (ambiguous cards, ceiling breach), STATE (relink),
 * REGRESSION (callers passing no `moduleCards` keep the old behaviour).
 */

import { describe, expect, it } from "vitest";
import type { DocRecord } from "@lore/core";
import {
  applyArchitectureCardLine,
  InMemoryFsPort,
  parseModuleCardDirectory,
  renderArchitectureCardLine,
  resolveMemoryFileBudgets,
} from "@lore/core";
import { runContextInit, runContextRefresh } from "../../../src/flows/context-flow.js";
import { extractModuleCardRefs } from "../../../src/service/context-facts.js";

const CONFORMING_NARRATIVE = "## What This Is\n\nA fixture.\n\n## Commands\n\n- make test\n\n## Architecture\n\nLayers.\n";
const MODULE_FILE = "packages/svc/CLAUDE.md";
const MODULE_BODY = "# Module: svc\n\n## Purpose\n\nServes things.\n";
const CARD = { slug: "baseline-module-card-svc", directory: "packages/svc" } as const;

async function initialisedFs(moduleBody: string = MODULE_BODY): Promise<InMemoryFsPort> {
  const fs = new InMemoryFsPort({ [MODULE_FILE]: moduleBody });
  const init = await runContextInit({ fs }, "", { narrative: CONFORMING_NARRATIVE });
  expect(init.ok).toBe(true);
  return fs;
}

function cardDoc(slug: string, content: string, extra: Record<string, unknown> = { tree: "architecture", node: "module-card" }): DocRecord {
  return { slug, content, extra } as unknown as DocRecord;
}

describe("architecture card line helpers", () => {
  it("HAPPY: inserts the line after the H1 and is idempotent", () => {
    const once = applyArchitectureCardLine(MODULE_BODY, CARD.slug);
    expect(once).toBe(`# Module: svc\n\n${renderArchitectureCardLine(CARD.slug)}\n\n## Purpose\n\nServes things.\n`);
    expect(applyArchitectureCardLine(once, CARD.slug)).toBe(once);
  });

  it("STATE: a different slug replaces the line rather than adding a second one", () => {
    const first = applyArchitectureCardLine(MODULE_BODY, "baseline-module-card-old");
    const second = applyArchitectureCardLine(first, CARD.slug);
    expect(second.match(/Architecture card:/g)).toHaveLength(1);
    expect(second).toContain(CARD.slug);
  });

  it("BOUNDARY: a null slug strips the line and restores the original bytes", () => {
    const linked = applyArchitectureCardLine(MODULE_BODY, CARD.slug);
    expect(applyArchitectureCardLine(linked, null)).toBe(MODULE_BODY);
    expect(applyArchitectureCardLine(MODULE_BODY, null)).toBe(MODULE_BODY);
  });

  it("BOUNDARY: a file with no H1 gets the line at the top", () => {
    expect(applyArchitectureCardLine("plain\n", CARD.slug)).toBe(`${renderArchitectureCardLine(CARD.slug)}\n\nplain\n`);
  });

  it("HAPPY: reads the module directory from the card's Source line, never its title", () => {
    expect(parseModuleCardDirectory("# Module card: core\n\nSource: `packages/core/src/CLAUDE.md`.\n")).toBe("packages/core/src");
    expect(parseModuleCardDirectory("# Module card: core\n\nno source line\n")).toBeNull();
  });
});

describe("extractModuleCardRefs", () => {
  it("HAPPY: maps only architecture module-cards by their Source directory", () => {
    const result = extractModuleCardRefs([
      cardDoc(CARD.slug, "Source: `packages/svc/CLAUDE.md`."),
      cardDoc("baseline-other-section", "Source: `packages/other/CLAUDE.md`.", { tree: "architecture", node: "section" }),
      cardDoc("business-leaf", "Source: `packages/biz/CLAUDE.md`.", { node: "leaf" }),
      cardDoc("baseline-module-card-nosource", "# no source"),
    ]);
    expect(result).toEqual({ ok: true, value: [CARD] });
  });

  it("BOUNDARY: no cards yields an empty list, not an error", () => {
    expect(extractModuleCardRefs([])).toEqual({ ok: true, value: [] });
  });

  it("ERROR: two cards claiming one directory fail loud", () => {
    const result = extractModuleCardRefs([cardDoc("a", "Source: `packages/svc/CLAUDE.md`."), cardDoc("b", "Source: `packages/svc/CLAUDE.md`.")]);
    expect(result.ok).toBe(false);
  });
});

describe("runContextRefresh architecture card pass", () => {
  it("HAPPY: refresh writes the link into the module file; a second refresh and --check are clean", async () => {
    const fs = await initialisedFs();
    const refreshed = await runContextRefresh({ fs, moduleCards: [CARD] }, "", {});
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.value.moduleCards).toEqual([{ path: MODULE_FILE, card: CARD.slug, state: "linked" }]);
    expect(await fs.readFile(MODULE_FILE)).toContain(renderArchitectureCardLine(CARD.slug));

    const again = await runContextRefresh({ fs, moduleCards: [CARD] }, "", {});
    expect(again.ok && again.value.moduleCards[0]?.state).toBe("unchanged");

    const checked = await runContextRefresh({ fs, moduleCards: [CARD] }, "", { check: true });
    expect(checked.ok && checked.value.check?.differing).toEqual([]);
  });

  it("NEGATIVE: --check names a module file that lacks its link, and writes nothing", async () => {
    const fs = await initialisedFs();
    const checked = await runContextRefresh({ fs, moduleCards: [CARD] }, "", { check: true });
    expect(checked.ok && checked.value.check?.differing).toEqual([MODULE_FILE]);
    expect(await fs.readFile(MODULE_FILE)).toBe(MODULE_BODY);
  });

  it("NEGATIVE: deleting the card leaves a dangling link that --check flags and refresh removes", async () => {
    const fs = await initialisedFs();
    await runContextRefresh({ fs, moduleCards: [CARD] }, "", {});

    const checked = await runContextRefresh({ fs, moduleCards: [] }, "", { check: true });
    expect(checked.ok && checked.value.check?.differing).toEqual([MODULE_FILE]);

    const refreshed = await runContextRefresh({ fs, moduleCards: [] }, "", {});
    expect(refreshed.ok && refreshed.value.moduleCards).toEqual([{ path: MODULE_FILE, card: null, state: "unlinked" }]);
    expect(await fs.readFile(MODULE_FILE)).toBe(MODULE_BODY);
  });

  it("STATE: a card whose slug changed is relinked", async () => {
    const fs = await initialisedFs();
    await runContextRefresh({ fs, moduleCards: [{ slug: "baseline-module-card-old", directory: "packages/svc" }] }, "", {});
    const refreshed = await runContextRefresh({ fs, moduleCards: [CARD] }, "", {});
    expect(refreshed.ok && refreshed.value.moduleCards[0]?.state).toBe("relinked");
    expect(await fs.readFile(MODULE_FILE)).not.toContain("baseline-module-card-old");
  });

  it("BOUNDARY: a corpus with no module cards leaves module files byte-identical and reports no error", async () => {
    const fs = await initialisedFs();
    const refreshed = await runContextRefresh({ fs, moduleCards: [] }, "", {});
    expect(refreshed.ok).toBe(true);
    expect(await fs.readFile(MODULE_FILE)).toBe(MODULE_BODY);
    expect(refreshed.ok && refreshed.value.moduleCards).toEqual([]);
  });

  it("REGRESSION: callers that pass no moduleCards never touch module files", async () => {
    const fs = await initialisedFs(`${MODULE_BODY}\nArchitecture card: \`stale\`\n`);
    const checked = await runContextRefresh({ fs }, "", { check: true });
    expect(checked.ok && checked.value.check?.differing).toEqual([]);
    expect(checked.ok && checked.value.moduleCards).toEqual([]);
  });

  it("ERROR: a link that would push the module file over its ceiling is refused, nothing written", async () => {
    const budgets = resolveMemoryFileBudgets(undefined);
    const filler = "x".repeat(budgets.module.max_bytes - MODULE_BODY.length - 5);
    const fs = await initialisedFs(`${MODULE_BODY}\n${filler}\n`);
    const refreshed = await runContextRefresh({ fs, moduleCards: [CARD] }, "", {});
    expect(refreshed.ok).toBe(false);
    expect(await fs.readFile(MODULE_FILE)).not.toContain("Architecture card:");
  });
});
