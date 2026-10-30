/**
 * @spec_ref spec-a-corpus-only-task-has-nothing-to-measure-and-a-closed (AC-AQ-2, BR-1510)
 *
 * The app `createApp` builds wires the issue writer a close with a detached known defect needs: with a GitHub
 * `feedback.upstream` the app has a writer (so the detach and every batch's retry reach GitHub, never a pending row
 * from a missing writer); without one it has none. Uses `bun:sqlite` through `createApp`, so it is a `.bun.test.ts`.
 *
 * Dimensions: HAPPY (configured -> writer wired, plan-close reader wired too), NEGATIVE (unconfigured -> none),
 * REGRESSION (no config at all -> none). The close-time use of the wired writer is covered in
 * known-defects-at-close.test.ts with a fake writer; this file pins that production wires one.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig, type LoreConfig } from "@lore/core";
import { createApp, type App } from "../../src/app.js";
import { liveAmbient, liveWriteContext } from "../live-invocation.js";

const dirs: string[] = [];
const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function build(config: LoreConfig | undefined): App {
  const dir = mkdtempSync(join(tmpdir(), "lore-kd-writer-"));
  dirs.push(dir);
  const app = createApp(join(dir, "lore.db"), config, liveAmbient(), liveWriteContext()) as App;
  apps.push(app);
  return app;
}

function configOf(raw: Record<string, unknown>): LoreConfig {
  const parsed = parseConfig(raw);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

describe("AC-AQ-2 the app wires the known-defect issue writer", () => {
  it("AC-AQ-2 HAPPY: a GitHub feedback.upstream wires the writer next to the plan-close issue reader", () => {
    const app = build(configOf({ project: { name: "lore", author: "owner" }, feedback: { upstream: { repo: "acme/widget" } } }));
    const writer = app.corpusService.getKnownDefectIssueWriter();
    expect(writer).toBeDefined();
    expect(typeof writer?.commentIssue).toBe("function");
    expect(typeof writer?.closeIssue).toBe("function");
    expect(app.corpusService.getPlanCloseIssuePort()).toBeDefined();
  });

  it("AC-AQ-2 NEGATIVE: with no feedback.upstream no writer is wired", () => {
    const app = build(configOf({ project: { name: "lore", author: "owner" } }));
    expect(app.corpusService.getKnownDefectIssueWriter()).toBeUndefined();
    expect(app.corpusService.getPlanCloseIssuePort()).toBeUndefined();
  });

  it("AC-AQ-2 REGRESSION: with no config at all no writer is wired either", () => {
    expect(build(undefined).corpusService.getKnownDefectIssueWriter()).toBeUndefined();
  });
});
