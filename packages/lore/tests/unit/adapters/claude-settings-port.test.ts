/**
 * ClaudeSettingsPort.mergeLanguage — injected fake fs, never the real ~/.claude.
 * @spec_ref spec-context-fragments-config-driven-layered-rule-injection#AC-CF-5 spec-context-fragments-config-driven-layered-rule-injection#AC-CF-18
 */
import { describe, expect, it } from "vitest";
import { ClaudeSettingsPort, resolveLanguageName, type ClaudeSettingsFs } from "../../../src/adapters/claude-settings-port.js";

function fakeFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const fs: ClaudeSettingsFs = {
    read: (path) => files.get(path) ?? null,
    write: (path, content) => {
      writes.push(path);
      files.set(path, content);
    },
  };
  return { fs, files, writes };
}

function messageOf(error: object): string {
  return "message" in error && typeof error.message === "string" ? error.message : "";
}

const PATH = "/x/.claude/settings.json";

describe("ClaudeSettingsPort.mergeLanguage", () => {
  it("HAPPY: preserves every other key, their order and the 2-space indent, appending language", () => {
    const seed = `{\n  "theme": "dark",\n  "env": {\n    "FOO": "bar"\n  },\n  "permissions": { "allow": ["Bash(ls:*)"] }\n}\n`;
    const { fs, files } = fakeFs({ [PATH]: seed });
    const r = new ClaudeSettingsPort(fs).mergeLanguage(PATH, "Chinese");
    expect(r).toEqual({ ok: true, value: { changed: true } });
    const out = files.get(PATH) as string;
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["theme", "env", "permissions", "language"]);
    expect(parsed["language"]).toBe("Chinese");
    expect(parsed["env"]).toEqual({ FOO: "bar" });
    expect(parsed["permissions"]).toEqual({ allow: ["Bash(ls:*)"] });
    expect(out.startsWith('{\n  "theme"')).toBe(true);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("HAPPY: replaces an existing language in place (key order unchanged)", () => {
    const { fs, files } = fakeFs({ [PATH]: `{"language":"French","a":1}` });
    expect(new ClaudeSettingsPort(fs).mergeLanguage(PATH, "English").ok).toBe(true);
    const parsed = JSON.parse(files.get(PATH) as string) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["language", "a"]);
    expect(parsed["language"]).toBe("English");
  });

  it("BOUNDARY: creates an absent file holding only language", () => {
    const { fs, files } = fakeFs();
    const r = new ClaudeSettingsPort(fs).mergeLanguage(PATH, "Chinese");
    expect(r).toEqual({ ok: true, value: { changed: true } });
    expect(JSON.parse(files.get(PATH) as string)).toEqual({ language: "Chinese" });
  });

  it("STATE: already-equal language performs no write (idempotent)", () => {
    const seed = `{"language":"Chinese"}`;
    const { fs, writes } = fakeFs({ [PATH]: seed });
    const r = new ClaudeSettingsPort(fs).mergeLanguage(PATH, "Chinese");
    expect(r).toEqual({ ok: true, value: { changed: false } });
    expect(writes).toEqual([]);
  });

  it("ERROR: malformed JSON is refused loudly and the file is never overwritten", () => {
    const { fs, files, writes } = fakeFs({ [PATH]: `{ "theme": ` });
    const r = new ClaudeSettingsPort(fs).mergeLanguage(PATH, "Chinese");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION_ERROR");
      expect(messageOf(r.error)).toContain(PATH);
    }
    expect(writes).toEqual([]);
    expect(files.get(PATH)).toBe(`{ "theme": `);
  });

  it("NEGATIVE: a JSON file whose root is not an object is refused, not overwritten", () => {
    for (const body of ["[1,2]", "null", '"s"', "7"]) {
      const { fs, writes } = fakeFs({ [PATH]: body });
      const r = new ClaudeSettingsPort(fs).mergeLanguage(PATH, "Chinese");
      expect(r.ok).toBe(false);
      expect(writes).toEqual([]);
    }
  });

  it("ERROR: an empty (zero-byte) file is refused rather than treated as absent", () => {
    const { fs, writes } = fakeFs({ [PATH]: "" });
    expect(new ClaudeSettingsPort(fs).mergeLanguage(PATH, "Chinese").ok).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("resolveLanguageName", () => {
  it("HAPPY: maps known codes", () => {
    expect(resolveLanguageName("zh", "global")).toEqual({ ok: true, value: "Chinese" });
    expect(resolveLanguageName("en", "project")).toEqual({ ok: true, value: "English" });
  });

  it("NEGATIVE: unknown code is VALIDATION_ERROR naming the code and layer", () => {
    const r = resolveLanguageName("zz9", "global");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION_ERROR");
      expect(messageOf(r.error)).toContain("zz9");
      expect(messageOf(r.error)).toContain("global");
    }
  });

  it("BOUNDARY: prototype keys are not language codes", () => {
    expect(resolveLanguageName("constructor", "global").ok).toBe(false);
    expect(resolveLanguageName("toString", "global").ok).toBe(false);
  });
});
