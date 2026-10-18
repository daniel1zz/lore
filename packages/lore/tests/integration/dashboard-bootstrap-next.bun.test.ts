/**
 * AC-HR-7 — `/auth/bootstrap?next=` same-origin redirect (spec-human-review-surface D6,
 * changes BR-862). Throwaway corpus + ephemeral port; never the repo `.lore/`.
 * @task_ref task-skill-implement-hr-t5-sign-in-link-keeps-a-same-origin
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoreConfig } from "@lore/core";
import { startHttpServer } from "../../src/adapters/http/index.js";
import { createMachineAuthStores } from "../../src/adapters/http/machine-auth.js";
import { createNonceStore } from "../../src/adapters/http/static-serving.js";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import { liveAmbient, liveWriteContext, liveIo } from "../live-invocation.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function makeHarness() {
  const dir = mkdtempSync(join(tmpdir(), "lore-bootstrap-next-"));
  mkdirSync(join(dir, ".lore"), { recursive: true });
  const indexPath = join(dir, "index.html");
  writeFileSync(indexPath, "<html></html>", "utf8");
  const config = { project: { name: "bootstrap-next", author: "test" } } as unknown as LoreConfig;
  // reason: no `sync` section, so createApp returns a bare App (same narrowing as static-serving.bun.test.ts).
  const app = createApp(join(dir, ".lore", "lore.db"), config, liveAmbient(), liveWriteContext()) as App;
  const stores = createMachineAuthStores({ baseDir: join(dir, "machine") });
  const nonces = createNonceStore({ ttlMs: 60_000 });
  const server = startHttpServer(app, {
    io: liveIo(),
    port: 0,
    host: "127.0.0.1",
    dashboard: {
      assets: async () => ({
        available: true,
        manifest: {
          stamp: { digest: "d", builtAt: new Date().toISOString() },
          entries: { "/index.html": { embedded: indexPath, contentType: "text/html", immutable: false } },
        },
      }),
      nonces,
      machineAuth: () => stores,
    },
  } as Parameters<typeof startHttpServer>[1]);
  cleanups.push(() => {
    server.stop(true);
    app.close();
    stores.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const redeem = (rawQuery: string) =>
    fetch(`http://127.0.0.1:${server.port}/auth/bootstrap?nonce=${nonces.mint()}${rawQuery}`, { redirect: "manual" });
  return { nonces, server, redeem };
}

describe("AC-HR-7 bootstrap next redirect", () => {
  it("AC-HR-7 same-origin next path survives sign-in with a session cookie", async () => {
    const { redeem } = makeHarness();
    const res = await redeem(`&next=${encodeURIComponent("/needs-you/decisions/7")}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/needs-you/decisions/7");
    expect(res.headers.get("set-cookie") ?? "").toContain("lore_sid=");
  });

  // raw query values, sent exactly as written
  const hostile: Array<[string, string]> = [
    ["absolute URL", "https%3A%2F%2Fevil.example%2Fx"],
    ["protocol-relative", "%2F%2Fevil.example%2Fx"],
    ["backslash", "%2F%5Cevil.example"],
    ["double-encoded", "%252F%252Fevil.example"],
    ["encoded slash after slash", "%2F%252F%252Fevil.example"],
    ["malformed percent", "%2F%25E0%25A4%25A"],
    ["newline", "%2Fa%0d%0aSet-Cookie:x=1"],
    ["empty", ""],
  ];
  for (const [label, value] of hostile) {
    it(`AC-HR-7 ${label} next redirects to /`, async () => {
      const { redeem } = makeHarness();
      const res = await redeem(`&next=${value}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });
  }

  it("AC-HR-7 no next keeps redirecting to /", async () => {
    const { redeem } = makeHarness();
    const res = await redeem("");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("AC-HR-7 reused nonce still answers 410 even with a valid next", async () => {
    const { nonces, server } = makeHarness();
    const url = `http://127.0.0.1:${server.port}/auth/bootstrap?nonce=${nonces.mint()}&next=%2Fneeds-you`;
    expect((await fetch(url, { redirect: "manual" })).status).toBe(302);
    expect((await fetch(url, { redirect: "manual" })).status).toBe(410);
  });
});
