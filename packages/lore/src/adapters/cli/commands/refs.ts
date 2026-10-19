/**
 * lore refs <path> [--json] — which prose and specs bind to this path.
 * Thin read pipe over the ONE reverse index (`service/code-reference-index.ts`,
 * spec-prose-about-code-is-bound-to-what-it-describes-one D2): spec and knowledge
 * `code_anchors`, plus the code references written in memory files and context fragments,
 * each with the document, the line and the bound path / symbol / script.
 *
 * Reads only: no document, version or audit row is written, and an unbound path is an empty
 * answer, not an error.
 *
 * Exit codes (SPEC-003 §5):
 *   0 = answered (including "nothing binds this path")
 *   1 = the corpus could not be read, or package.json exists but has no usable `scripts`
 *   4 = the argument is not a repo-relative path
 */

import {
  GOVERNING_PACKAGE_JSON,
  resolveMemoryFileBudgets,
  scanPackageScripts,
} from "@lore/core";
import { defineLoreCommand } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import { buildRealFsProbe } from "../../real-fs-probe.js";
import { discoverFragmentDocuments, discoverMemoryFiles } from "../../real-memory-file-probe.js";
import {
  buildReferenceIndex,
  findBindings,
  normalizeQueryPath,
  type ReferenceBinding,
} from "../../../service/code-reference-index.js";

/** One human-readable line per binding: `<kind>  <document>[:line]  <reference>`. */
function formatBindingLine(binding: ReferenceBinding): string {
  const where = binding.line === undefined ? binding.document : `${binding.document}:${binding.line}`;
  return `  ${binding.document_kind.padEnd(11)} ${where}  ${binding.reference}`;
}

export default defineLoreCommand({
  meta: {
    name: "refs",
    description: "List the specs, memory files and fragments whose statements bind to a path",
  },
  args: {
    path: {
      type: "positional",
      description: "Repo-relative file or folder path",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);

    const queryResult = normalizeQueryPath(args.path as string);
    if (!queryResult.ok) {
      inv.io.stderr.write(formatErrorFor(inv, queryResult.error) + "\n");
      return exitCode(queryResult.error);
    }

    const { app, config } = loadLoreApp({ inv });
    if (app.driftCheckService === undefined) {
      inv.io.stderr.write("Error: DriftCheckService not wired on this App instance.\n");
      return 1;
    }

    const anchorsResult = await app.driftCheckService.listDeclaredAnchors();
    if (!anchorsResult.ok) {
      inv.io.stderr.write(formatErrorFor(inv, anchorsResult.error) + "\n");
      return exitCode(anchorsResult.error);
    }

    const probe = buildRealFsProbe(inv.cwd);
    let knownScripts: ReadonlySet<string> = new Set();
    if (probe.stat(GOVERNING_PACKAGE_JSON) === "file") {
      const scripts = scanPackageScripts(probe.readFile(GOVERNING_PACKAGE_JSON) ?? "");
      if (scripts === undefined) {
        inv.io.stderr.write(`Error: ${GOVERNING_PACKAGE_JSON} has no usable scripts object.\n`);
        return 1;
      }
      knownScripts = scripts;
    }

    const index = buildReferenceIndex({
      declaredAnchors: anchorsResult.value,
      memoryFiles: discoverMemoryFiles(inv.cwd, resolveMemoryFileBudgets(config).filenames),
      fragments: discoverFragmentDocuments(inv.cwd),
      knownScripts,
      probe,
    });
    const bindings = findBindings(index, queryResult.value);

    if (args.json) {
      printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { path: queryResult.value, bindings } }, null, 2));
      return 0;
    }

    if (bindings.length === 0) {
      printLine(inv.io.stdout, `Nothing binds ${queryResult.value}.`);
      return 0;
    }
    printLine(inv.io.stdout, `${bindings.length} statement(s) bind ${queryResult.value}:`);
    for (const binding of bindings) printLine(inv.io.stdout, formatBindingLine(binding));
    return 0;
  },
});
