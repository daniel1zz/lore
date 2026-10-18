/**
 * Unit suite for `migrateLegacyAutoBlocks` (`service/context-projection.ts`,
 * spec-module-index-lists-only-folders-with-a-memory-file-managed, AC-MI-2).
 *
 * @spec_ref spec-module-index-lists-only-folders-with-a-memory-file-managed
 */

import { describe, expect, it } from "vitest";
import { CLAUDE_MD_MARKER_END, CLAUDE_MD_MARKER_START } from "@lore/core";
import { migrateLegacyAutoBlocks, spliceManagedSections } from "../../../src/service/context-projection.js";

const MODULE_BLOCK = "<!-- auto:module-index -->\n## Module Index\n- old\n<!-- /auto:module-index -->\n";
const DYNAMIC_BLOCK = "<!-- auto:dynamic-context -->\n## Finding Live Project State\nold\n<!-- /auto:dynamic-context -->\n";

describe("migrateLegacyAutoBlocks", () => {
  it("HAPPY: the first block becomes the empty managed zone, the second is removed, hand text is byte-preserved and both are reported", () => {
    const content = `head\n\n${MODULE_BLOCK}\nmid\n\n${DYNAMIC_BLOCK}\ntail\n`;
    const migration = migrateLegacyAutoBlocks(content);
    expect(migration.migrated).toEqual(["auto:module-index", "auto:dynamic-context"]);
    expect(migration.content).toBe(`head\n\n${CLAUDE_MD_MARKER_START}\n${CLAUDE_MD_MARKER_END}\n\nmid\n\n\ntail\n`);
  });

  it("STATE: after splice a second migration finds nothing and the zone holds exactly one Module Index heading", () => {
    const first = migrateLegacyAutoBlocks(`head\n\n${MODULE_BLOCK}\ntail\n`);
    const spliced = spliceManagedSections(first.content, [{ id: "module-index", body: "## Module Index\n\nnew" }]);
    expect(spliced.ok).toBe(true);
    if (!spliced.ok) return;
    expect(spliced.value.content.match(/^## Module Index$/gm)).toHaveLength(1);
    expect(migrateLegacyAutoBlocks(spliced.value.content).migrated).toEqual([]);
  });

  it("BOUNDARY: when a managed zone already exists every block is removed and no second zone is created", () => {
    const zone = `${CLAUDE_MD_MARKER_START}\n${CLAUDE_MD_MARKER_END}\n`;
    const migration = migrateLegacyAutoBlocks(`${zone}${MODULE_BLOCK}x\n`);
    expect(migration.content).toBe(`${zone}x\n`);
    expect(migration.migrated).toEqual(["auto:module-index"]);
  });

  it("NEGATIVE: an open marker with no close marker is hand text and stays untouched", () => {
    const content = "a\n<!-- auto:module-index -->\nno close\n";
    expect(migrateLegacyAutoBlocks(content)).toEqual({ content, migrated: [] });
  });

  it("BOUNDARY: content without legacy blocks is returned byte-identical", () => {
    expect(migrateLegacyAutoBlocks("# P\n\nplain\n")).toEqual({ content: "# P\n\nplain\n", migrated: [] });
  });
});
