/** @spec_ref AC-SETUP-003 */
/**
 * Validates the project scaffolding: TypeScript strict mode compiles,
 * Vitest runner functions, and basic immutability patterns type-check.
 *
 * AC-SETUP-003: Vitest test runner is operational.
 * AC-SETUP-004: TypeScript strict mode compilation passes.
 */
import { describe, expect, it } from "vitest";

describe("project setup", () => {
  it("AC-SETUP-003.01: vitest runs with TypeScript strict mode", () => {
    const value: string = "lore";
    expect(value).toBe("lore");
  });

  it("AC-SETUP-004.01: immutable object spread is type-safe under strict mode", () => {
    const obj: Readonly<{ a: number; b: string }> = { a: 1, b: "x" };
    const updated = { ...obj, a: 2 };
    expect(updated.a).toBe(2);
    // Original is unchanged (immutability guarantee)
    expect(obj.a).toBe(1);
  });

  it("AC-SETUP-004.02: unknown type is narrowed before use (strict noImplicitAny)", () => {
    function parseValue(raw: unknown): string {
      if (typeof raw === "string") return raw;
      return String(raw);
    }
    expect(parseValue("hello")).toBe("hello");
    expect(parseValue(42)).toBe("42");
  });
});
