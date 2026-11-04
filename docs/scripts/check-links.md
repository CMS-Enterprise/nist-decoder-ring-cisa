# check-links — URL integrity checker

Validates the hyperlinks the Decoder Ring stores and serves, at **each layer of the stack**, using only Node 24's native `fetch` — no external link-check tool, no new dependencies (`pg` and `tsx` are already in the tree).

- Script: `app/scripts/check-links.ts` (+ helpers in `app/scripts/check-links/`)
- Make targets: `ci-check-links`, `check-seed-links`, `check-links`, `check-links-api`

## The layer model (DB → API → UI)

Links are validated at each layer they pass through, because a link can be fine in the DB but dropped or mangled by the API, and the UI only renders what the API serves:

- **DB (source of truth)** — the widest set:
  - `--source=seed-sql` — offline parse of the committed `app/prisma/seed-sql/<catalog>/*.sql` (what *will* be loaded). This is the CI gate source (no DB, no network). Comment lines are skipped, so an apostrophe in a `--` comment cannot invert the quote pairing of the rows below it.
  - `--source=db` — `pg.Client` on `DATABASE_URL` (what *is* stored): `ReferenceLink.url`, `NistLink.url`, `DataSource.url`, **and** URLs embedded in `NistControl.referencePolicy` and `NistControl.discussion`.
- **API** — `--source=api` — the served tRPC procedures (`getBridgeData` for the control list, then `getControlById` for **base + enhancements**). Catches anything the resolver drops, mangles, or auth-gates between DB and client.
- **UI** — covered **partially** by the API mode. `ControlModal.tsx` renders the `ztLinks` and `nistLinks` arrays the API mode collects, but it also renders outward links written into discussion prose, and the API collector does not extract those. The `db` source does, via its embedded-URL scan, so those URLs are covered there rather than here. Treat API mode as covering the served link arrays, not as a complete UI-link check.

Note the layers report **different sets by design** (the DB layer includes `referencePolicy` URLs not surfaced as links; the API layer counts per-served occurrence). Different counts ≠ different broken links.

## Validation layers

- **Static / format** — always runs; **hard gate** (any failure → non-zero exit). Flags double-scheme (`https://…/https://…`), unencoded whitespace, non-`http(s)` scheme, and empty/malformed (WHATWG `URL`). The gate knows no host: which paths a site answers with 404 is a fact about that site, recorded in its corpus's override table (`app/prisma/sources/reference-links/<corpus>/overrides.csv`) and redirect report (`app/prisma/reports/reference-links/<corpus>/redirects.md`), not a format rule.
- **Live HTTP** (`--live`) — one native GET per distinct URL asking for the first byte (`Range: bytes=0-0`), never HEAD: nvlpubs.nist.gov, where every NIST DOI resolves, answers HEAD with 404 on every PDF while serving GET. Redirects are followed and the final URL recorded; a timeout or dropped socket is retried once; the default timeout is 20 s (`LINKCHECK_TIMEOUT_MS`), concurrency 4 with a 300 ms pause (`LINKCHECK_CONCURRENCY`, `LINKCHECK_DELAY_MS`). Every outcome is classified — `reachable`, `script-blocked` (401/403/429, a 202 or 418 bot challenge, a redirect onto a known access-request page, or a 404 from a host measured to answer other clients with 403), `tls-chain` (an incomplete certificate chain a browser repairs and Node does not), `gone` (404/410 or a soft-404), `unreachable` (5xx, DNS, repeated timeout). Only `gone` and `unreachable` count as failures; the two "manual" classes are listed for a person and never fail the run. **Report-only** — does not fail the run unless `--strict`.
- **Content / soft-404** (`--content`, implies `--live`) — flags an HTTP 200 that is really an error page: a redirect onto the host root, or a per-host "not found" title signature (`SOFT_404_TITLE` in `report.ts`). The range GET still goes first; a body is fetched only when the final host has a signature, so a corpus of PDFs is never downloaded whole. The table is empty here: every host the NIST corpus links to answers a missing page with a real 404, measured 2026-09-30. A host is added from a measured soft-200, with the title it serves.
- The reference-link pipeline (`app/prisma/generators/reference-links/`) calls the probe as a library to check the catalog's back-matter and record each address's outcome; see `docs/architecture/reference-links.md`.

## Usage

```bash
# Offline format gate over the committed seed SQL (no DB, no network):
make ci-check-links

# Throttled live check of every seed URL, with the content layer (no DB needed):
make check-seed-links
# ...or of the named seed files only; a name the folder does not hold is an error:
make check-seed-links SEED_FILES=17-zt-references-nist.sql,18-zt-references-cisa.sql

# Full check against the local DB (static gate + live probe); needs the DB up:
make db-up          # start local postgres
make check-links    # DATABASE_URL defaults to the local DSN

# Links as the API/UI serves them, against a running base URL (report-only live):
make check-links-api BASE=http://localhost:3000

# Raw (what the make targets wrap):
cd app && yarn tsx scripts/check-links.ts --source=seed-sql
cd app && DATABASE_URL=… yarn tsx scripts/check-links.ts --source=db --live
cd app && yarn tsx scripts/check-links.ts --source=api --base=<url> --live [--strict]
```

Flags: `--source=seed-sql|db|api`, `--base=<url>` (api), `--live` (add the HTTP probe), `--content` (implies `--live`; adds the soft-404 body check), `--strict` (make live failures also non-zero).

## Exit semantics

Format failures fail hard (non-zero). Live failures are report-only (exit 0) unless `--strict`. So a run can "FAIL" purely on format issues while live failures are informational.

## When it runs

- The pre-commit hook runs `ci-check-links` when a staged change touches the reference-link pipeline, the ZT seed generator, or a generated links file. The Lint & Typecheck gate runs it too: `make ci-check`, which that gate calls, is lint, typecheck, the version check and `ci-check-links`.
- `make check-seed-links` is on demand: after `make reference-links` regenerates the seed, and before a publish. The runbook is `docs/runbooks/refresh-reference-links.md`.

## Related

- `app/scripts/check-links/validate.ts` — the unit-tested format core.
- `app/scripts/check-links/classify.ts` — the outcome classes and the measured host lists behind them.
- `docs/architecture/reference-links.md` — why the seed carries the current address of each reference and how the classes are used there.
