import { describe, expect, it } from "vitest";
import { describeReference, documentKind } from "../reference-descriptor";

describe("documentKind", () => {
  it("names the common types and falls back to the subtype or the extension", () => {
    expect(documentKind("application/pdf", "https://a.gov/x")).toBe("PDF");
    expect(documentKind("text/html", "https://a.gov/x")).toBe("Web page");
    expect(documentKind("application/json", "https://a.gov/x")).toBe("JSON");
    expect(documentKind("application/x-tar", "https://a.gov/x")).toBe("TAR");
    expect(documentKind(null, "https://a.gov/doc.pdf")).toBe("PDF");
    expect(documentKind(null, "https://a.gov/doc.PDF?dl=1")).toBe("PDF");
    expect(documentKind(null, "https://a.gov/page")).toBeNull();
    // A .pdf in the query string names a parameter, not the document served.
    expect(
      documentKind(null, "https://a.gov/accounts/login/?next=/doc/rfc5905.pdf"),
    ).toBeNull();
    expect(documentKind(null, "https://a.gov/doc.pdf#page=14")).toBe("PDF");
  });
});

describe("describeReference", () => {
  it("says the kind, the site, and the resolver when the href is not the destination", () => {
    expect(
      describeReference({
        url: "https://doi.org/10.6028/NIST.SP.800-39",
        resolvedUrl:
          "https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-39.pdf",
        contentType: "application/pdf",
      }),
    ).toBe("PDF · nvlpubs.nist.gov · via doi.org");
  });

  it("omits the resolver when the href is the destination, and drops a leading www", () => {
    expect(
      describeReference({
        url: "https://www.whitehouse.gov/wp-content/uploads/legacy_drupal_files/omb/circulars/A130/a130revised.pdf",
        resolvedUrl:
          "https://www.whitehouse.gov/wp-content/uploads/legacy_drupal_files/omb/circulars/A130/a130revised.pdf",
        contentType: "application/pdf",
      }),
    ).toBe("PDF · whitehouse.gov");
  });

  it("does not describe a blocked page as the document behind it", () => {
    // A script-blocked link is seeded with no destination; the href alone says
    // what it is, and a sign-in page's query string must not make it a PDF.
    expect(
      describeReference({
        url: "https://tools.ietf.org/html/rfc5905",
        resolvedUrl: null,
        contentType: null,
      }),
    ).toBe("tools.ietf.org");
    expect(
      describeReference({
        url: "https://datatracker.ietf.org/accounts/login/?next=/doc/pdf/rfc5905.pdf",
        resolvedUrl: null,
        contentType: null,
      }),
    ).toBe("datatracker.ietf.org");
  });

  it("describes a link the table stores no destination for, from its URL alone", () => {
    // The Zero Trust pane's links carry no media type or resolved address.
    expect(
      describeReference({
        url: "https://www.cisa.gov/sites/default/files/2023-04/zero_trust_maturity_model_v2_508.pdf",
        resolvedUrl: null,
        contentType: null,
      }),
    ).toBe("PDF · cisa.gov");
    expect(
      describeReference({
        url: "https://www.cisa.gov/zero-trust-maturity-model",
        resolvedUrl: null,
        contentType: null,
      }),
    ).toBe("cisa.gov");
  });

  it("copes with a link that was never checked", () => {
    expect(
      describeReference({
        url: "https://csrc.nist.gov/projects/x",
        resolvedUrl: null,
        contentType: null,
      }),
    ).toBe("csrc.nist.gov");
    expect(
      describeReference({
        url: "https://a.gov/x.pdf",
        resolvedUrl: null,
        contentType: null,
      }),
    ).toBe("PDF · a.gov");
    expect(
      describeReference({
        url: "not a url",
        resolvedUrl: null,
        contentType: null,
      }),
    ).toBeNull();
  });
});
