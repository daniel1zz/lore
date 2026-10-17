/**
 * The Node invocation of the same vitest setup (`bunx vitest run -c vitest.node.config.ts`,
 * no `--bun`): runs ONLY the files listed BY FILE in vitest.node-files.ts, each with a recorded
 * reason it cannot run under the Bun runtime yet. Never a glob.
 */
import { createConfig } from "./vitest.shared";
import { NODE_PROJECT_FILES } from "./vitest.node-files";

export default createConfig({
  include: Object.keys(NODE_PROJECT_FILES),
  exclude: ["**/*.pw.ts", "node_modules/**"],
});
