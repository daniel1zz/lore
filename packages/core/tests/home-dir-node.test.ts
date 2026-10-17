/**
 * currentHomeDir (src/home-dir-node.ts): `$HOME` read at call time, with `os.homedir()` as the fallback.
 * Coverage: HAPPY (HOME set), STATE (a later change of HOME is believed, which Bun's os.homedir() does not do),
 * BOUNDARY (empty HOME falls back), NEGATIVE (HOME unset falls back, never undefined or empty).
 */
import { afterEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { currentHomeDir } from "../src/home-dir-node";

const originalHome = process.env["HOME"];

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
});

describe("currentHomeDir", () => {
  it("returns $HOME when it is set", () => {
    process.env["HOME"] = "/tmp/lore-home-probe";
    expect(currentHomeDir()).toBe("/tmp/lore-home-probe");
  });

  it("follows a later change of $HOME (the process-start value is not cached)", () => {
    process.env["HOME"] = "/tmp/lore-home-a";
    const first = currentHomeDir();
    process.env["HOME"] = "/tmp/lore-home-b";
    expect([first, currentHomeDir()]).toEqual(["/tmp/lore-home-a", "/tmp/lore-home-b"]);
  });

  it("falls back to os.homedir() when $HOME is empty", () => {
    process.env["HOME"] = "";
    expect(currentHomeDir()).toBe(homedir());
    expect(currentHomeDir()).not.toBe("");
  });

  it("falls back to os.homedir() when $HOME is unset", () => {
    delete process.env["HOME"];
    expect(currentHomeDir()).toBe(homedir());
  });
});
