/**
 * Test helper (bun --preload): records every call of the site census entry points to the file named by
 * `CENSUS_CALL_LOG`, one line per call, then delegates to the real implementation.
 *
 * Purpose: prove a process never runs the site census (AC-BCG-2): the census module's `listSites` and `listSitesMany` are renamed
 *   at load time and re-exported as recording wrappers, so any importer that reaches the census appends a line.
 * Side-effect class: IO (appends to the log file).
 */
import { plugin } from "bun";

plugin({
  name: "census-recorder",
  setup(build) {
    build.onLoad({ filter: /packages\/lore\/src\/service\/site-census\.ts$/ }, async (args) => {
      const source = await Bun.file(args.path).text();
      const renamed = source
        .replace("export function listSitesMany(", "function __realListSitesMany(")
        .replace("export function listSites(", "function __realListSites(");
      const wrappers = `
import { appendFileSync as __append } from "node:fs";
const __record = (name) => { const log = process.env.CENSUS_CALL_LOG; if (log) __append(log, name + "\\n"); };
export function listSitesMany(...a) { __record("listSitesMany"); return __realListSitesMany(...a); }
export function listSites(...a) { __record("listSites"); return __realListSites(...a); }
`;
      return { contents: renamed + wrappers, loader: "ts" };
    });
  },
});
