/**
 * Test helper: gives a hand-built `FsProbe` stub the production export reader (BR-417), so a symbol
 * anchor against stub file text is decided by the same TypeScript parse the real probe uses.
 * A stub WITHOUT it reports symbol anchors as "not measured" — which is itself a tested behaviour.
 */

import type { FsProbe } from "@lore/core";
import { createExportReader } from "../src/service/export-reader.js";

/**
 * @param probe - A stub probe whose `readFile` serves the fixture text.
 * @returns The same probe plus `readExportedNames`, reading followed modules through `probe.readFile`.
 */
export function withExportReader<T extends FsProbe>(probe: T): T & Required<Pick<FsProbe, "readExportedNames">> {
  const read = createExportReader((path) => probe.readFile(path));
  return { ...probe, readExportedNames: (path: string, content: string) => read(path, content) };
}
