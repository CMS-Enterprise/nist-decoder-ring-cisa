/**
 * The export page: its URL is the export's selection plus the format, so the tests drive
 * it through withNuqsTestingAdapter and read the download link and the URL it writes.
 * The tRPC hooks are mocked per call, as in the decoder-ring component tests.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  withNuqsTestingAdapter,
  type UrlUpdateEvent,
} from "nuqs/adapters/testing";

let mockCount: ReturnType<typeof vi.fn>;
const CONTROLS = [
  { id: "AC-02", name: "Account Management" },
  {
    id: "AC-02(01)",
    name: "Automated System Account Management",
  },
  { id: "IA-05", name: "Authenticator Management" },
  {
    id: "AC-02(10)",
    name: "Shared and Group Account Credential Change",
    withdrawn: true,
  },
];

vi.mock("~/trpc/react", () => ({
  api: {
    decoder: {
      getBridgeData: {
        useQuery: () => ({
          data: { families: [{ id: "AC", name: "Access Control" }] },
        }),
      },
      searchControls: { useQuery: () => ({ data: undefined }) },
      listControls: { useQuery: () => ({ data: CONTROLS }) },
      countExport: {
        get useQuery() {
          return mockCount;
        },
      },
    },
  },
}));

import {
  createTRPCClient,
  httpBatchStreamLink,
  TRPCClientError,
} from "@trpc/client";
import SuperJSON from "superjson";

import ExportPage, { docxPages, LARGE_DOCX, retryCount } from "../ExportPage";
import type { AppRouter } from "~/server/api/root";
import { rateLimitedFetch } from "~/trpc/rate-limited";
import { LINE_DATASETS, LINE_FIELDS } from "~/lib/export/from-detail";
import { EXPORT_DATASETS, EXPORT_FIELDS } from "~/lib/export/record";

function renderPage(searchParams = "") {
  const onUrlUpdate = vi.fn<(e: UrlUpdateEvent) => void>();
  render(<ExportPage />, {
    wrapper: withNuqsTestingAdapter({ searchParams, onUrlUpdate }),
  });
  return onUrlUpdate;
}

const downloadLink = () => screen.getByRole("link", { name: /Download/ });
const lastUrl = (spy: ReturnType<typeof renderPage>) =>
  spy.mock.calls.at(-1)?.[0].searchParams;

beforeEach(() => {
  mockCount = vi.fn(() => ({ data: { count: 12 }, isFetching: false }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExportPage", () => {
  it("links the download to the export route with the page's own selection", () => {
    renderPage("?family=AC&pick=AC-02&format=docx");
    const href = downloadLink().getAttribute("href")!;
    expect(href.startsWith("/api/export?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("family")).toBe("AC");
    expect(params.get("pick")).toBe("AC-02");
    expect(params.get("format")).toBe("docx");
    expect(screen.getByText("12 controls")).toBeInTheDocument();
  });

  it("counts the download's controls, leaving out what only changes their content", async () => {
    renderPage("?family=AC&enhancements=without&fields=priority");
    const [input] = mockCount.mock.calls.at(-1)! as [Record<string, unknown>];
    expect(input).toMatchObject({
      family: ["AC"],
      enhancements: "without",
      data: [],
      fields: [],
      pick: [],
    });
    expect(input).not.toHaveProperty("format");

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "References" }));
    });
    expect(mockCount.mock.calls.at(-1)![0]).toEqual(input);
  });

  it("says why the server refuses a selection, and offers no download", () => {
    mockCount.mockReturnValue({
      data: undefined,
      isFetching: false,
      error: {
        message: "No control matches ZZ-99.",
        data: { code: "BAD_REQUEST" },
      },
    });
    renderPage("?pick=ZZ-99");
    expect(screen.getByText("No control matches ZZ-99.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download/ })).toBeDisabled();
  });

  it("says plainly that a malformed selection is invalid, not the validator's detail", () => {
    mockCount.mockReturnValue({
      data: undefined,
      isFetching: false,
      error: {
        message: '[{"code":"too_big"}]',
        data: { code: "BAD_REQUEST", zodError: { fieldErrors: {} } },
      },
    });
    renderPage();
    expect(
      screen.getByText("This link's selection isn't valid."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/too_big/)).toBeNull();
  });

  it.each([
    ["?baseline=BOGUS", "baseline"],
    ["?pick=", "pick"],
    ["?enhancements=Without", "enhancements"],
    ["?format=pdf", "format"],
  ])(
    "refuses %s as the route does, without counting it, and clears it on request",
    async (query, key) => {
      const spy = renderPage(query);
      expect(
        screen.getByText(new RegExp(`isn't valid \\(${key}\\)`)),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Download/ })).toBeDisabled();
      const [, options] = mockCount.mock.calls.at(-1)! as [
        unknown,
        { enabled: boolean },
      ];
      expect(options.enabled).toBe(false);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: `Clear ${key}` }));
      });
      await waitFor(() => expect(lastUrl(spy)?.has(key)).toBe(false));
    },
  );

  it("offers no download while a changed selection is still being counted", () => {
    mockCount.mockReturnValue({
      data: { count: 12 },
      isFetching: true,
      isPlaceholderData: true,
    });
    renderPage("?family=AC");
    expect(screen.getByText("Counting…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download/ })).toBeDisabled();
  });

  it("says the count is unavailable when it fails otherwise, and keeps the download", () => {
    mockCount.mockReturnValue({
      data: undefined,
      isFetching: false,
      error: { message: "fetch failed", data: undefined },
    });
    renderPage();
    expect(
      screen.getByText(
        "The control count is unavailable. Try again in a few minutes.",
      ),
    ).toBeInTheDocument();
    expect(downloadLink()).toHaveAttribute("href");
  });

  it("does not retry the load balancer's rate limit, but retries its gateway errors", async () => {
    // The real link, through the app's fetch, given each of the load balancer's answers.
    const failWith = (body: string, status: number, type: string) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(body, { status, headers: { "Content-Type": type } }),
          ),
        ),
      );
      return createTRPCClient<AppRouter>({
        links: [
          httpBatchStreamLink({
            url: "http://test/api/trpc",
            transformer: SuperJSON,
            fetch: rateLimitedFetch,
          }),
        ],
      })
        .decoder.countExport.query({} as never)
        .catch((e: unknown) => e as TRPCClientError<AppRouter>);
    };
    const limited = await failWith("Too many requests.", 429, "text/plain");
    expect(limited).toBeInstanceOf(TRPCClientError);
    expect(retryCount(0, limited as TRPCClientError<AppRouter>)).toBe(false);
    const gateway = await failWith("<html>503</html>", 503, "text/html");
    expect(retryCount(0, gateway as TRPCClientError<AppRouter>)).toBe(true);

    expect(retryCount(0, { cause: new TypeError("fetch failed") })).toBe(true);
    expect(retryCount(0, { data: { code: "BAD_REQUEST" } })).toBe(false);
    expect(retryCount(3, {})).toBe(false);
  });

  it("offers only the datasets and fields this app carries", () => {
    renderPage();
    for (const d of EXPORT_DATASETS) {
      const shown = screen.queryByRole("checkbox", {
        name: new RegExp(
          {
            statement: "Statement",
            assessment: "Assessment",
            zeroTrust: "Zero Trust",
            references: "References",
          }[d],
        ),
      });
      expect(Boolean(shown)).toBe(LINE_DATASETS.includes(d));
    }
    const details = screen.getByRole("group", { name: "Details" });
    expect(within(details).getAllByRole("checkbox")).toHaveLength(
      LINE_FIELDS.length,
    );
    expect(LINE_FIELDS.every((f) => EXPORT_FIELDS.includes(f))).toBe(true);
  });

  it("writes an unticked dataset and a format to the URL", async () => {
    const spy = renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "References" }));
    });
    await waitFor(() =>
      expect(lastUrl(spy)?.get("data")).toBe(
        LINE_DATASETS.filter((d) => d !== "references").join(","),
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: /Document \(DOCX\)/ }));
    });
    await waitFor(() => expect(lastUrl(spy)?.get("format")).toBe("docx"));
  });

  it("cannot export an empty selection, and says why", () => {
    mockCount.mockReturnValue({ data: { count: 0 }, isFetching: false });
    renderPage("?q=nothing-matches");
    expect(
      screen.getByText("This selection has no controls."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download/ })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
  });

  it("suggests the spreadsheet for a large DOCX, and keeps the DOCX available", async () => {
    mockCount.mockReturnValue({
      data: { count: LARGE_DOCX + 1 },
      isFetching: false,
    });
    const spy = renderPage("?format=docx");
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(
      `roughly ${docxPages(LARGE_DOCX + 1)} pages`,
    );
    expect(downloadLink()).toHaveTextContent("Download DOCX");
    await act(async () => {
      fireEvent.click(within(note).getByRole("button"));
    });
    await waitFor(() => expect(lastUrl(spy)?.get("format")).toBeNull());
  });

  it("says nothing about size for a small DOCX or any XLSX", () => {
    mockCount.mockReturnValue({ data: { count: 5000 }, isFetching: false });
    renderPage();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says to try again when the build cap answers 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(Response.json({ error: "busy" }, { status: 429 })),
      ),
    );
    renderPage();
    await act(async () => {
      fireEvent.click(downloadLink());
    });
    expect(
      await screen.findByText(/Try again in a few seconds/),
    ).toBeInTheDocument();
  });

  it("says to wait a few minutes when the load balancer's rate limit answers 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("Too many requests. Try again in a few minutes.", {
            status: 429,
            headers: { "Content-Type": "text/plain" },
          }),
        ),
      ),
    );
    renderPage();
    await act(async () => {
      fireEvent.click(downloadLink());
    });
    expect(
      await screen.findByText(/many exports in a short time/),
    ).toBeInTheDocument();
  });

  it("saves the file under the route's name, showing the build as pending", async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    // Only the two blob methods: nuqs checks `instanceof URL`, so URL itself stays.
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
    onTestFinished(() => {
      created.mockRestore();
      revoked.mockRestore();
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    renderPage("?pick=AC-02&format=docx");
    const href = downloadLink().getAttribute("href");
    await act(async () => {
      fireEvent.click(downloadLink());
    });
    // The file fetched is the one the link names, picks and format included.
    expect(fetchMock).toHaveBeenCalledWith(href);
    expect(screen.getByText("Preparing the file…")).toBeInTheDocument();
    await act(async () => {
      resolve(
        new Response("bytes", {
          headers: {
            "Content-Disposition": 'attachment; filename="catalog-export.xlsx"',
          },
        }),
      );
    });
    await waitFor(() => expect(click).toHaveBeenCalled());
    const saved = click.mock.contexts.at(-1) as HTMLAnchorElement;
    expect(saved.download).toBe("catalog-export.xlsx");
    expect(screen.getByText("Download DOCX")).toBeInTheDocument();
    click.mockRestore();
  });

  it("picks by id or name, and removes a pick", async () => {
    const spy = renderPage();
    const input = screen.getByLabelText("Pick controls or enhancements");
    fireEvent.change(input, { target: { value: "ac-2" } });
    const results = screen.getByRole("list", { name: "Matching controls" });
    expect(
      within(results)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "AC-02Account Management",
      "AC-02(01)Automated System Account Management",
      "AC-02(10)Shared and Group Account Credential Changewithdrawn",
    ]);
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(() => expect(lastUrl(spy)?.get("pick")).toBe("AC-02"));

    fireEvent.change(input, { target: { value: "authenticator" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /IA-05/ }));
    });
    await waitFor(() => expect(lastUrl(spy)?.get("pick")).toBe("AC-02,IA-05"));
    // The clicked result is gone, so focus returns to the search box.
    expect(input).toHaveFocus();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove AC-02" }));
    });
    await waitFor(() => expect(lastUrl(spy)?.get("pick")).toBe("IA-05"));
  });

  it("shows one chip per control however a link spells it, and removes every spelling", async () => {
    const spy = renderPage("?pick=AC-02,ac-2,IA-05");
    const chips = screen.getByRole("list", { name: "Picked controls" });
    expect(
      within(chips).getAllByRole("button", { name: /^Remove / }),
    ).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove AC-02" }));
    });
    await waitFor(() => expect(lastUrl(spy)?.get("pick")).toBe("IA-05"));
    // The pressed chip is gone, so focus returns to the search box.
    expect(
      screen.getByLabelText("Pick controls or enhancements"),
    ).toHaveFocus();
  });

  it("keeps the filters on the way back to the diagram, and no export-only state", () => {
    renderPage("?family=AC&q=audit&pick=AC-02&format=docx");
    const back = screen.getByRole("link", { name: "Back to the decoder ring" });
    const params = new URLSearchParams(
      back.getAttribute("href")!.split("?")[1],
    );
    expect(params.get("family")).toBe("AC");
    expect(params.get("q")).toBe("audit");
    expect(params.get("pick")).toBeNull();
    expect(params.get("format")).toBeNull();
  });
});
