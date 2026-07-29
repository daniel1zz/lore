// @vitest-environment jsdom
/**
 * Tests for LinksPanel component (editable related-document links).
 * Source: SPEC-022 §9.2, Q4 / SPEC-027 dispatch AC-DH-8.
 *
 * Note on timer handling: tests that exercise the 300ms search-debounce use a
 * real (un-faked) wait past the debounce window rather than vi.useFakeTimers().
 * TanStack Query's internal fetch scheduling doesn't reliably resume once fake
 * timers are switched back to real mid-test (observed empirically: the
 * debounced state update fires, but the resulting queryFn invocation stays
 * pending), so these tests accept a small real-time cost (~350ms) for
 * determinism over the fake-timer approach used elsewhere in this suite
 * (e.g. DocDetail.write.test.tsx AC-DH-3, which never awaits a real network
 * layer underneath the fake timers).
 *
 * Test plan:
 *   HAPPY:
 *     - Renders every link entry with its link_type and title (two different
 *       entries with different data, to defeat a hardcoded-return stub).
 *     - Write mode (onLinkAdd/onLinkRemove supplied) renders the search input
 *       and link-type selector.
 *   NEGATIVE:
 *     - Read-only mode with zero links shows "No related documents."
 *     - Read-only mode never renders a remove ("X") button, even when links
 *       are present.
 *   BOUNDARY:
 *     - A link entry with no `title` falls back to displaying its `to_id`
 *       (LinksPanel's own documented `link.title ?? link.to_id` contract).
 *     - The search combobox does not query until the debounced input reaches
 *       2+ characters (matches the documented 300ms-debounce invariant).
 *   ERROR:
 *     - onLinkAdd resolving with a non-null error string renders that error
 *       inline (LINK_CYCLE-style errors surfaced, not swallowed).
 *   STATE:
 *     - Removing a link shows a spinner for the target row while pending and
 *       reverts to the "X" icon once the removal promise resolves.
 *     - Selecting a different link_type in the dropdown before adding a link
 *       passes that type through to onLinkAdd (not the default).
 *   REGRESSION:
 *     - After a successful add, the search query and results list are reset
 *       (search field cleared) — guards against a stale in-progress search
 *       lingering after the link is added.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { linkTypeSchema } from "@lore/core";
import { LinksPanel } from "../../src/components/LinksPanel";
import type { LinkEntry } from "../../src/components/LinksPanel";
import type { SearchHit } from "../../src/lib/api";

// reason: apiSearch is the only external IO boundary LinkAddSearch touches;
// mocking it (rather than the whole @tanstack/react-query layer) keeps the
// real useQuery caching/debounce-consuming behavior under test.
vi.mock("@/lib/api", () => ({
  apiSearch: vi.fn(),
}));

import { apiSearch } from "@/lib/api";

const mockedApiSearch = vi.mocked(apiSearch);

// reason: real-shape fixture — `CorpusService.search` returns `SearchHit`
// (`{id, slug, title, snippet, score, type, status}`, SPEC-037 §2 added the
// last two), NOT a `DocSummary` (still no `updated_at`). A prior version of
// this fixture fabricated fields the server never sent (SPEC-031 read-path
// contract drift) — the lesson here is the opposite direction: `type`/`status`
// are now genuinely part of the contract, so this fixture must supply them.
function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    id: "01HHIT00000000000000000001",
    slug: "spec-hit",
    title: "Candidate Doc",
    snippet: "...a matching snippet...",
    score: 1.0,
    type: "spec",
    status: "active",
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Types into the search box and waits past the real 300ms debounce window. */
async function typeAndAdvanceDebounce(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  value: string,
): Promise<void> {
  await user.type(input, value);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

beforeEach(() => {
  mockedApiSearch.mockReset();
  mockedApiSearch.mockResolvedValue({ results: [] });
});

describe("LinksPanel", () => {
  describe("happy path", () => {
    it("renders each link entry with its link_type and title", () => {
      const links: LinkEntry[] = [
        { to_id: "01HA0000000000000000000001", title: "First Related Doc", link_type: "relates-to" },
        { to_id: "01HA0000000000000000000002", title: "Second Related Doc", link_type: "blocks" },
      ];
      render(<LinksPanel links={links} />);

      expect(screen.getByText("First Related Doc")).toBeInTheDocument();
      expect(screen.getByText("relates-to")).toBeInTheDocument();
      expect(screen.getByText("Second Related Doc")).toBeInTheDocument();
      expect(screen.getByText("blocks")).toBeInTheDocument();
    });

    it("renders the search input and link-type selector in write mode", () => {
      renderWithClient(
        <LinksPanel links={[]} onLinkAdd={vi.fn()} onLinkRemove={vi.fn()} />,
      );

      expect(screen.getByLabelText("Search for a document to link")).toBeInTheDocument();
      expect(screen.getByLabelText("Link type")).toBeInTheDocument();
    });

    it("offers exactly the canonical LinkType set (mirrors @lore/core's linkTypeSchema, no stale 'extends')", () => {
      renderWithClient(
        <LinksPanel links={[]} onLinkAdd={vi.fn()} onLinkRemove={vi.fn()} />,
      );

      const select = screen.getByLabelText("Link type") as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((o) => o.value);

      // reason: asserted against the SSOT (`linkTypeSchema.options`, the SAME
      // source `LinksPanel.tsx`'s own `LINK_TYPES` derives from), never a
      // hardcoded literal — a literal array here was this test's OWN third
      // copy of the link-type list (RED as of P1's `"resolves"` addition,
      // spec-issue-closure-loop-computed-resolution-agent-reachable §D1) and
      // would silently drift again at the NEXT added link type. Appending
      // "resolves" to a literal would only reproduce the same defect one
      // member later.
      expect(optionValues).toEqual([...linkTypeSchema.options]);
      expect(optionValues).not.toContain("extends");
    });
  });

  describe("negative", () => {
    it("shows 'No related documents.' when read-only with zero links", () => {
      render(<LinksPanel links={[]} />);
      expect(screen.getByText("No related documents.")).toBeInTheDocument();
    });

    it("renders no remove button in read-only mode even with links present", () => {
      const links: LinkEntry[] = [
        { to_id: "01HA0000000000000000000001", title: "Doc A", link_type: "relates-to" },
      ];
      render(<LinksPanel links={links} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("boundary", () => {
    it("falls back to displaying to_id when a link has no title", () => {
      const links: LinkEntry[] = [
        { to_id: "01HNOTITLE00000000000000001", link_type: "relates-to" },
      ];
      render(<LinksPanel links={links} />);
      expect(screen.getByText("01HNOTITLE00000000000000001")).toBeInTheDocument();
    });

    it("does not call apiSearch for a single-character query even after the debounce window", async () => {
      const user = userEvent.setup();
      renderWithClient(<LinksPanel links={[]} onLinkAdd={vi.fn()} onLinkRemove={vi.fn()} />);
      const input = screen.getByLabelText("Search for a document to link");

      await typeAndAdvanceDebounce(user, input, "a");

      expect(mockedApiSearch).not.toHaveBeenCalled();
    });

    it("calls apiSearch only after the debounce window once the query reaches 2+ characters", async () => {
      const user = userEvent.setup();
      mockedApiSearch.mockResolvedValue({ results: [makeHit()] });
      renderWithClient(<LinksPanel links={[]} onLinkAdd={vi.fn()} onLinkRemove={vi.fn()} />);
      const input = screen.getByLabelText("Search for a document to link");

      await typeAndAdvanceDebounce(user, input, "ab");

      expect(mockedApiSearch).toHaveBeenCalledWith(null, "ab", {});
    });
  });

  describe("error", () => {
    it("renders an inline error when onLinkAdd resolves with a non-null message", async () => {
      const user = userEvent.setup();
      const onLinkAdd = vi.fn().mockResolvedValue("LINK_CYCLE: would create a cycle");
      mockedApiSearch.mockResolvedValue({ results: [makeHit()] });
      renderWithClient(<LinksPanel links={[]} onLinkAdd={onLinkAdd} onLinkRemove={vi.fn()} />);
      const input = screen.getByLabelText("Search for a document to link");

      await typeAndAdvanceDebounce(user, input, "ab");

      const hit = await screen.findByText("Candidate Doc");
      await user.click(hit);

      expect(await screen.findByText("LINK_CYCLE: would create a cycle")).toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("shows a spinner while removal is pending and reverts to the remove icon after resolving", async () => {
      let resolveRemove!: () => void;
      const onLinkRemove = vi.fn(
        () => new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
      );
      const links: LinkEntry[] = [
        { to_id: "01HA0000000000000000000001", title: "Doc A", link_type: "relates-to" },
      ];
      const user = userEvent.setup();
      renderWithClient(<LinksPanel links={links} onLinkAdd={vi.fn()} onLinkRemove={onLinkRemove} />);

      const removeButton = screen.getByRole("button", { name: "Remove link to Doc A" });
      await user.click(removeButton);

      expect(removeButton).toBeDisabled();

      resolveRemove();
      await waitFor(() => expect(removeButton).not.toBeDisabled());
    });

    it("passes the selected link type (not the default) through to onLinkAdd", async () => {
      const onLinkAdd = vi.fn().mockResolvedValue(null);
      mockedApiSearch.mockResolvedValue({ results: [makeHit()] });
      renderWithClient(<LinksPanel links={[]} onLinkAdd={onLinkAdd} onLinkRemove={vi.fn()} />);

      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Link type"), "blocks");

      const input = screen.getByLabelText("Search for a document to link");
      await typeAndAdvanceDebounce(user, input, "ab");

      const hit = await screen.findByText("Candidate Doc");
      await user.click(hit);

      expect(onLinkAdd).toHaveBeenCalledWith("01HHIT00000000000000000001", "blocks");
    });
  });

  describe("regression", () => {
    it("clears the search query after a successful add (no stale results lingering)", async () => {
      const user = userEvent.setup();
      const onLinkAdd = vi.fn().mockResolvedValue(null);
      mockedApiSearch.mockResolvedValue({ results: [makeHit()] });
      renderWithClient(<LinksPanel links={[]} onLinkAdd={onLinkAdd} onLinkRemove={vi.fn()} />);

      const input = screen.getByLabelText("Search for a document to link") as HTMLInputElement;
      await typeAndAdvanceDebounce(user, input, "ab");

      const hit = await screen.findByText("Candidate Doc");
      await user.click(hit);

      await waitFor(() => expect(input.value).toBe(""));
    });
  });
});
