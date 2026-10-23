/**
 * Unit tests for flows/migrate-fragments-flow.ts (spec-fragment-injection-timing-one-inject-enum-a-per-turn, Migration
 * mapping). Covers the mapping table, frontmatter-only rewrite, preview purity, idempotence and the per-file hash
 * precondition (the concurrent-change case through the injected `beforeWrite` seam).
 */
import { describe, expect, it } from "vitest";
import {
  formatOutcomeLine,
  mapOldFrontmatter,
  migrateFragments,
  type MigrateFragmentsFs,
} from "../../../src/flows/migrate-fragments-flow";

function memoryFs(files: Record<string, string>): MigrateFragmentsFs & { files: Record<string, string>; writes: string[] } {
  const writes: string[] = [];
  return {
    files,
    writes,
    async listDir(dir) {
      return Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1));
    },
    async readFile(path) {
      return files[path] ?? null;
    },
    async writeFile(path, text) {
      writes.push(path);
      files[path] = text;
    },
  };
}

const old = (lines: string[], body = "Body\n"): string => `---\nid: x\ntitle: "T"\n${lines.join("\n")}\n---\n${body}`;
const layer = [{ scope: "user" as const, dir: "/d" }];

describe("mapOldFrontmatter", () => {
  it.each([
    [{ audience: ["main"] }, ["launch"], undefined],
    [{ audience: ["main"], delivery: "skill" }, ["on-demand"], undefined],
    [{ audience: ["subagent:*"] }, ["subagent-start"], undefined],
    [{ audience: ["subagent:a", "subagent:b"] }, ["subagent-start"], ["a", "b"]],
    [{ audience: ["main", "subagent:a"] }, ["launch", "subagent-start"], ["a"]],
    [{ audience: ["subagent:a", "subagent:*"] }, ["subagent-start"], undefined],
    [{ audience: ["subagent:*"], mode: "dynamic" }, ["subagent-start"], undefined],
  ])("maps %j", (raw, inject, agents) => {
    const m = mapOldFrontmatter(raw);
    expect(m.kind).toBe("migrate");
    if (m.kind === "migrate") {
      expect(m.inject).toEqual(inject);
      expect(m.agents).toEqual(agents);
    }
  });

  it.each([
    [{ audience: ["main"], mode: "dynamic" }, "dynamic"],
    [{ audience: ["main", "subagent:a"], delivery: "skill" }, "split"],
    [{ audience: ["subagent:a"], delivery: "skill" }, "split"],
    [{ audience: ["nobody"] }, "unknown audience"],
    [{ audience: ["main"], mode: "weird" }, "unknown mode"],
    [{ audience: ["main"], delivery: "weird" }, "unknown delivery"],
    [{ audience: ["main"], inject: ["launch"] }, "both"],
    [{ title: "t" }, "nothing to migrate"],
  ])("refuses %j", (raw, fragment) => {
    const m = mapOldFrontmatter(raw);
    expect(m.kind).toBe("refused");
    if (m.kind === "refused") expect(m.reason).toContain(fragment);
  });

  it("treats a file that already has inject and no old keys as unchanged", () => {
    expect(mapOldFrontmatter({ inject: ["launch"] }).kind).toBe("unchanged");
  });
});

