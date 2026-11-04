/**
 * SearchTypeahead must not depend on the identity of the URL setter.
 *
 * Some nuqs releases hand back a new `setQuery` on every render, and each call
 * re-renders its subscribers. An effect that lists the setter as a dependency
 * then re-fires on every render it causes, and never settles ("Maximum update
 * depth exceeded"). This file stands in a hook with exactly that behaviour, so
 * the property holds whichever nuqs release is installed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

const writes: string[] = [];

vi.mock("../useDecoderQuery", async () => {
  const React = await import("react");
  return {
    useDecoderQuery: () => {
      const [q, setQ] = React.useState("");
      const [, rerender] = React.useState(0);
      return {
        query: { q },
        // A fresh function on every render, and every call re-renders.
        setQuery: (next: { q: string }) => {
          // Stop a runaway loop with a readable failure instead of exhausting memory.
          if (writes.length >= 20)
            throw new Error("setQuery re-fired in a loop");
          writes.push(next.q);
          setQ(next.q);
          rerender((n) => n + 1);
          return Promise.resolve(new URLSearchParams());
        },
      };
    },
  };
});

vi.mock("~/trpc/react", () => ({
  api: {
    decoder: {
      searchControls: {
        useQuery: () => ({ data: { hits: [], matchingIds: [] } }),
      },
    },
  },
}));

import SearchTypeahead from "../SearchTypeahead";

describe("SearchTypeahead with an unstable URL setter", () => {
  beforeEach(() => {
    writes.length = 0;
  });

  it("writes once on mount and once per settled term", async () => {
    render(<SearchTypeahead hrefFor={(id) => `/control/${id}`} />);
    expect(writes).toEqual([""]);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Search controls"), {
        target: { value: "audit" },
      });
    });

    await waitFor(() => {
      expect(writes).toEqual(["", "audit"]);
    });
    // Let any further renders the write caused run out before checking again.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(writes).toEqual(["", "audit"]);
  });
});
