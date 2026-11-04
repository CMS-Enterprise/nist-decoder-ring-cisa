# Contributing

Setup, the local database and the development server are in the [README](./README.md#getting-started). This page covers what a change has to pass and the conventions it follows. Everyone taking part follows the [code of conduct](./CODE_OF_CONDUCT.md); report a security issue privately, as [SECURITY.md](./SECURITY.md) describes.

## Before you open a pull request

Run the gates from the repository root. Each is a `make` target, so it runs the same way on a laptop as in a pipeline:

```bash
make app-check       # ESLint and the TypeScript compiler
make ci-test         # unit tests with the coverage floor, the Python checkers' and shell scripts' tests, and the vocabulary gate
make db-seed-check   # the seed checks, against the seed SQL committed
```

To run one test area on its own, or all of them with `make test-matrix`, see [docs/testing.md](./docs/testing.md). It also says where a new test belongs.

A change to the Dockerfile or the image also runs `make container-build`, `make container-verify` and `make container-scan`. The base images come from `dhi.io` (Docker Hardened Images), which needs a login; this repository holds none, so those gates need your own `dhi.io` access.

The repository runs no CI of its own. The gates are written out, commented, in [`.github/workflows-export/gates.yml`](./.github/workflows-export/gates.yml), where Actions does not run them; to run them in a fork's CI, move the file into `.github/workflows/` and follow its header.

## Conventions

- **One catalog.** This build carries NIST SP 800-53 Rev. 5 and CISA's Zero Trust Maturity Model mapping. The vocabulary of other catalogs stays out of source, tests, comments and seed data; `app/src/config/catalog-vocabulary.ts` lists the terms and `make ci-test` enforces it.
- **Generated seed files are regenerated, not edited.** [`docs/architecture/data-pipeline.md`](./docs/architecture/data-pipeline.md) maps every seed file to its source and the generator that writes it.
- **Comments say what the code does and why.** Issue and pull request numbers go in the pull request, not in code, comments or docs.
- **Schema changes are Prisma migrations**, additive where they can be.

## About this repository

Everything committed here is public: no credentials, internal hostnames, account numbers or other non-public information. The published repository's history starts at a single commit, so a change carried over from the repository it was exported from arrives as a patch (`git format-patch`, then `git am`), never by commit SHA.

Questions go to the CMS ISPG Zero Trust Team at [ISPGZeroTrust@cms.hhs.gov](mailto:ISPGZeroTrust@cms.hhs.gov).