describe("migrateFragments", () => {
  it("preview writes nothing; apply rewrites only frontmatter lines, inject right after title", async () => {
    const original = old(["audience: [main, subagent:lore-implementer]", "mode: static", "when: { language: [zh] }"], "Line1\n\nLine2");
    const fs = memoryFs({ "/d/a.md": original });

    const preview = await migrateFragments({ fs }, { layers: layer, apply: false });
    expect(preview.ok && preview.value.exitCode).toBe(0);
    expect(fs.writes).toEqual([]);
    expect(fs.files["/d/a.md"]).toBe(original);

    const applied = await migrateFragments({ fs }, { layers: layer, apply: true });
    expect(applied.ok && applied.value.outcomes[0]?.kind).toBe("migrated");
    expect(fs.files["/d/a.md"]).toBe(
      '---\nid: x\ntitle: "T"\ninject: [launch, subagent-start]\nagents: [lore-implementer]\nwhen: { language: [zh] }\n---\nLine1\n\nLine2',
    );
  });

  it("is idempotent: a second apply reports unchanged, exit 0, no write", async () => {
    const fs = memoryFs({ "/d/a.md": old(["audience: [main]"]) });
    await migrateFragments({ fs }, { layers: layer, apply: true });
    fs.writes.length = 0;
    const second = await migrateFragments({ fs }, { layers: layer, apply: true });
    expect(second.ok && second.value.outcomes.map((o) => o.kind)).toEqual(["unchanged"]);
    expect(second.ok && second.value.exitCode).toBe(0);
    expect(fs.writes).toEqual([]);
  });

  it("migrates the migratable files and exits 4 when another is refused", async () => {
    const refused = old(["audience: [main]", "mode: dynamic"]);
    const fs = memoryFs({ "/d/a.md": old(["audience: [main]"]), "/d/b.md": refused });
    const r = await migrateFragments({ fs }, { layers: layer, apply: true });
    expect(r.ok && r.value.exitCode).toBe(4);
    expect(fs.files["/d/b.md"]).toBe(refused);
    expect(fs.files["/d/a.md"]).toContain("inject: [launch]");
    expect(r.ok && formatOutcomeLine(r.value.outcomes[1] as never)).toContain("b.md: refused:");
  });

  it("refuses a file whose migrated frontmatter would fail the new schema (skill without description)", async () => {
    const fs = memoryFs({ "/d/a.md": old(["audience: [main]", "delivery: skill"]) });
    const r = await migrateFragments({ fs }, { layers: layer, apply: true });
    expect(r.ok && r.value.outcomes[0]?.kind).toBe("refused");
  });

  it("reports a failed write as WRITE_FAILED naming the path", async () => {
    const fs = memoryFs({ "/d/a.md": old(["audience: [main]"]) });
    fs.writeFile = async () => {
      throw new Error("disk full");
    };
    const r = await migrateFragments({ fs }, { layers: layer, apply: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ code: "WRITE_FAILED", path: "/d/a.md", message: "disk full" });
  });

  it("preserves CRLF line endings and a BOM", async () => {
    const text = "﻿---\r\nid: x\r\ntitle: T\r\naudience: [main]\r\n---\r\nBody\r\n";
    const fs = memoryFs({ "/d/a.md": text });
    const r = await migrateFragments({ fs }, { layers: layer, apply: true });
    expect(JSON.stringify(r)).toContain('"migrated"');
    expect(fs.files["/d/a.md"]).toBe("﻿---\r\nid: x\r\ntitle: T\r\ninject: [launch]\r\n---\r\nBody\r\n");
  });
});

describe("AC-IT-5 concurrent change", () => {
  it("a file changed between the flow's read and its write (injected beforeWrite) is a conflict with exit 5 and keeps the concurrent writer's bytes; other files still migrate", async () => {
    const fs = memoryFs({ "/d/a.md": old(["audience: [main]"]), "/d/b.md": old(["audience: [main]"]) });
    const theirs = "---\nid: x\ntitle: T\ninject: [launch]\n---\nconcurrent\n";
    const r = await migrateFragments(
      {
        fs,
        beforeWrite: async (path) => {
          if (path === "/d/a.md") fs.files[path] = theirs;
        },
      },
      { layers: layer, apply: true },
    );
    expect(r.ok && r.value.exitCode).toBe(5);
    expect(r.ok && r.value.outcomes[0]?.kind).toBe("conflict");
    expect(fs.files["/d/a.md"]).toBe(theirs);
    expect(fs.files["/d/b.md"]).toContain("inject: [launch]");
    expect(fs.writes).toEqual(["/d/b.md"]);
  });
});
