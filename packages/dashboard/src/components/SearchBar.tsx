/**
 * SearchBar — controlled search input that navigates to /search?q=<query> on submit.
 * Purpose: initiates FTS5 searches by pushing the query into the URL as a search param.
 * Public surface: SearchBar, SearchBarProps
 * Invariants: submission triggers navigation, not a local state update;
 *   empty submissions are a no-op.
 * Side-effect class: IO (router navigation)
 */

import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export interface SearchBarProps {
  /** Initial value for the search input (e.g. from URL param `q`). */
  initialQuery?: string;
  /** Called with the trimmed query string when the form is submitted. */
  onSearch: (query: string) => void;
  /** Placeholder text for the input. */
  placeholder?: string;
}

/**
 * Search input form. Calls onSearch with the trimmed query on submit.
 * Empty or whitespace-only submissions are a no-op.
 *
 * @example
 * <SearchBar initialQuery="spec" onSearch={(q) => navigate({ search: { q } })} />
 */
export function SearchBar({ initialQuery = "", onSearch, placeholder = "Search docs…" }: SearchBarProps): React.ReactElement {
  const [query, setQuery] = useState(initialQuery);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    onSearch(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 w-full">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="flex-1"
        aria-label="Search query"
      />
      <Button type="submit" size="sm" aria-label="Submit search">
        <Search className="h-4 w-4 mr-1" />
        Search
      </Button>
    </form>
  );
}
