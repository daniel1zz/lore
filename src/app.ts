/**
 * Composition root — wires services to the SQLiteStore.
 * All adapters (CLI, MCP, HTTP) call createApp() to get a wired App instance.
 */

import { SQLiteStore } from "./store/sqlite-store.js";
import { CorpusService } from "./service/corpus-service.js";
import { ReviewService } from "./service/review-service.js";
import { VersionService } from "./service/version-service.js";
import { OutlineService } from "./service/outline-service.js";
import { MigrationService } from "./service/migration-service.js";

export interface App {
  corpusService: CorpusService;
  reviewService: ReviewService;
  versionService: VersionService;
  outlineService: OutlineService;
  migrationService: MigrationService;
  close(): void;
}

export function createApp(dbPath: string): App {
  const store = new SQLiteStore(dbPath);
  return {
    corpusService: new CorpusService(store),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    close: () => store.close(),
  };
}
