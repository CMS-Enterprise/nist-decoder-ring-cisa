# Reference links

The catalog a deployment serves cites its references in its own bibliography. This page explains how those references reach the References pane of a control, why each is seeded at its current address rather than the published one, how the retrieval is recorded, and what the sites the references point to actually publish. The procedure is `docs/runbooks/refresh-reference-links.md`; the pipeline's commands and files are `app/prisma/generators/reference-links/README.md`.

## Why the seed carries the current address

The NIST SP 800-53 catalog is pinned to a commit of NIST's OSCAL content, and its bibliography is part of that pin. A pin keeps the controls stable, which is the point of it, but it also freezes two hundred web addresses at the moment of publication. Addresses age faster than catalogs: at the current pin, measured on 2026-09-29, one resource in twenty is dead at its published address or has moved, and the most cited resource of all, OMB Circular A-130 at 94 controls, returns 404. Serving the published address would hand a reader a dead link on the most common reference in the catalog.

So the seed carries, for each resource, the address that works today: the published one when it still answers, the address a redirect lands on when the publisher moved the page, and a replacement a person verified when the published address is gone. The published address is never lost. It stays in the registry beside the seeded one, with the reason the seeded one differs.

One exception is deliberate. A DOI such as `https://doi.org/10.6028/NIST.SP.800-39` redirects to a PDF on nvlpubs.nist.gov, and following that redirect would seed the PDF's path. The DOI is kept, because being the stable name for a document is the whole purpose of a DOI, and the path it resolves to is recorded beside it so the pane can still say where the click will land.

## What a link can and cannot verify

A scripted check can tell four things apart, and treating them as one is how a link checker becomes noise.

- **Reachable:** the address answered, after redirects, with a success. Seeded, at the final address.
- **Blocked to a script:** the host refused or challenged a non-browser client (401, 403, 429, a 202 or 418 challenge, a redirect onto an access-request page, or, on a few .gov and .mil hosts, a 404 that the same host answers to any other client with 403). A browser is usually fine. Seeded as published, listed for a person to confirm.
- **Certificate chain:** the host serves an incomplete certificate chain. A browser fetches the missing intermediate certificate and succeeds; Node does not. Seeded as published, listed for a person.
- **Gone:** 404 or 410, or a page that is really an error page. Not seeded unless a replacement is verified, and named in the redirect report until one is.

Only the last kind is a failure. The two "manual" kinds are reported and never fail a run, because failing on them would either train people to ignore the report or push someone to drop a valid reference.

## Provenance

Three committed files are the record, and git history is the log.

- The live-results file (`sources/reference-links/nist-800-53/live.csv`) is one row per distinct address with the status, the final address, the media type, the class and the date of the check. Every refresh rewrites it, so each refresh is a commit whose rows all carry that date, and the diff between two refreshes is exactly what changed on the web.
- The override table (`sources/reference-links/nist-800-53/overrides.csv`) is the only hand-maintained input: a replacement for an address that is gone, with the reason and the date a person verified it.
- The registry (`reports/reference-links/nist-800-53/registry.csv`) joins the two to the catalog: for every resource, the published address, the seeded address, where it resolves, the media type, the resolution and its reason, the live outcome, the dates, and the controls citing it.

The seed carries the same provenance into the database. `10-reference-links.sql` opens by upserting one `DataSource` row for the corpus, with the catalog pin as its address and the check date as `lastCrawled`, and every link row points at it. The row is updated in place on every re-seed rather than added to, so the References pane's explainer reads the date from the data, and re-running the retrieval before a release is what stamps that release. There is one such row per corpus, and each is typed for the pane it feeds (`reference-links` for the catalog's links, `zt-reference-links` for the Zero Trust ones), which is how the API picks each pane's own date; the Zero Trust corpus keeps the same three files, under `app/prisma/sources/reference-links/cisa/` and `app/prisma/reports/reference-links/cisa/`.

The redirect report (`reports/reference-links/nist-800-53/redirects.md`) is the same facts arranged for the catalog's publisher: which published addresses have a verified replacement, which redirect, which are gone with none, and which could not be verified by a script. It is written to be sent as it is.

## The corpora

The pipeline is laid out per corpus, and two are in place.

