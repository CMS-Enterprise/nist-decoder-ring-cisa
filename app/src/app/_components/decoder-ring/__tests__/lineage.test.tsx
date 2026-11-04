/**
 * The lineage pieces on their own: the header chip, a withdrawn control's notice, a live
 * control's list of the withdrawn controls it took in, and the copied-text lines.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  controlOrPart,
  IncorporatedControls,
  LineageChip,
  lineageLines,
  partPath,
  WithdrawnNotice,
  type ControlLineage,
} from "../lineage";

function makeLineage(overrides: Partial<ControlLineage> = {}): ControlLineage {
  return { successors: [], incorporates: [], addedIn: null, ...overrides };
}

describe("LineageChip", () => {
  it("marks a withdrawn control", () => {
    render(<LineageChip catalogStatus="withdrawn" lineage={makeLineage()} />);
    expect(screen.getByText("Withdrawn")).toBeInTheDocument();
  });

  it("marks a control the release added, naming the release it was absent from", () => {
    render(
      <LineageChip
        catalogStatus="live"
        lineage={makeLineage({
          addedIn: { release: "5.2.0", sinceRelease: "5.1.1+u4" },
        })}
      />,
    );
    const chip = screen.getByText("New in 5.2.0");
    expect(chip).toHaveAttribute("title", "Not in release 5.1.1+u4");
  });

  it("renders nothing for a live control the release did not add", () => {
    const { container } = render(
      <LineageChip catalogStatus="live" lineage={makeLineage()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on the pre-load, which carries neither field", () => {
    const { container } = render(<LineageChip />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("WithdrawnNotice", () => {
  it("lists every successor as a link that opens it by OSCAL id", () => {
    const open = vi.fn();
    render(
      <WithdrawnNotice
        lineage={makeLineage({
          successors: [
            {
              controlNumber: "AC-02",
              kind: "incorporated-into",
              family: false,
            },
            {
              controlNumber: "AU-06",
              kind: "incorporated-into",
              family: false,
            },
          ],
        })}
        onOpenControl={open}
      />,
    );
    expect(screen.getByTestId("withdrawn-notice")).toHaveTextContent(
      "Incorporated into AC-02 and AU-06.",
    );
    fireEvent.click(screen.getByRole("button", { name: "AU-06" }));
    expect(open).toHaveBeenCalledWith("au-6");
  });

  it("says moved to, and reads a whole-family successor as text", () => {
    render(
      <WithdrawnNotice
        lineage={makeLineage({
          successors: [{ controlNumber: "SR", kind: "moved-to", family: true }],
        })}
        onOpenControl={vi.fn()}
      />,
    );
    expect(screen.getByTestId("withdrawn-notice")).toHaveTextContent(
      "Moved to the SR family.",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ends a whole-family successor on the family, when the caller can show one", () => {
    const openFamily = vi.fn();
    render(
      <WithdrawnNotice
        lineage={makeLineage({
          successors: [
            { controlNumber: "SR", kind: "incorporated-into", family: true },
          ],
        })}
        onOpenControl={vi.fn()}
        onOpenFamily={openFamily}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "SR" }));
    expect(openFamily).toHaveBeenCalledWith("SR");
  });

  it("says so when the catalog names no successor", () => {
    render(<WithdrawnNotice lineage={makeLineage()} />);
    expect(
      screen.getByText("The catalog names no successor."),
    ).toBeInTheDocument();
  });

  it("says the successors are not recorded when the catalog's data carries no lineage", () => {
    render(<WithdrawnNotice lineage={null} />);
    expect(screen.getByTestId("withdrawn-notice")).toHaveTextContent(
      "Successors not recorded for this catalog.",
    );
  });

  it("joins two kinds of successor in one sentence", () => {
    render(
      <WithdrawnNotice
        lineage={makeLineage({
          successors: [
            {
              controlNumber: "AC-02",
              kind: "incorporated-into",
              family: false,
            },
            { controlNumber: "SR-05", kind: "moved-to", family: false },
          ],
        })}
        onOpenControl={vi.fn()}
      />,
    );
    expect(screen.getByTestId("withdrawn-notice")).toHaveTextContent(
      "Incorporated into AC-02; moved to SR-05.",
    );
  });

  it("reads successors as text when nothing can open them", () => {
    render(
      <WithdrawnNotice
        lineage={makeLineage({
          successors: [
            {
              controlNumber: "AC-02",
              kind: "incorporated-into",
              family: false,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("AC-02")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("IncorporatedControls", () => {
  it("lists what was incorporated and what moved, each opening its record", () => {
    const open = vi.fn();
    render(
      <IncorporatedControls
        lineage={makeLineage({
          incorporates: [
            { controlNumber: "AC-02(10)", kind: "incorporated-into" },
            { controlNumber: "AC-13", kind: "incorporated-into" },
            { controlNumber: "SA-12(01)", kind: "moved-to" },
          ],
        })}
        onOpenControl={open}
      />,
    );
    const list = screen.getByTestId("incorporated-controls");
    expect(list).toHaveTextContent("Incorporated here: AC-02(10) and AC-13");
    expect(list).toHaveTextContent("Moved here: SA-12(01)");
    fireEvent.click(screen.getByRole("button", { name: "AC-02(10)" }));
    expect(open).toHaveBeenCalledWith("ac-2.10");
  });

  it("renders nothing when the control took in no withdrawn control", () => {
    const { container } = render(
      <IncorporatedControls lineage={makeLineage()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("lineageLines", () => {
  it("states a withdrawn control's successors", () => {
    expect(
      lineageLines(
        "withdrawn",
        makeLineage({
          successors: [
            {
              controlNumber: "AC-02",
              kind: "incorporated-into",
              family: false,
            },
            {
              controlNumber: "AU-06",
              kind: "incorporated-into",
              family: false,
            },
          ],
        }),
      ),
    ).toEqual(["Status: Withdrawn, incorporated into AC-02, AU-06"]);
    expect(
      lineageLines(
        "withdrawn",
        makeLineage({
          successors: [{ controlNumber: "SR", kind: "moved-to", family: true }],
        }),
      ),
    ).toEqual(["Status: Withdrawn, moved to the SR family"]);
    expect(lineageLines("withdrawn", makeLineage())).toEqual([
      "Status: Withdrawn",
    ]);
  });

  it("states the release that added a control and what a live control took in", () => {
    expect(
      lineageLines(
        "live",
        makeLineage({
          addedIn: { release: "5.2.0", sinceRelease: "5.1.1+u4" },
          incorporates: [
            { controlNumber: "AC-02(10)", kind: "incorporated-into" },
            { controlNumber: "AC-13", kind: "incorporated-into" },
          ],
        }),
      ),
    ).toEqual(["New in 5.2.0", "Incorporates withdrawn: AC-02(10), AC-13"]);
  });

  it("adds nothing on the pre-load", () => {
    expect(lineageLines(undefined, undefined)).toEqual([]);
    expect(lineageLines("withdrawn", null)).toEqual(["Status: Withdrawn"]);
  });
});

describe("an item as a successor", () => {
  it("writes a control's item the way the catalog does", () => {
    expect(partPath("ac-2_smt.k")).toBe("k");
    expect(partPath("ac-2_smt.a.1")).toBe("a.1");
    expect(controlOrPart("AC-02", "ac-2_smt.k")).toBe("AC-02k");
    expect(controlOrPart("AC-02", null)).toBe("AC-02");
  });

  it("lands on the item when the caller can show one, and opens the control when it cannot", () => {
    const successors: ControlLineage["successors"] = [
      {
        controlNumber: "AC-02",
        kind: "incorporated-into",
        family: false,
        part: "ac-2_smt.k",
      },
    ];
    const open = vi.fn();
    const openPart = vi.fn();
    const { unmount } = render(
      <WithdrawnNotice
        lineage={makeLineage({ successors })}
        onOpenControl={open}
        onOpenPart={openPart}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AC-02k" }));
    expect(openPart).toHaveBeenCalledWith("ac-2", "ac-2_smt.k");
    expect(open).not.toHaveBeenCalled();
    unmount();

    render(
      <WithdrawnNotice
        lineage={makeLineage({ successors })}
        onOpenControl={open}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AC-02k" }));
    expect(open).toHaveBeenCalledWith("ac-2");
  });

  it("names the item a withdrawn control went into, in the list and the copied text", () => {
    const lineage = makeLineage({
      incorporates: [
        {
          controlNumber: "AC-02(10)",
          kind: "incorporated-into",
          part: "ac-2_smt.k",
        },
      ],
    });
    render(<IncorporatedControls lineage={lineage} onOpenControl={vi.fn()} />);
    expect(screen.getByTestId("incorporated-controls")).toHaveTextContent(
      "Incorporated here: AC-02(10) (item k)",
    );
    expect(lineageLines("live", lineage)).toEqual([
      "Incorporates withdrawn: AC-02(10) (item k)",
    ]);
    expect(
      lineageLines(
        "withdrawn",
        makeLineage({
          successors: [
            {
              controlNumber: "AC-02",
              kind: "incorporated-into",
              family: false,
              part: "ac-2_smt.k",
            },
          ],
        }),
      ),
    ).toEqual(["Status: Withdrawn, incorporated into AC-02k"]);
  });
});
