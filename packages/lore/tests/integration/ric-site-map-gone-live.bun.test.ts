// @reads packages/**
// @reads scripts/**
// @reads assets/**
/**
 * @spec_ref spec-refusal-sites-declare-their-rule-in-code-baseline-leaf  AC-RIC-6 (BR-1344)
 *
 * Live end state of THIS repository, read-only (the db is opened `readonly`; nothing is written to the repo `.lore/`):
 *   - no baseline leaf carries the key `extra.site_map`, asserted as KEY ABSENCE (an empty object fails);
 *   - no product source file (packages/*\/src, scripts/, assets/) names `convert-site-map`, so no converter ships.
 *
 * Runs after the landing, once the corpus keys are removed in one pass; before that it is red by design.
 *
 * SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a leaf keeping an EMPTY `site_map` object passes a "no rows" check; the check
 * here reads the key's presence through `json_type`, and a throwaway db with one restored key (empty or not) must be flagged.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { findMainCheckoutLoreDb } from "../../src/adapters/cli/corpus-resolution.js";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const KEY = ["site", "map"].join("_");
const CONVERTER = ["convert", "site", "map"].join("-");

/** Slugs of the baseline docs whose `extra` carries the key (present with any value, `{}` and `null` included). */
function docsCarryingKey(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query("select slug from docs where type = 'baseline' and deleted_at is null and json_type(extra, ?) is not null order by slug")
      .all(`$.${KEY}`) as { slug: string }[];
    return rows.map((r) => r.slug);
  } finally {
    db.close();
  }
}

function liveDbPath(): string {
  const own = join(REPO_ROOT, ".lore", "lore.db");
  if (existsSync(own)) return own;
  const main = findMainCheckoutLoreDb(REPO_ROOT);
  if (main === undefined) throw new Error(`no .lore/lore.db found for ${REPO_ROOT}`);
  return main;
}

function productSourceFiles(): string[] {
  const roots = [
    ...readdirSync(join(REPO_ROOT, "packages")).map((p) => join(REPO_ROOT, "packages", p, "src")),
    join(REPO_ROOT, "scripts"),
    join(REPO_ROOT, "assets"),
  ].filter((p) => existsSync(p) && statSync(p).isDirectory());
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else files.push(abs);
    }
  };
  for (const root of roots) walk(root);
  return files;
}

describe("AC-RIC-6 — no corpus site mappings remain and no converter ships", () => {
  it("(1) no live baseline leaf carries the key extra.site_map (key absence, not an empty object)", () => {
    expect(docsCarryingKey(liveDbPath())).toEqual([]);
  });

  it("(2) no product source file names the converter", () => {
    const hits = productSourceFiles().filter((f) => readFileSync(f).includes(CONVERTER));
    expect(hits.map((f) => relative(REPO_ROOT, f))).toEqual([]);
  });

  it("(3) falsifier: a throwaway corpus copy with one key restored is flagged, even when the value is an empty object", () => {
    const dir = mkdtempSync(join(tmpdir(), "ric6-"));
    try {
      const copy = join(dir, "lore.db");
      const db = new Database(copy);
      db.run("create table docs (slug text, type text, extra text, deleted_at text)");
      db.run("insert into docs values ('clean', 'baseline', '{\"node\":\"leaf\"}', null)");
      db.run(`insert into docs values ('empty-object', 'baseline', '{"node":"leaf","${KEY}":{}}', null)`);
      db.run(`insert into docs values ('with-rows', 'baseline', '{"node":"leaf","${KEY}":{"a#b#C":["BR-1"]}}', null)`);
      db.close();
      expect(docsCarryingKey(copy)).toEqual(["empty-object", "with-rows"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
