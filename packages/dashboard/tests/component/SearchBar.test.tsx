// @vitest-environment jsdom
/**
 * Tests for SearchBar component.
 * Source: SPEC-015 §3.3 M5
 *
 * Test plan:
 *   HAPPY:
 *     - Renders input and submit button
 *     - onSearch called with trimmed query on submit
 *     - Respects initialQuery prop
 *
 *   NEGATIVE:
 *     - Empty submission does not call onSearch
 *     - Whitespace-only submission does not call onSearch
 *
 *   BOUNDARY:
 *     - Single character query is accepted
 *
 *   STATE:
 *     - Query state updates as user types
 *
 *   REGRESSION:
 *     - onSearch receives trimmed query (strips leading/trailing whitespace)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "../../src/components/SearchBar";

describe("SearchBar", () => {
  describe("happy path", () => {
    it("renders a search input", () => {
      render(<SearchBar onSearch={() => {}} />);
      expect(screen.getByRole("searchbox", { name: /Search query/ })).toBeInTheDocument();
    });

    it("renders a submit button", () => {
      render(<SearchBar onSearch={() => {}} />);
      expect(screen.getByRole("button", { name: /Submit search/ })).toBeInTheDocument();
    });

    it("calls onSearch with the query on form submit", async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      render(<SearchBar onSearch={onSearch} />);

      const input = screen.getByRole("searchbox");
      await user.type(input, "hello");
      fireEvent.submit(input.closest("form")!);

      expect(onSearch).toHaveBeenCalledWith("hello");
    });

    it("respects initialQuery prop", () => {
      render(<SearchBar onSearch={() => {}} initialQuery="pre-filled" />);
      expect(screen.getByRole("searchbox")).toHaveValue("pre-filled");
    });
  });

  describe("negative", () => {
    it("does not call onSearch for empty submission", () => {
      const onSearch = vi.fn();
      render(<SearchBar onSearch={onSearch} />);

      fireEvent.submit(screen.getByRole("searchbox").closest("form")!);

      expect(onSearch).not.toHaveBeenCalled();
    });

    it("does not call onSearch for whitespace-only query", async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      render(<SearchBar onSearch={onSearch} />);

      await user.type(screen.getByRole("searchbox"), "   ");
      fireEvent.submit(screen.getByRole("searchbox").closest("form")!);

      expect(onSearch).not.toHaveBeenCalled();
    });
  });

  describe("boundary", () => {
    it("accepts single character query", async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      render(<SearchBar onSearch={onSearch} />);

      await user.type(screen.getByRole("searchbox"), "a");
      fireEvent.submit(screen.getByRole("searchbox").closest("form")!);

      expect(onSearch).toHaveBeenCalledWith("a");
    });
  });

  describe("state", () => {
    it("updates input value as user types", async () => {
      const user = userEvent.setup();
      render(<SearchBar onSearch={() => {}} />);

      const input = screen.getByRole("searchbox");
      await user.type(input, "typing");

      expect(input).toHaveValue("typing");
    });
  });

  describe("regression", () => {
    it("trims query before calling onSearch", async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      render(<SearchBar onSearch={onSearch} />);

      await user.type(screen.getByRole("searchbox"), "  hello world  ");
      fireEvent.submit(screen.getByRole("searchbox").closest("form")!);

      expect(onSearch).toHaveBeenCalledWith("hello world");
    });
  });
});
