// @reads packages/lore/src/service/anchor-resolution.ts
/**
 * `service/anchor-resolution.ts` — the ONE place a task's declared
 * `extra.file_anchors` are probed against the working tree, plus the ONE
 * advisory renderer every CLI write surface prints
 * (task-a-mistyped-task-file-anchor-is-stored-and-consulted, Required #1/#3).
 *
 * The filesystem arrives ONLY through the injected `FsProbe` port (the SAME
 * port `DriftCheckService.checkDrift` / `lore status --check-drift` already
 * probe through — reused, never a second port), so this suite drives it with a
 * hand-built fake and asserts the module never opens its own fs seam.
 *
 * ⛔ Nothing here can refuse a write. Every function returns a REPORT; the
 * advisory is non-blocking by construction (there is no Result, no error path).
 *
 * Six-dimension coverage:
 *   HAPPY:      an anchor that resolves yields `{probed:true, unresolved:[]}` and
 *               renders ZERO advisory lines (the CONTROL — a blanket-advisory
 *               regression fails here)
 *   NEGATIVE:   a non-resolving anchor yields a row naming the exact path and
 *               renders an advisory line containing that path verbatim
 *   BOUNDARY:   an empty anchor list probes nothing (zero `stat` calls); two
 *               anchors sharing one fs path (`a` and `a/`) probe that path ONCE
 *   ERROR:      a THROWING probe becomes a `probe_error` row and does NOT abort
 *               the scan — every other anchor is still classified
 *   STATE:      `unprobedFileAnchors()` and a clean probed report are distinct
 *               values, and the renderer stays silent for BOTH (nothing to say
 *               ≠ nothing known — the distinction is carried in the data, not
 *               in the prose)
 *   REGRESSION: a source-text scan asserts this module imports no `node:fs` /
 *               `fs` / `node:path` — IO belongs to the injected port and to the
 *               adapter that builds it, never to this layer or to `@lore/core`
 *
 * @spec_ref task-a-mistyped-task-file-anchor-is-stored-and-consulted
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectFileAnchorResolution,
  renderFileAnchorAdvisory,
  type FileAnchorProbeContext,
} from "../../../src/service/anchor-resolution.js";
import { unprobedFileAnchors } from "@lore/core";
import type { FsProbe } from "../../../src/service/drift-check-service.js";

/**
 * Fake `FsProbe` whose `stat` answers from a fixed table and records every call.
 * A path mapped to `"throw"` throws — the symlink-escape shape `buildRealFsProbe`
 * produces for real (BUG-015), which must classify as `probe_error`.
 */
function fakeProbe(table: Record<string, "file" | "dir" | "missing" | "throw">): {
  ctx: FileAnchorProbeContext;
  calls: string[];
} {
  const calls: string[] = [];
  const probe: FsProbe = {
    stat(path: string) {
      calls.push(path);
      const verdict = table[path];
      if (verdict === "throw") throw new Error(`refusing to probe "${path}"`);
      return verdict ?? "missing";
    },
    readFile() {
      throw new Error("readFile must not be called by the file-anchor probe");
    },
    listDir() {
      throw new Error("listDir must not be called by the file-anchor probe");
    },
  };
  return { ctx: { probe, root: "/repo/root" }, calls };
}

describe("collectFileAnchorResolution — HAPPY (the CONTROL)", () => {
  it("every anchor resolving yields probed:true with an EMPTY unresolved list and echoes the root", () => {
    const { ctx } = fakeProbe({ "src/a.ts": "file", "src/dir": "dir" });
    const report = collectFileAnchorResolution(["src/a.ts", "src/dir/"], ctx);
    expect(report.probed).toBe(true);
    expect(report.unresolved).toEqual([]);
    expect(report.root).toBe("/repo/root");
  });

  it("renders ZERO advisory lines when nothing fails to resolve", () => {
    const { ctx } = fakeProbe({ "src/a.ts": "file" });
    const report = collectFileAnchorResolution(["src/a.ts"], ctx);
    expect(renderFileAnchorAdvisory(report, { subject: "task-demo" })).toEqual([]);
  });
});

