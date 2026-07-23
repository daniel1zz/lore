import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// reason: vitest globals:false means @testing-library/react cannot detect afterEach as a global
// and thus cannot auto-register cleanup. We wire it explicitly here so each test gets a fresh DOM.
afterEach(cleanup);

// reason: Node >=22 defines its OWN localStorage/sessionStorage accessors on globalThis
// (undefined unless --localstorage-file is passed), and vitest's populateGlobal only
// copies a jsdom window key onto a global that ALREADY has it when the key is in vitest's
// KEYS allowlist — the storages are not — so bare `localStorage` resolves to undefined.
// Delegating to `window`/`document.defaultView` is NOT possible: populateGlobal rewrites
// window/self/top/parent AND document.defaultView to the global itself (infinite getter
// recursion), leaving the raw jsdom window unreachable. A throwaway iframe's contentWindow
// is the one unpatched real jsdom window; its Storage objects keep working after the
// iframe is detached (probed). Guarded on `document` so node-environment test files
// (which share this setup file) are untouched. Missing contentWindow/storage or a
// non-configurable global accessor must throw loud — a silent catch would reintroduce
// the undefined-storage failure mode.
if (typeof document !== "undefined") {
  const storageKeys = ["localStorage", "sessionStorage"] as const;
  if (storageKeys.some((key) => globalThis[key] === undefined)) {
    const iframe = document.createElement("iframe");
    document.documentElement.appendChild(iframe);
    const realWindow = iframe.contentWindow;
    if (realWindow === null) {
      throw new Error("storage bridge: iframe.contentWindow is null");
    }
    for (const key of storageKeys) {
      if (globalThis[key] === undefined) {
        const storage = realWindow[key];
        if (storage === undefined) {
          throw new Error(`storage bridge: iframe window has no ${key}`);
        }
        Object.defineProperty(globalThis, key, {
          configurable: true,
          get: () => storage,
        });
      }
    }
    iframe.remove();
  }
}
