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
});
