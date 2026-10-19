/**
 * task-audit-verification-checks-every-version-pre-writer-history: `audit.verify_since` is retired. The loader refuses
 * a config that still sets it, naming `lore migrate audit-backfill --apply`; the pure remover cuts exactly that line.
 *
 *   NEGATIVE:   any value is refused with the exact message; the refusal is recognised by `isRetiredVerifySinceError`
 *   BOUNDARY:   a config without the setting loads; an `audit:` section holding other keys keeps them
 *   STATE:      the remover cuts only the setting's line (and the emptied `audit:` parent); absent -> ok(undefined)
 *   ERROR:      malformed YAML and a flow-style mapping are refused, nothing rewritten
 */

import { describe, expect, it } from "vitest";
import {
  AUDIT_BACKFILL_MIGRATE_COMMAND,
  isRetiredVerifySinceError,
  loadConfigFromString,
  removeRetiredVerifySinceSetting,
  RETIRED_VERIFY_SINCE_MESSAGE,
} from "../src/index.js";

describe("loadConfigFromString refuses the retired audit cut-off", () => {
  it("NEGATIVE: the setting is refused with the exact message naming the migrate action", () => {
    const result = loadConfigFromString('audit:\n  verify_since: "2026-07-06T12:02:00Z"\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRetiredVerifySinceError(result.error)).toBe(true);
    expect(result.error).toMatchObject({ message: RETIRED_VERIFY_SINCE_MESSAGE, value: "2026-07-06T12:02:00Z" });
    expect(RETIRED_VERIFY_SINCE_MESSAGE).toContain(AUDIT_BACKFILL_MIGRATE_COMMAND);
    expect(AUDIT_BACKFILL_MIGRATE_COMMAND).toBe("lore migrate audit-backfill --apply");
  });

  it("BOUNDARY: a config without the setting loads", () => {
    expect(loadConfigFromString("project:\n  name: x\n  author: a\n").ok).toBe(true);
  });
});

describe("removeRetiredVerifySinceSetting", () => {
  it("STATE: cuts the setting's line and the emptied audit parent; every other byte is kept", () => {
    const text = '# top\nproject:\n  name: x\naudit:\n  verify_since: "2026-07-06T12:02:00Z" # old\nverify:\n  default_timeout_ms: 1\n';
    const removed = removeRetiredVerifySinceSetting(text);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value).toEqual({ text: "# top\nproject:\n  name: x\nverify:\n  default_timeout_ms: 1\n", value: "2026-07-06T12:02:00Z" });
  });

  it("BOUNDARY: other keys under audit: survive; only the setting's line goes", () => {
    const removed = removeRetiredVerifySinceSetting('audit:\n  keep: 1\n  verify_since: "2026-07-06T12:02:00Z"\n');
    expect(removed.ok && removed.value?.text).toBe("audit:\n  keep: 1\n");
  });

  it("STATE: an absent setting is ok(undefined), never an error", () => {
    expect(removeRetiredVerifySinceSetting("project:\n  name: x\n")).toEqual({ ok: true, value: undefined });
  });

  it("ERROR: malformed YAML and a flow-style mapping are refused", () => {
    expect(removeRetiredVerifySinceSetting("audit: [unclosed").ok).toBe(false);
    const flow = removeRetiredVerifySinceSetting('audit: { verify_since: "2026-07-06T12:02:00Z", keep: 1 }\n');
    expect(flow.ok).toBe(false);
    if (flow.ok) return;
    expect(flow.error).toMatchObject({ field: "audit.verify_since" });
    expect((flow.error as { message: string }).message).toContain("delete it by hand");
  });
});
