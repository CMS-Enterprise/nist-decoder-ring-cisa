# Refresh the reference links

For two readers: the maintainers of this repository, who run the refresh, and the owners of the sites the references point to (NIST for the catalog's own references, CISA for the Zero Trust ones), who may want to know how their site is used. The first section is for the second reader; the rest is the procedure.

Each control has two References sections: the catalog pane lists the publications the catalog cites, and the Zero Trust pane lists the Zero Trust references mapped to that control. Both sets of addresses are checked by the same small retrieval, run on demand for each corpus, and the result is committed beside the seed, so the date on every link is the date of a real check.

## How this tool uses your site

- **One request per address, asking for the first byte.** Every distinct URL the catalog cites, or the Zero Trust sources table lists, gets one `GET` with `Range: bytes=0-0`. A server that supports ranges answers with one byte; one that does not answers with the page, which is read no further. Redirects are followed so the current address is recorded.
- **Slowly.** At most four requests are in flight, with a 300 ms pause between them. A request that times out (20 s) or drops is retried once, after two seconds. A whole run over the NIST catalog is about two hundred requests and under a minute.
- **Identified.** Every request carries the client string `Mozilla/5.0 (compatible; decoder-ring-link-check/1.0)`, so it can be recognised in a log and, if it is unwelcome, blocked by that token.
- **No crawling.** Only the addresses the catalog itself publishes, or a person entered in the sources table, are requested. No sitemap is read, no links are followed from a page, and no page body is downloaded except one page on a host known to serve its error page with a success status.
- **On demand, not on a schedule.** It runs when a maintainer refreshes the links: when the catalog is updated, when a link is reported dead, and before a release. It does not run automatically.
- **What is kept.** For each address: the HTTP status, the final address after redirects, the media type, a classification, and the date. Nothing from a page body is stored.
- **Contact.** The maintainers of this repository, through the repository itself.

## When to use this runbook

- The pinned catalog has moved (see `app/prisma/sources/nist-800-53/SOURCE.md`).
- A reference link is reported dead or moved.
- Before a release, so the seed and the pane carry the date of the release.

## Prerequisites

- A checkout with the dependencies installed (`make setup`, or `make db-up` and `cd app && yarn install`).
- Network access to the sites the catalog cites. No credentials are needed.
- For a browser check of anything flagged, a browser.

## Procedure

1. **Retrieve.** `make reference-links-retrieve`. It probes every distinct address and rewrites `app/prisma/sources/reference-links/nist-800-53/live.csv`. The console lists what needs a manual check and what is not reachable.
2. **Review the diff of `live.csv`.** Every row carries the new date; the rows whose `status`, `final_url` or `class` changed are what changed on the web since the last pull. A new `gone` row is a reference that will be held out of the seed until a replacement is found.
3. **Find replacements for anything gone.** Confirm the new address in a browser, then add a row to `app/prisma/sources/reference-links/nist-800-53/overrides.csv` with the published address, the replacement, one sentence of reason, and today's date.
4. **Build.** `make reference-links-build`. It reads the catalog, `live.csv` and `overrides.csv`, checks the gates, and writes `app/prisma/seed-sql/nist-800-53/10-reference-links.sql`, `reports/reference-links/nist-800-53/registry.csv` and `reports/reference-links/nist-800-53/redirects.md`. A gate that fails names what is wrong and writes nothing.
5. **Review `redirects.md`.** Its "gone, no replacement known" section is the to-do list; its "could not be verified by a script" section is the list to confirm in a browser. It is also the report to send to the catalog's publisher.
6. **Seed and look.** `make db-seed`, then open a control that cites references (AC-01 cites six) and the "i" on the References header: the last line reads the date of this pull.
7. **Commit the data, the seed and the reports together.** They are one change: the retrieval, the resolution and the result.

### The Zero Trust references

The same steps over the sibling pipeline, `app/prisma/generators/zt-reference-links/`, whose input is a table mapped per control rather than the catalog:

1. **Add or change a row** in `app/prisma/sources/reference-links/cisa/sources.csv`: the control as the catalog labels it, the address, the document's title, its citation, and its position among that control's references. A document is stored once, so it has one title and one citation however many controls cite it.
2. **Retrieve.** `make zt-reference-links-retrieve` rewrites `sources/reference-links/cisa/live.csv`; review its diff as above.
3. **Find replacements for anything gone** and add them to `sources/reference-links/cisa/overrides.csv`. A gone address with no override fails the build rather than being held out: a listed address that is gone is a row to fix.
4. **Build.** `make zt-reference-links-build` writes `app/prisma/seed-sql/nist-800-53/14-zt-reference-links.sql`, `reports/reference-links/cisa/registry.csv` and `reports/reference-links/cisa/redirects.md`.
5. **Seed and look.** `make db-seed`, then open a control with mapped references (AC-02 has six) and the "i" on the Zero Trust pane's References header: its last line reads the date of this pull.
6. **Commit the table, the live results, the seed and the reports together.**

## Verify

- `make ci-check-links` scans every URL in the seed offline and passes.
- `make check-seed-links` probes each distinct seeded URL once, both corpora, and reports no dead or unreachable link; the "manual check" rows are the ones seeded as published.
- Each References pane shows the new date in its explainer.

## Rollback

`git revert` the commit. The three files are the whole state; there is no external side effect to undo. Re-seed with `make db-seed`.

## Related

- `app/prisma/generators/reference-links/README.md` — the catalog's reference-link pipeline: commands, files, gates, the resolution rule, with a diagram.
- `app/prisma/generators/zt-reference-links/README.md` — the Zero Trust reference-link pipeline, the same shape over a table mapped per control.
- `docs/architecture/reference-links.md` — why the seed carries the current address, the provenance model, and what each source site publishes.
- `docs/scripts/check-links.md` — the link checker that does the probing.
- `docs/runbooks/ecs-migration-and-seed.md` — seeding a deployed environment.
