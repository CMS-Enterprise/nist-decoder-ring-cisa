# check-seed-sql

**Script:** `scripts/check-seed-sql.py` · **Make targets:** `make db-seed-check`, `make test-seed-checks` · **Runs:** before every `make db-seed`, and in the Test gate

## Purpose

Checks the committed seed SQL for defects that would fail an INSERT, or would load and then show wrong on the page. It runs against one catalog's directory, `app/prisma/seed-sql/<catalog>/`, and fails the run on any of these:

- **Missing files:** `04`, `06` or `07` is absent (every catalog seeds them, overlay or not), or `12` is absent while `09` is present. The output names each missing file.
- **Part labels (06):** a control part's label is not a marker shape the renderer can punctuate: bare (`a`, `12`), period-suffixed (`a.`), or bracketed (`(a)`, `[1]`).
- **Baseline badge glyphs (every file):** a baseline glyph survived into seeded text, where the modal would show it raw. Scanning no files is also a failure.
- **Zero Trust mappings (09):** an invalid pillar or maturity value, an empty pillars array, or a NULL in a NOT NULL column (`id`, the control key, `function`, `maturityLevel`, `createdById`). Each row is read by column name from the INSERT's column list, and the guidance check below reads the same rows. A missing column list, a missing required column, a row whose value count does not match the list, a row not written one value per line, or no rows at all fails the run.
- **Guidance resolution (09 and 12):** every mapping's (first pillar, function) must resolve to a guidance group; a near-miss spelling of a group fails, and so does `&` in a function name. Guidance no mapping reaches is reported but does not fail.
- **Guidance rows (12):** duplicate ids, an id without its pillar's prefix, an empty base, and two near-identical group names under one pillar.
- **Parameter list bleed (07):** a numbered-list marker left inside a parameter value.
- **Discussion links (04):** a link form the modal would render as raw text (a `HYPERLINK` formula, an HTML anchor, or an Excel `=HYPERLINK(` form).

## Usage

```bash
make db-seed-check                       # the default catalog
make db-seed-check CATALOG=nist-800-53   # a named catalog
make test-seed-checks                    # the checker's own tests, then db-seed-check
python3 scripts/check-seed-sql.py --catalog=nist-800-53
```

Run it from the repository root: the seed directory is a relative path. No database, no network.

## Exit semantics

- `0`: every check passed, or the catalog has no Zero Trust overlay and the backbone checks passed.
- `1`: a check failed, a seed file it reads is missing, the catalog does not exist, or `--catalog=` was given with no name. A missing file does not end the run: the checks that do not read it still run and report.

## Notes

- A catalog without `09-zt-mappings.sql` is a backbone-only seed: the overlay checks (09 and 12) are skipped and the run says so.
- `07-control-parameters.sql` is intentionally empty for NIST SP 800-53, which assigns no parameter values, so the parameter check can only pass on the committed seed. Its tests cover it with synthetic values.
- `scripts/test_check_seed_sql.py` gives each check a clean case, a broken case, and a case proving the script exits 1 on that defect. It runs in `make ci-test-python` and `make test-seed-checks`. See [docs/testing.md](../testing.md).
