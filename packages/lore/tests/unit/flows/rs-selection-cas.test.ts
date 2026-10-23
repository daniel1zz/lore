/**
 * Unit suite for `runSelectionList` / `runSelectionChange` (`packages/lore/src/flows/selection-flow.ts`).
 * @spec_ref spec-rule-store-git-tracked-fragment-selection-on-demand-skill (AC-RS-6, BR-1063);
 *   task task-rs-t8-selection-flow-with-cas-write.
 */
import { describe, expect, it } from "vitest";
import { InMemoryFsPort, type FsWritePort } from "@lore/core";
import { runSelectionChange, runSelectionList, type SelectionFlowDeps } from "../../../src/flows/selection-flow.js";

const PROJECT_SEL = "/p/.lore/context/selection.yaml";
const USER_SEL = "/u/context/selection.yaml";

function fragment(id: string, extra = "", inject = "launch"): string {
  return `---\nid: ${id}\ntitle: T ${id}\ninject: [${inject}]\n${extra}---\nbody of ${id}\n`;
}

function seed(files: Record<string, string>): InMemoryFsPort {
  return new InMemoryFsPort({
    "/s/context/shipped-a.md": fragment("shipped-a"),
    "/s/context/skill-b.md": fragment("skill-b", "description: d\n", "on-demand"),
    "/u/context/user-c.md": fragment("user-c"),
    ...files,
  });
}

function depsFor(fs: FsWritePort): SelectionFlowDeps {
  return {
    fs,
    roots: { shipped: "/s/context", user: "/u/context", project: "/p/.lore/context" },
    selectionPaths: { project: PROJECT_SEL, user: USER_SEL },
  };
}

/** Wrap `mem` so that right after the FIRST read of `target`, another writer lands `interleaved` there. */
function racingFs(mem: InMemoryFsPort, target: string, interleaved: string): FsWritePort {
  let reads = 0;
  return {
    exists: (p) => mem.exists(p),
    listDir: (p) => mem.listDir(p),
    writeFile: (p, c) => mem.writeFile(p, c),
    async readFile(p) {
      const bytes = await mem.readFile(p);
      // reason: the first read of the selection file is the flow's CAS baseline; the rival write lands right after it.
      if (p === target && ++reads === 1) await mem.writeFile(target, interleaved);
      return bytes;
    },
  };
}

describe("AC-RS-6 selection CAS", () => {
  it("AC-RS-6: an interleaved write yields CONFLICT and leaves the file byte-equal to the interleaved write", async () => {
    const interleaved = "schemaVersion: 1\ndisable:\n  - skill-b\n";
    const mem = seed({ [PROJECT_SEL]: "schemaVersion: 1\ndisable: []\n" });
    const result = await runSelectionChange(depsFor(racingFs(mem, PROJECT_SEL, interleaved)), {
      action: "remove",
      id: "shipped-a",
      scope: "project",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CONFLICT");
    expect(await mem.readFile(PROJECT_SEL)).toBe(interleaved);
  });

  it("AC-RS-6: a file that appears between an absent read and the write is a CONFLICT too", async () => {
    const interleaved = "schemaVersion: 1\ndisable: []\n";
    const mem = seed({});
    const result = await runSelectionChange(depsFor(racingFs(mem, PROJECT_SEL, interleaved)), {
      action: "remove",
      id: "shipped-a",
      scope: "project",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFLICT");
    expect(await mem.readFile(PROJECT_SEL)).toBe(interleaved);
  });
});

describe("runSelectionChange", () => {
  it("remove creates the file; add re-enables and keeps an explicit empty list", async () => {
    const mem = seed({});
    const deps = depsFor(mem);
    const removed = await runSelectionChange(deps, { action: "remove", id: "shipped-a", scope: "project" });
    expect(removed.ok && removed.value.changed).toBe(true);
    expect(await mem.readFile(PROJECT_SEL)).toBe("schemaVersion: 1\ndisable:\n  - shipped-a\n");
    const added = await runSelectionChange(deps, { action: "add", id: "shipped-a", scope: "project" });
    expect(added.ok && added.value.changed).toBe(true);
    expect(await mem.readFile(PROJECT_SEL)).toBe("schemaVersion: 1\ndisable: []\n");
  });

  it("is idempotent: repeating remove / add changes nothing and reports changed:false", async () => {
    const mem = seed({});
    const deps = depsFor(mem);
    await runSelectionChange(deps, { action: "remove", id: "shipped-a", scope: "project" });
    const before = await mem.readFile(PROJECT_SEL);
    const again = await runSelectionChange(deps, { action: "remove", id: "shipped-a", scope: "project" });
    expect(again.ok && again.value.changed).toBe(false);
    expect(await mem.readFile(PROJECT_SEL)).toBe(before);
    await runSelectionChange(deps, { action: "add", id: "shipped-a", scope: "project" });
    const addAgain = await runSelectionChange(deps, { action: "add", id: "shipped-a", scope: "project" });
    expect(addAgain.ok && addAgain.value.changed).toBe(false);
  });

  it("refuses an unknown id and writes nothing", async () => {
    const mem = seed({});
    for (const action of ["add", "remove"] as const) {
      const result = await runSelectionChange(depsFor(mem), { action, id: "nope", scope: "project" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await mem.exists(PROJECT_SEL)).toBe(false);
  });

  it("refuses a scope that does not own the fragment (user scope disabling a shipped static main fragment)", async () => {
    const mem = seed({});
    const result = await runSelectionChange(depsFor(mem), { action: "remove", id: "shipped-a", scope: "user" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.message).toContain("scope: user");
    }
    expect(await mem.exists(USER_SEL)).toBe(false);
  });

  it("refuses a malformed selection file", async () => {
    const mem = seed({ [PROJECT_SEL]: "schemaVersion: 2\n" });
    const result = await runSelectionChange(depsFor(mem), { action: "remove", id: "shipped-a", scope: "project" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("runSelectionList", () => {
  it("lists id, layer, inject, size, selected, reflecting both scopes' selections", async () => {
    const mem = seed({
      [PROJECT_SEL]: "schemaVersion: 1\ndisable:\n  - shipped-a\n",
      [USER_SEL]: "schemaVersion: 1\ndisable:\n  - user-c\n",
    });
    const result = await runSelectionList(depsFor(mem));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { id: "shipped-a", layer: "shipped", inject: ["launch"], size: "body of shipped-a\n".length, selected: false },
      { id: "skill-b", layer: "shipped", inject: ["on-demand"], size: "body of skill-b\n".length, selected: true },
      { id: "user-c", layer: "user", inject: ["launch"], size: "body of user-c\n".length, selected: false },
    ]);
  });

  it("an absent selection file means everything is selected", async () => {
    const result = await runSelectionList(depsFor(seed({})));
    expect(result.ok && result.value.every((e) => e.selected)).toBe(true);
  });
});
