import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// reason: vitest globals:false means @testing-library/react cannot detect afterEach as a global
// and thus cannot auto-register cleanup. We wire it explicitly here so each test gets a fresh DOM.
afterEach(cleanup);
