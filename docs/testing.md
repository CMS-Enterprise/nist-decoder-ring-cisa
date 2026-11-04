# Testing

Where each kind of test lives, how to run it, and what stops a change that breaks it. Each area has its own `make` target, and `make test-matrix` runs them all. The gates named below are the jobs in [`.github/workflows-export/gates.yml`](../.github/workflows-export/gates.yml), which this repository does not run itself; [CONTRIBUTING.md](../CONTRIBUTING.md) says how to enable them.

## The test areas

| Area | What it covers | Run it | What gates it | Where a new test goes |
|---|---|---|---|---|
| Seed checks | `scripts/check-seed-sql.py`, and the committed seed SQL it checks | `make test-seed-checks` | The Test gate: `make ci-test` runs the checker's tests, and `make db-seed-check` runs the checks against the committed seed | `scripts/test_check_seed_sql.py` |
| Browser flows | The bridge's filter, search and control flows in a real browser, and the accessibility scan | Not built yet | | |
| API surface | The tRPC setup and its client wiring (`src/server/api/trpc.ts`, `src/trpc/`), the auth wiring (`src/server/auth/`), the database client and the route handlers | `make test-api` | The Test gate: `make ci-test` runs them, with the coverage floor | A `__tests__/` folder beside the module |
| Seed pipeline | The generators' offline build steps, and the seed loaders | Not built yet | | |
| Scripts | The shell scripts under `scripts/`, run through bash with `aws`, `docker`, `ps` and `sleep` stubbed | `make test-scripts` | The Test gate: `make ci-test` runs them | `scripts/test_shell_scripts.py` |

The gates do not run `make test-matrix`. The Test gate runs `make ci-test` and `make db-seed-check`, which between them run every area above. A new area's tests must run through one of those, or through a gate of their own, before the area counts as gated; adding its target to `test-matrix` alone gates nothing.

A seed check needs three tests: clean input that passes, broken input that the check reports, and a case in `test_main_exits_one_on_each_defect` proving the script exits 1 on that defect. A check whose finding is printed but never fails the run gates nothing.

A script test runs the script for real, with every command that reaches outside the repository replaced by a stub on `PATH` that records its calls and answers from fixtures. Assert what the script would have run, especially that a call which changes something names only what it should: `dr-restore-test.sh`, for one, may read the live database but must only change the throwaway copy. `local-env.sh status` and `stop` are not covered; `stop` signals processes with the shell's own `kill`, which a stub cannot intercept.

An API test mocks what lies outside the app (Auth.js, Prisma, Next's request headers) and runs the app's own code: the route handler test sends requests through the real handler, context, middleware and error formatter, against a small router built from the real procedure builders. Modules that do their work on import (the auth configuration, the database client) are loaded fresh per case with `vi.resetModules()`. Mock call history is cleared before each test, so work done on import is recorded in plain arrays rather than read from a mock afterwards.

`07-control-parameters.sql` is intentionally empty for NIST SP 800-53, which assigns no parameter values, so on the committed seed the parameter check can only pass. Its tests run it against synthetic values.

## The suites underneath

The areas above sit on the same suites everything else uses.

| Suite | Run it | What gates it | Where a new test goes |
|---|---|---|---|
| Unit (Vitest, mocked database) | `make ci-test-js` | The Test gate, with the coverage floor | A `__tests__/` folder beside the code, named `*.test.ts` or `*.test.tsx` |
| Integration (Vitest, real Postgres in a throwaway container) | `make test-integration` | No gate runs it; run it before a change to the schema, the seed or a query | `*.integration.test.ts`, using the harness in `app/src/test/db/` |
| pytest (the Python checkers and the shell scripts) | `make ci-test-python` | The Test gate | `scripts/test_<script>.py`, added to `PYTEST_FILES` in the Makefile, which names each suite |

## Coverage

The coverage floors in `app/vitest.config.ts` (95% lines and statements, 90% functions, 88% branches) are measured once, over the whole unit suite, in `make ci-test`. They count every source file under `app/src`, `app/prisma` and `app/scripts`, whether a test imports it or not, so a module no test reaches shows as uncovered instead of missing from the report. An area's own target runs without them, because one area alone cannot meet a floor set for the whole suite. Never lower a floor to get a build green: cover the branch, or exclude the file with its reason written beside the exclusion.

## The vocabulary gate

`make ci-test` also sweeps every file this repository ships, tests and fixtures included, for the vocabulary of other catalogs. The terms are in `app/src/config/catalog-vocabulary.ts`. A test fixture that needs a control identifier uses a NIST one.