- **NIST SP 800-53 Rev 5** (`nist-800-53`): the catalog's back-matter, 201 resources cited by 219 of the 1,014 live controls. In place.
- **CISA Zero Trust references** (`cisa`, under `app/prisma/generators/zt-reference-links/`): the Zero Trust pane's references, mapped per control in a sources table rather than cited by a catalog. Guidance cited at the page or section that addresses a control is maintained by hand beside it, in `17-zt-references-nist.sql`, `18-zt-references-cisa.sql` and `19-zt-references-omb.sql`, each checked with `make check-seed-links SEED_FILES=<file>`. Different controls carry different documents; a document is stored once as a `ReferenceLink` row and attached to each control that cites it through `NistControlLink`, the two tables the Zero Trust pane reads, so nothing in the schema changed. The same retrieval, registry and report, its own provenance row, and a seed file of its own (`14-zt-reference-links.sql`). Every row follows from a tuple in CISA's control mapping: the maturity model by page for each function, OMB M-22-09 at the representative pillar's section and, where the memo's task matrix names the control, at the matrix page, the microsegmentation guide at the page that addresses each control it is on, and the SASE and TIC 3.0 guide on the traffic-encryption controls; 604 rows on all 345 controls CISA maps, across 28 documents; the 212 that had none carry the maturity model's page for every function CISA gives them. CISA's sitemap listed 31 Zero Trust pages and documents on 2026-09-29, of which about a dozen are references rather than news.

## What the source sites publish, measured 2026-09-29

Whether a site publishes a sitemap decides whether a moved address can be found automatically, and none of the NIST hosts does for the pages the catalog cites.

- **csrc.nist.gov** publishes no sitemap at any conventional path, its `robots.txt` redirects to the home page, and it has no `llms.txt`. It does redirect its retired `/publications/detail/...` paths to the current `/pubs/...` scheme, one hop.
- **nvlpubs.nist.gov**, where every NIST DOI resolves, has neither a sitemap nor a `robots.txt`. It answers `HEAD` with 404 on every PDF while serving `GET`, which is why the retrieval sends a one-byte `GET` and never `HEAD`; a HEAD-first check reports the whole NIST corpus as dead.
- **pages.nist.gov** has one sitemap per project (`/OSCAL/sitemap.xml` exists) and none for the host. **www.nist.gov** declares a 56-page sitemap index in its `robots.txt`, and it is www content only: no csrc, publication or SP 800-53 entry.
- **doi.org** is a resolver, not a site. Its handle API (`https://doi.org/api/handles/<doi>`) returns the registered address for a DOI without a redirect chain, and it resolved all 115 DOIs in the back-matter, 114 to nvlpubs.nist.gov.
- **www.govinfo.gov** declares 53 sitemaps in `robots.txt`, one per collection, at paths other than `/sitemap.xml` (which is 404); its `llms.txt` returns the generic home page with a 200. **www.whitehouse.gov** has a WordPress sitemap index and moved its OMB circulars and memoranda from `/sites/whitehouse.gov/files/omb/` to `/wp-content/uploads/legacy_drupal_files/omb/`, which is where A-130, A-108, M-17-06 and M-17-25 now live; the two executive orders the catalog cites live on the previous administration's archive host. **www.cisa.gov** has a sitemap index of two parts (default and documents), blocks one crawler by name, and returns 403 for `llms.txt`.
- **www.iso.org** answers a scripted client with 403 for every standard the catalog cites. **www.nsa.gov, www.dni.gov, www.jcs.mil and www.esd.whs.mil** answer Node with 404 and every other client with 403 for the same addresses, whatever request headers are sent; the retrieval knows these hosts and classifies that 404 as a block. **www.cnss.gov** serves an incomplete certificate chain.
- No host in the set publishes an `llms.txt`.

## Related

- `app/prisma/generators/reference-links/README.md` — the catalog's reference-link pipeline.
- `app/prisma/generators/zt-reference-links/README.md` — the Zero Trust reference-link pipeline.
- `docs/runbooks/refresh-reference-links.md` — the procedure, and how the retrieval treats a site.
- `docs/scripts/check-links.md` — the link checker and its outcome classes.
- `docs/architecture/data-pipeline.md` — where `10-reference-links.sql` and `14-zt-reference-links.sql` sit among the seed files.
