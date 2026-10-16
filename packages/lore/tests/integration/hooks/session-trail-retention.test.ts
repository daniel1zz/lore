/**
 * @spec_ref AC-ST-5
 *
 * Retention at SessionStart (spec D11, D17): a session trail idle for more than 14 days is
 * replaced by removed.json, a removal marker older than 90 days is removed, the starting
 * session, state.db and non-directory entries are never touched, and a session that resumes
 * after removal keeps its original started_at.
 *
 * Isolation (I1): mkdtemp state bases; ages are set with utimes on throwaway files only.
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSessionTrail } from "@lore/core/node";
import { makeTmpDir, runHook } from "./hook-harness";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});
function scratchBase(): string {
  const d = makeTmpDir("st-retention-");
  cleanup.push(d);
  mkdirSync(join(d, "sessions"), { recursive: true });
  return d;
}

/** Set mtime of every file and directory under `dir` (and `dir`) to `ageMs` ago. */
function age(dir: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) age(join(dir, entry.name), ageMs);
    else utimesSync(join(dir, entry.name), when, when);
  }
  utimesSync(dir, when, when);
}

/** A trail with a session.json, one turn and a helper, all aged `ageMs`. */
function seedSession(base: string, sid: string, ageMs: number, startedAt: string | null = "2026-08-01T00:00:00.000Z"): string {
  const dir = join(base, "sessions", sid);
  mkdirSync(join(dir, "t1"), { recursive: true });
  mkdirSync(join(dir, "helpers"), { recursive: true });
  if (startedAt !== null) writeFileSync(join(dir, "session.json"), JSON.stringify({ started_at: startedAt }));
  writeFileSync(join(dir, "t1", "edited-files.jsonl"), '{"file":"/x","ts":1}\n');
  writeFileSync(join(dir, "helpers", "A.json"), JSON.stringify({ run: `cc:${sid}:A`, started_at: "t", end_count: 0 }));
  writeFileSync(join(dir, "current-turn.id"), "t1");
  age(dir, ageMs);
  return dir;
}

function seedMarker(base: string, sid: string, ageMs: number): string {
  const dir = join(base, "sessions", sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "removed.json"), JSON.stringify({ removed_at: new Date(Date.now() - ageMs).toISOString(), started_at: null }));
  age(dir, ageMs);
  return dir;
}

const start = (base: string, sid: string, source = "startup") =>
  runHook("session-trail-start.mjs", { session_id: sid, hook_event_name: "SessionStart", source }, base);