describe("collectFileAnchorResolution — NEGATIVE", () => {
  it("a non-resolving anchor is reported with its exact declared string", () => {
    const { ctx } = fakeProbe({});
    const report = collectFileAnchorResolution(["packages/lore/src/does-not-exist.ts"], ctx);
    expect(report.unresolved).toEqual([
      { anchor: "packages/lore/src/does-not-exist.ts", kind: "file_missing" },
    ]);
  });

  it("renders an advisory naming the path, its kind, the probe root, and the subject", () => {
    const { ctx } = fakeProbe({});
    const report = collectFileAnchorResolution(["packages/lore/src/does-not-exist.ts"], ctx);
    const lines = renderFileAnchorAdvisory(report, { subject: "task-demo" });
    const text = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(text).toContain("packages/lore/src/does-not-exist.ts");
    expect(text).toContain("file_missing");
    expect(text).toContain("/repo/root");
    expect(text).toContain("task-demo");
  });

  it("the advisory states it is NOT a refusal and names the lost mutual exclusion", () => {
    const { ctx } = fakeProbe({});
    const report = collectFileAnchorResolution(["gone.ts"], ctx);
    const text = renderFileAnchorAdvisory(report, { subject: "task-demo" }).join("\n");
    expect(text).toMatch(/not a refusal/i);
    expect(text).toMatch(/mutual exclusion|mutex/i);
  });

  it("a directory-scope anchor whose directory is missing reports dir_missing", () => {
    const { ctx } = fakeProbe({});
    const report = collectFileAnchorResolution(["packages/lore/src/nope/"], ctx);
    expect(report.unresolved).toEqual([{ anchor: "packages/lore/src/nope/", kind: "dir_missing" }]);
  });
});

describe("collectFileAnchorResolution — BOUNDARY", () => {
  it("an empty anchor list probes nothing at all", () => {
    const { ctx, calls } = fakeProbe({});
    const report = collectFileAnchorResolution([], ctx);
    expect(report).toEqual({ probed: true, root: "/repo/root", unresolved: [] });
    expect(calls).toEqual([]);
  });

  it("two anchors sharing one filesystem path stat that path EXACTLY once", () => {
    const { ctx, calls } = fakeProbe({ "src/shared": "dir" });
    const report = collectFileAnchorResolution(["src/shared", "src/shared/"], ctx);
    expect(calls).toEqual(["src/shared"]);
    // `src/shared` (plain) against a directory is a node-type mismatch; the
    // directory-scope spelling of the same path resolves — one probe, two verdicts.
    expect(report.unresolved).toEqual([{ anchor: "src/shared", kind: "node_type_mismatch" }]);
  });
});

describe("collectFileAnchorResolution — ERROR", () => {
  it("a throwing probe becomes a probe_error row carrying the thrown message", () => {
    const { ctx } = fakeProbe({ "src/escape.ts": "throw" });
    const report = collectFileAnchorResolution(["src/escape.ts"], ctx);
    expect(report.unresolved).toHaveLength(1);
    expect(report.unresolved[0]?.kind).toBe("probe_error");
    expect(report.unresolved[0]?.detail).toContain("refusing to probe");
  });

  it("a throw on ONE path never aborts the scan — the other anchors are still classified", () => {
    const { ctx } = fakeProbe({ "src/escape.ts": "throw", "src/real.ts": "file" });
    const report = collectFileAnchorResolution(["src/escape.ts", "src/real.ts", "src/gone.ts"], ctx);
    expect(report.unresolved.map((r) => [r.anchor, r.kind])).toEqual([
      ["src/escape.ts", "probe_error"],
      ["src/gone.ts", "file_missing"],
    ]);
  });
});

describe("STATE — not probed is a different value from nothing found", () => {
  it("an unprobed report is not structurally equal to a clean probed report", () => {
    const { ctx } = fakeProbe({ "src/a.ts": "file" });
    const probedClean = collectFileAnchorResolution(["src/a.ts"], ctx);
    expect(unprobedFileAnchors("no-fs-probe")).not.toEqual(probedClean);
  });

  it("the renderer is silent for an unprobed report (it has no findings to report)", () => {
    expect(renderFileAnchorAdvisory(unprobedFileAnchors("no-fs-probe"), { subject: "task-demo" })).toEqual([]);
  });
});

describe("REGRESSION — the IO stays in the injected port", () => {
  it("service/anchor-resolution.ts imports no filesystem builtin", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, "..", "..", "..", "src", "service", "anchor-resolution.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const specifier of ["node:fs", "node:path", '"fs"', '"path"', '"os"']) {
      expect(code.includes(`from ${specifier}`)).toBe(false);
      expect(code.includes(`from "${specifier}"`)).toBe(false);
    }
  });
});
