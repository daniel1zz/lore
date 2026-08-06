/**
 * Tests for @lore/core file-anchors.ts's RESOLUTION-classification half —
 * `fileAnchorProbePath` / `classifyFileAnchorResolution` / `unprobedFileAnchors`
 * (task-a-mistyped-task-file-anchor-is-stored-and-consulted). Pure, no IO: the
 * filesystem observations arrive as an already-collected map, exactly as
 * `computeDrift`'s `probes` argument does — this module must never gain an fs
 * import (`packages/core/tests/browser-safety.test.ts` is the standing oracle
 * for that, and `file-anchors.test.ts` passes UNMODIFIED alongside this file).
 *
 * ⛔ These functions never REFUSE anything. A non-resolving anchor is an
 * advisory row, never a validation error — a task legitimately anchors a file
 * it is about to create. See `classifyFileAnchorResolution`'s JSDoc.
 *
 * Six-dimension coverage:
 *   HAPPY:      a file anchor whose path stats "file" and a directory-scope
 *               anchor (trailing "/") whose path stats "dir" both produce ZERO
 *               rows (the CONTROL — a blanket-advisory regression fails here)
 *   NEGATIVE:   stat "missing" → `file_missing` for a plain anchor,
 *               `dir_missing` for a directory-scope anchor, each naming the
 *               EXACT declared anchor string back
 *   BOUNDARY:   empty anchor list → []; `fileAnchorProbePath` strips exactly
 *               one trailing "/" and leaves every other char alone; a nested
 *               path keeps its full segment list as the probe key
 *   ERROR:      probe entry carrying `error` → `probe_error` with that detail;
 *               probe entry ABSENT from the map → `probe_error` naming the path
 *               (never silently "resolves"); stat present but undefined → treated
 *               as missing, never as resolved
 *   STATE:      re-classifying the SAME anchor list after the map flips
 *               missing→file drops the row (no memoized verdict); a node-type
 *               mismatch in both directions (dir anchor on a file, file anchor
 *               on a dir)
 *   REGRESSION: `unprobedFileAnchors()` is NOT structurally equal to a probed
 *               report with zero rows — "no non-resolving anchors" and "not
 *               probed" are different values, which is the whole point of the
 *               discriminated union (an empty array must never mean "unknown")
 *
 * @spec_ref task-a-mistyped-task-file-anchor-is-stored-and-consulted
 */

import { describe, it, expect } from "vitest";
import {
  FILE_ANCHOR_NONRESOLUTION_KINDS,
  classifyFileAnchorResolution,
  fileAnchorProbePath,
  unprobedFileAnchors,
  type FileAnchorProbeResult,
} from "../src/file-anchors.js";

/** Builds the already-collected probe map `classifyFileAnchorResolution` consumes. */
function probes(entries: Record<string, FileAnchorProbeResult>): Map<string, FileAnchorProbeResult> {
  return new Map(Object.entries(entries));
}

// ─── fileAnchorProbePath ────────────────────────────────────────────────────

describe("fileAnchorProbePath", () => {
  it("BOUNDARY: strips exactly one trailing slash (the directory-scope marker is not part of the fs path)", () => {
    expect(fileAnchorProbePath("src/service/")).toBe("src/service");
  });

  it("BOUNDARY: leaves a plain file anchor byte-identical", () => {
    expect(fileAnchorProbePath("src/service/a.ts")).toBe("src/service/a.ts");
  });

  it("BOUNDARY: a nested directory anchor keeps every leading segment", () => {
    expect(fileAnchorProbePath("packages/lore/src/adapters/")).toBe("packages/lore/src/adapters");
  });
});

// ─── classifyFileAnchorResolution ───────────────────────────────────────────

describe("classifyFileAnchorResolution — HAPPY (the CONTROL: resolving anchors are silent)", () => {
  it("a file anchor that stats as a file produces zero rows", () => {
    const rows = classifyFileAnchorResolution(
      ["packages/core/src/file-anchors.ts"],
      probes({ "packages/core/src/file-anchors.ts": { stat: "file" } }),
    );
    expect(rows).toEqual([]);
  });

  it("a directory-scope anchor that stats as a dir produces zero rows", () => {
    const rows = classifyFileAnchorResolution(
      ["packages/core/src/"],
      probes({ "packages/core/src": { stat: "dir" } }),
    );
    expect(rows).toEqual([]);
  });

  it("a mixed list where every entry resolves produces zero rows", () => {
    const rows = classifyFileAnchorResolution(
      ["a.ts", "b/", "c/d.ts"],
      probes({ "a.ts": { stat: "file" }, b: { stat: "dir" }, "c/d.ts": { stat: "file" } }),
    );
    expect(rows).toEqual([]);
  });
});