describe("AC-ST-5 retention at SessionStart", () => {
  it("AC-ST-5 a trail idle 14 days + 1 hour is replaced by removed.json carrying the removal date and started_at", () => {
    const base = scratchBase();
    const dir = seedSession(base, "old", 14 * DAY + HOUR);
    const before = Date.now();
    const r = start(base, "current");
    expect([r.status, r.stdout, r.stderr]).toEqual([0, "", ""]);
    expect(readdirSync(dir)).toEqual(["removed.json"]);
    const marker = JSON.parse(readFileSync(join(dir, "removed.json"), "utf8"));
    expect(marker.started_at).toBe("2026-08-01T00:00:00.000Z");
    expect(Date.parse(marker.removed_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(marker.removed_at)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("AC-ST-5 a trail idle 13 days 23 hours is kept whole", () => {
    const base = scratchBase();
    const dir = seedSession(base, "recent", 14 * DAY - HOUR);
    start(base, "current");
    expect(readdirSync(dir).sort()).toEqual(["current-turn.id", "helpers", "session.json", "t1"]);
    expect(existsSync(join(dir, "removed.json"))).toBe(false);
  });

  it("AC-ST-5 idleness is the newest write anywhere in the trail, not the oldest file", () => {
    const base = scratchBase();
    const dir = seedSession(base, "mixed", 20 * DAY);
    const fresh = new Date(Date.now() - DAY);
    utimesSync(join(dir, "t1", "edited-files.jsonl"), fresh, fresh); // one recent edit keeps the whole trail
    start(base, "current");
    expect(existsSync(join(dir, "session.json"))).toBe(true);
    expect(existsSync(join(dir, "removed.json"))).toBe(false);
  });

  it("AC-ST-5 the starting session's own trail with 30-day-old files is kept", () => {
    const base = scratchBase();
    const dir = seedSession(base, "current", 30 * DAY);
    start(base, "current", "resume");
    expect(readdirSync(dir).sort()).toEqual(["current-turn.id", "helpers", "session.json", "t1"]);
    expect(existsSync(join(dir, "removed.json"))).toBe(false);
  });

  it("AC-ST-5 state.db, a non-directory entry and a symlinked directory in the sessions base are untouched", () => {
    const base = scratchBase();
    const sessions = join(base, "sessions");
    writeFileSync(join(sessions, "state.db"), "sqlite-bytes");
    writeFileSync(join(sessions, "notes.txt"), "not a session");
    writeFileSync(join(base, "state.db"), "legacy db");
    const old = new Date(Date.now() - 400 * DAY);
    for (const f of [join(sessions, "state.db"), join(sessions, "notes.txt"), join(base, "state.db")]) utimesSync(f, old, old);
    const target = makeTmpDir("st-retention-target-"); cleanup.push(target);
    writeFileSync(join(target, "keep.txt"), "outside");
    utimesSync(join(target, "keep.txt"), old, old);
    utimesSync(target, old, old);
    symlinkSync(target, join(sessions, "linked"));

    const r = start(base, "current");
    expect(r.status).toBe(0);
    expect(readFileSync(join(sessions, "state.db"), "utf8")).toBe("sqlite-bytes");
    expect(readFileSync(join(sessions, "notes.txt"), "utf8")).toBe("not a session");
    expect(readFileSync(join(base, "state.db"), "utf8")).toBe("legacy db");
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("outside");
    expect(statSync(join(sessions, "state.db")).mtimeMs).toBeCloseTo(old.getTime(), -3);
  });

  it("AC-ST-5 a session resumed after removal lists its earlier part as removed on that date via the reader", () => {
    const base = scratchBase();
    seedSession(base, "old", 15 * DAY);
    start(base, "current");
    expect(readSessionTrail("old", base)!.removed).not.toBeNull();
    const removedAt = readSessionTrail("old", base)!.removed!.removed_at;

    start(base, "old", "resume");
    const trail = readSessionTrail("old", base)!;
    expect(trail.removed).toEqual({ removed_at: removedAt, started_at: "2026-08-01T00:00:00.000Z" });
    expect(trail.turns).toEqual([]); // the lost part reads removed, never as "no change"
  });

  it("AC-ST-5 removed.json carries the started_at of the removed session.json and the resumed session writes it back", () => {
    const base = scratchBase();
    seedSession(base, "old", 15 * DAY, "2026-07-04T01:02:03.000Z");
    start(base, "current");
    expect(JSON.parse(readFileSync(join(base, "sessions", "old", "removed.json"), "utf8")).started_at).toBe("2026-07-04T01:02:03.000Z");
    start(base, "old", "resume");
    expect(JSON.parse(readFileSync(join(base, "sessions", "old", "session.json"), "utf8"))).toEqual({ started_at: "2026-07-04T01:02:03.000Z" });
    // a further resume never rewrites it
    start(base, "old", "compact");
    expect(JSON.parse(readFileSync(join(base, "sessions", "old", "session.json"), "utf8")).started_at).toBe("2026-07-04T01:02:03.000Z");
  });

  it("AC-ST-5 a removed trail that never had a session.json records started_at null, not an invented date", () => {
    const base = scratchBase();
    seedSession(base, "legacy", 20 * DAY, null);
    start(base, "current");
    expect(JSON.parse(readFileSync(join(base, "sessions", "legacy", "removed.json"), "utf8")).started_at).toBeNull();
    start(base, "legacy");
    const startedAt = readSessionTrail("legacy", base)!.started_at;
    expect(Date.now() - Date.parse(startedAt!)).toBeLessThan(60_000); // a fresh window, honestly dated now
  });

  it("AC-ST-5 a marker written 90 days + 1 hour ago is removed, one written 89 days 23 hours ago is kept", () => {
    const base = scratchBase();
    const expired = seedMarker(base, "marker-old", 90 * DAY + HOUR);
    const live = seedMarker(base, "marker-new", 90 * DAY - HOUR);
    start(base, "current");
    expect(existsSync(expired)).toBe(false);
    expect(readdirSync(live)).toEqual(["removed.json"]);
  });

  it("AC-ST-5 a kept marker is not re-marked by the 14-day rule (its age is not renewed)", () => {
    const base = scratchBase();
    const dir = seedMarker(base, "marker", 30 * DAY);
    const before = readFileSync(join(dir, "removed.json"), "utf8");
    start(base, "current");
    expect(readFileSync(join(dir, "removed.json"), "utf8")).toBe(before);
  });
});
