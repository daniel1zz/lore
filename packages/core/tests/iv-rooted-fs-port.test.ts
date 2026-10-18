/**
 * AC-IV-4 (BR-1177, spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D3): ONE shared assertion
 * suite runs against BOTH rooted write ports — the real `node:fs` port (`makeRealContextFsPort`) and the
 * in-memory double — and shows that a write or delete outside the roots returns VALIDATION_ERROR, an outside
 * write creates no file, and an outside delete leaves the target existing.
 *
 * SYMLINK COVERAGE: the in-memory port is a flat Map with no link model, so the symlink-escape case can only
 * run against the REAL port (`describe("real port only")` below). The AC text claims it for both; that is a
 * recorded correction for the orchestrator, not something this file papers over.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryFsPort, isInsideRoots, normalizePortPath, type FsWritePort } from "@lore/core";
import { makeRealContextFsPort } from "../../lore/src/adapters/cli/commands/context.js";

interface Harness {
  /** The port under test, constructed with `roots` = [`<base>/root`]. */
  port: FsWritePort;
  /** Absolute path inside the root. */
  inside: string;
  /** Absolute path outside every root. */
  outside: string;
  /** Seeds a file at `path` (bypassing the port) so an outside delete has something to protect. */
  seed(path: string, content: string): void;
  /** Observes whether `path` exists (reads are never guarded). */
  present(path: string): Promise<boolean>;
  /** Observes the content at `path`, or null. */
  content(path: string): Promise<string | null>;
}