describe("classifyFileAnchorResolution — NEGATIVE (non-resolving anchors are named exactly)", () => {
  it("a missing file anchor is file_missing and echoes the declared string back verbatim", () => {
    const rows = classifyFileAnchorResolution(
      ["packages/lore/src/does-not-exist.ts"],
      probes({ "packages/lore/src/does-not-exist.ts": { stat: "missing" } }),
    );
    expect(rows).toEqual([{ anchor: "packages/lore/src/does-not-exist.ts", kind: "file_missing" }]);
  });

  it("a missing directory-scope anchor is dir_missing, keeping the trailing slash in the reported anchor", () => {
    const rows = classifyFileAnchorResolution(
      ["packages/lore/src/nope/"],
      probes({ "packages/lore/src/nope": { stat: "missing" } }),
    );
    expect(rows).toEqual([{ anchor: "packages/lore/src/nope/", kind: "dir_missing" }]);
  });

  it("reports every non-resolving entry in declaration order, skipping the resolving ones", () => {
    const rows = classifyFileAnchorResolution(
      ["real.ts", "gone.ts", "alsoreal/", "gone-dir/"],
      probes({
        "real.ts": { stat: "file" },
        "gone.ts": { stat: "missing" },
        alsoreal: { stat: "dir" },
        "gone-dir": { stat: "missing" },
      }),
    );
    expect(rows.map((r) => r.anchor)).toEqual(["gone.ts", "gone-dir/"]);
    expect(rows.map((r) => r.kind)).toEqual(["file_missing", "dir_missing"]);
  });
});

describe("classifyFileAnchorResolution — BOUNDARY", () => {
  it("an empty anchor list produces zero rows (nothing declared, nothing to advise)", () => {
    expect(classifyFileAnchorResolution([], probes({}))).toEqual([]);
  });

  it("every declared kind literal is one of FILE_ANCHOR_NONRESOLUTION_KINDS", () => {
    const rows = classifyFileAnchorResolution(
      ["gone.ts", "gone-dir/", "boom.ts", "unprobed.ts"],
      probes({
        "gone.ts": { stat: "missing" },
        "gone-dir": { stat: "missing" },
        "boom.ts": { error: "EACCES" },
      }),
    );
    for (const row of rows) {
      expect(FILE_ANCHOR_NONRESOLUTION_KINDS).toContain(row.kind);
    }
  });
});

describe("classifyFileAnchorResolution — ERROR (a probe that could not look never reports 'resolves')", () => {
  it("a probe entry carrying `error` becomes probe_error and forwards the detail", () => {
    const rows = classifyFileAnchorResolution(
      ["escaping-symlink.ts"],
      probes({ "escaping-symlink.ts": { error: "refusing to probe a symlink escape" } }),
    );
    expect(rows).toEqual([
      { anchor: "escaping-symlink.ts", kind: "probe_error", detail: "refusing to probe a symlink escape" },
    ]);
  });

  it("an anchor with NO probe entry at all is probe_error naming the path, never silently consistent", () => {
    const rows = classifyFileAnchorResolution(["never-probed.ts"], probes({}));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("probe_error");
    expect(rows[0]?.detail).toContain("never-probed.ts");
  });

  it("a probe entry present but with an undefined stat is treated as missing, never as resolved", () => {
    const rows = classifyFileAnchorResolution(["half-probed.ts"], probes({ "half-probed.ts": {} }));
    expect(rows).toEqual([{ anchor: "half-probed.ts", kind: "file_missing" }]);
  });
});

describe("classifyFileAnchorResolution — STATE", () => {
  it("the same anchor list re-classified against a fixed tree drops the row (no memoized verdict)", () => {
    const anchors = ["src/created-later.ts"];
    const before = classifyFileAnchorResolution(anchors, probes({ "src/created-later.ts": { stat: "missing" } }));
    const after = classifyFileAnchorResolution(anchors, probes({ "src/created-later.ts": { stat: "file" } }));
    expect(before).toHaveLength(1);
    expect(after).toEqual([]);
  });

  it("a directory-scope anchor pointing at a FILE is node_type_mismatch", () => {
    const rows = classifyFileAnchorResolution(["src/a.ts/"], probes({ "src/a.ts": { stat: "file" } }));
    expect(rows).toEqual([{ anchor: "src/a.ts/", kind: "node_type_mismatch" }]);
  });

  it("a plain file anchor pointing at a DIRECTORY is node_type_mismatch", () => {
    const rows = classifyFileAnchorResolution(["src/service"], probes({ "src/service": { stat: "dir" } }));
    expect(rows).toEqual([{ anchor: "src/service", kind: "node_type_mismatch" }]);
  });
});

describe("REGRESSION — 'not probed' and 'nothing found' are different values", () => {
  it("unprobedFileAnchors() carries probed:false plus an explicit reason", () => {
    expect(unprobedFileAnchors("no-fs-probe")).toEqual({ probed: false, reason: "no-fs-probe" });
  });

  it("an unprobed report is NOT structurally equal to a probed report with zero rows", () => {
    const unprobed = unprobedFileAnchors("no-fs-probe");
    const probedClean = { probed: true as const, root: "/repo", unresolved: [] };
    expect(unprobed).not.toEqual(probedClean);
    expect(unprobed.probed).toBe(false);
    // The discriminant — not an empty array — is what a consumer must branch on.
    expect("unresolved" in unprobed).toBe(false);
  });
});
