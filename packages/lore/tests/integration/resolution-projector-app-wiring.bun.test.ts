/**
 * @spec_ref task-skill-implement-wire-a-real-resolutionlabelport-so-the,
 *   spec-the-defect-channel-reaches-no-machine-but-its-own-github, AC-GI-4
 *   (production-reachability half).
 *
 * The DISTRIBUTION oracle for `app.resolutionProjector`: `ResolutionProjector`
 * (`resolution-projector.ts`) landed with 19/19 green unit tests, including a
 * spy proving `lore issue resolve` CALLS it — but `createApp` never assigned
 * the field, so in production the projection was a no-op regardless of how
 * green the unit suite stayed. This file exercises the REAL `createApp`
 * composition root (never a hand-built `App` test fixture) so a future
 * regression that drops the wiring (either store branch) turns red HERE,
 * not just in a unit test that never constructs a real App.
 *
 * bun test (not vitest): `createApp` pulls in `bun:sqlite`.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus — runs inside its own
 * `mkdtempSync` directory (project CLAUDE.md hard rule).
 *
 * Coverage: HAPPY (the field is defined and has the shape `.project` a real
 * caller depends on) — this is deliberately the ONLY case; there is no
 * "config permutation" that legitimately produces `undefined` in production
 * (see this task's own AC-1, which spells out exactly this assertion against
 * exactly this composition root).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import { ResolutionProjector } from "../../src/service/resolution-projector.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-resolution-projector-wiring-")));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function dbPath(): string {
  return join(tmpDir, ".lore", "lore.db");
}

describe("createApp wiring — resolutionProjector (AC-GI-4 production-reachability)", () => {
  it("HAPPY: the real composition root returns an App whose resolutionProjector is defined and is a real ResolutionProjector", () => {
    // reason: `createApp(dbPath)` with no config always returns a bare `App`
    // (the `Result<App>` arm exists only for the sync-enabled TursoStore
    // path, D-007) — same single-argument narrowing every other integration
    // bun test in this suite relies on.
    const app = createApp(dbPath()) as App;
    try {
      expect(app.resolutionProjector).toBeDefined();
      expect(app.resolutionProjector).toBeInstanceOf(ResolutionProjector);
      expect(typeof app.resolutionProjector?.project).toBe("function");
    } finally {
      app.close();
    }
  });
});