let base = "";
beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "iv-rooted-fs-")));
  mkdirSync(join(base, "root"));
  mkdirSync(join(base, "elsewhere"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

function realHarness(): Harness {
  const port = makeRealContextFsPort(join(base, "root"), [join(base, "root")]);
  return {
    port,
    inside: join(base, "root", "in.txt"),
    outside: join(base, "elsewhere", "out.txt"),
    seed: (path, content) => writeFileSync(path, content, "utf8"),
    present: async (path) => existsSync(path),
    content: async (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
  };
}

function memoryHarness(): Harness {
  const seeds: Record<string, string> = {};
  const roots = ["/base/root"];
  const holder: { port: InMemoryFsPort } = { port: new InMemoryFsPort({}, roots) };
  return {
    get port() {
      return holder.port;
    },
    inside: "/base/root/in.txt",
    outside: "/base/elsewhere/out.txt",
    // reason: the double is seeded only through its constructor, so seeding rebuilds the port around the file.
    seed: (path, content) => {
      seeds[path] = content;
      holder.port = new InMemoryFsPort({ ...seeds }, roots);
    },
    present: (path) => holder.port.exists(path),
    content: (path) => holder.port.readFile(path),
  };
}

const PORTS: ReadonlyArray<readonly [string, () => Harness]> = [
  ["real port", realHarness],
  ["in-memory port", memoryHarness],
];

describe.each(PORTS)("AC-IV-4 rooted write port — %s", (_name, make) => {
  it("AC-IV-4 a write outside every root returns VALIDATION_ERROR naming the path and creates no file", async () => {
    const h = make();
    const result = await h.port.writeFile(h.outside, "payload");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("path");
    expect(result.error.message).toContain(h.outside);
    expect(await h.port.exists(h.outside)).toBe(false);
    expect(await h.present(h.outside)).toBe(false);
  });

  it("AC-IV-4 a delete outside every root returns VALIDATION_ERROR and the target still exists", async () => {
    const h = make();
    h.seed(h.outside, "keep me");
    const result = await h.port.deleteFile?.(h.outside);
    expect(result?.ok).toBe(false);
    if (result === undefined || result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(await h.present(h.outside)).toBe(true);
    expect(await h.content(h.outside)).toBe("keep me");
  });

  it("AC-IV-4 removeDirIfEmpty outside every root is refused with VALIDATION_ERROR", async () => {
    const h = make();
    const result = await h.port.removeDirIfEmpty?.(join(h.outside, ".."));
    expect(result?.ok).toBe(false);
    if (result === undefined || result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-IV-4 a `..` escape that lexically leaves the root is refused", async () => {
    const h = make();
    const escape = join(h.inside, "..", "..", "elsewhere", "dotdot.txt");
    const result = await h.port.writeFile(escape, "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(await h.present(join(base, "elsewhere", "dotdot.txt"))).toBe(false);
  });

  it("AC-IV-4 a sibling directory sharing the root's name prefix is outside the root", async () => {
    const h = make();
    const sibling = `${h.inside.slice(0, h.inside.lastIndexOf("/"))}-evil/x.txt`;
    const result = await h.port.writeFile(sibling, "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-IV-4 control: a write and a delete inside the root succeed (the guard is not a blanket refusal)", async () => {
    const h = make();
    const written = await h.port.writeFile(h.inside, "hello");
    expect(written.ok).toBe(true);
    expect(await h.port.readFile(h.inside)).toBe("hello");
    const deleted = await h.port.deleteFile?.(h.inside);
    expect(deleted?.ok).toBe(true);
    expect(await h.port.exists(h.inside)).toBe(false);
  });
});

describe("AC-IV-4 rooted write port — real port only (the in-memory double has no symlinks to model)", () => {
  it("AC-IV-4 a write through a symlink inside the root that points outside is refused and creates no file", async () => {
    const h = realHarness();
    symlinkSync(join(base, "elsewhere"), join(base, "root", "link"));
    const result = await h.port.writeFile(join(base, "root", "link", "via-link.txt"), "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(existsSync(join(base, "elsewhere", "via-link.txt"))).toBe(false);
  });

  it("AC-IV-4 a delete through a symlink inside the root that points outside is refused and the target stays", async () => {
    const h = realHarness();
    writeFileSync(join(base, "elsewhere", "victim.txt"), "keep", "utf8");
    const result = await h.port.deleteFile?.(join(base, "root", "link", "victim.txt"));
    expect(result?.ok).toBe(false);
    if (result !== undefined && !result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(readFileSync(join(base, "elsewhere", "victim.txt"), "utf8")).toBe("keep");
  });

  it("AC-IV-4 a DANGLING symlink at the target that points outside is refused and nothing is created behind it", async () => {
    const h = realHarness();
    symlinkSync(join(base, "elsewhere", "not-yet.txt"), join(base, "root", "dangling"));
    const result = await h.port.writeFile(join(base, "root", "dangling"), "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(existsSync(join(base, "elsewhere", "not-yet.txt"))).toBe(false);
  });

  it("AC-IV-4 a write into a not-yet-existing subdirectory of the root succeeds (deepest-existing-ancestor resolution)", async () => {
    const h = realHarness();
    const result = await h.port.writeFile(join(base, "root", "new", "deep", "f.txt"), "ok");
    expect(result.ok).toBe(true);
    expect(readFileSync(join(base, "root", "new", "deep", "f.txt"), "utf8")).toBe("ok");
  });

  it("AC-IV-4 the realpath of a root is used: a root reached through a symlink still admits its real files", async () => {
    mkdirSync(join(base, "real-target"), { recursive: true });
    symlinkSync(join(base, "real-target"), join(base, "root-alias"));
    const port = makeRealContextFsPort(base, [join(base, "root-alias")]);
    const result = await port.writeFile(join(base, "root-alias", "a.txt"), "ok");
    expect(result.ok).toBe(true);
    expect(readFileSync(join(base, "real-target", "a.txt"), "utf8")).toBe("ok");
  });
});

describe("AC-IV-4 shared pure containment helpers", () => {
  it("normalizePortPath collapses dot segments and keeps leading .. on relative escapes", () => {
    expect(normalizePortPath("/a/./b/../c")).toBe("/a/c");
    expect(normalizePortPath("../x")).toBe("../x");
    expect(normalizePortPath("a/../..")).toBe("..");
  });

  it("isInsideRoots treats the empty root as the relative-path space and refuses a climbing relative path", () => {
    expect(isInsideRoots("docs/a.md", [""])).toBe(true);
    expect(isInsideRoots("../a.md", [""])).toBe(false);
    expect(isInsideRoots("/abs/a.md", [""])).toBe(false);
    expect(isInsideRoots("/r/a", ["/r"])).toBe(true);
    expect(isInsideRoots("/r", ["/r"])).toBe(true);
    expect(isInsideRoots("/rr/a", ["/r"])).toBe(false);
  });
});
