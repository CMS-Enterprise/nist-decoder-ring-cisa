import { describe, expect, it } from "vitest";

import { seedProgress } from "../seed-progress";

const files = [
  "00-cleanup.sql",
  "01-system-user.sql",
  "09-zt-mappings.sql",
  "10-reference-links.sql",
];

describe("seedProgress", () => {
  it("names what loaded, where it stopped and what never ran", () => {
    expect(seedProgress(files, 2)).toBe(
      "Partial seed: loaded 2 of 4 file(s) (00-cleanup.sql, 01-system-user.sql); " +
        "failed at 09-zt-mappings.sql; not run: 10-reference-links.sql. " +
        "Fix the cause and run the whole seed again; it starts by truncating.",
    );
  });

  it("says none on either side when the first or last file fails", () => {
    expect(seedProgress(files, 0)).toContain("loaded 0 of 4 file(s) (none)");
    expect(seedProgress(files, 3)).toContain("not run: none.");
  });
});
