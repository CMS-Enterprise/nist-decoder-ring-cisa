# ZT Decoder Ring

A visual crosswalk from the NIST SP 800-53 Rev 5 security and privacy controls to the CISA Zero Trust Maturity Model, built for security and compliance teams at any federal agency.

## Overview

NIST SP 800-53 says what a system must do. The CISA Zero Trust Maturity Model describes how an agency's capabilities mature across five pillars and three cross-cutting capabilities. Decoder Ring puts the two side by side: open any control, read the catalog's own statement and discussion, and see which Zero Trust pillar, function and maturity stage the control supports, with the guidance and references for that stage.

## The problem

- **The catalog states requirements, not Zero Trust outcomes.** A control's statement rarely names the pillar or the maturity stage it advances.
- **The guidance lives in several places.** The maturity model, OMB's zero trust strategy memorandum (M-22-09) and CISA's supporting guides are separate documents, each organised its own way.
- **Static documents do not answer "where does this control fit?"** Answering it means reading across all of them, one control at a time.

## What Decoder Ring does

- **Maps controls to the maturity model.** Each mapped control carries its pillars, functions and maturity stages, and the guidance for each.
- **Shows the whole catalog at once.** A "layer cake" of the 20 control families, coloured by whether a control, or only its enhancements, is mapped.
- **Filters and searches.** By Zero Trust status, by baseline (Low, Moderate, High, Privacy), and by control number, name or text.
- **Keeps the catalog's own words.** Statements, discussion, parameters and baselines come from NIST's published OSCAL catalog, and each control shows its SP 800-53A assessment procedures.
- **Cites its sources.** One pane lists the references the catalog cites; the other lists the Zero Trust references chosen for that control.

## Who it is for

- **Security and compliance teams** planning Zero Trust work control by control.
- **System owners and assessors** who need the catalog text and the maturity-model view in one place.
- **Agency Zero Trust programs** looking for one consistent reading of where each control lands in the model.

## The catalog in this build

| What | Count |
|---|---|
| Control families | 20 |
| Controls | 1,014 live: 300 base controls and 714 enhancements |
| Withdrawn controls | 182; the 180 the catalog gives a successor show the controls that took their content |
| Controls with a Zero Trust mapping | 345 |

## Project Structure

```
.
├── app/                    # Next.js application (UI, tRPC API, Prisma schema and seed)
│   └── prisma/
│       ├── sources/              # Inputs, never generated: the NIST catalog, the Zero Trust mapping, link registries
│       ├── generators/           # Code: catalog/, zt-overlay/, reference-links/, zt-reference-links/, shared/
│       ├── reports/              # What each generator reports (tuples, findings, link registries)
│       └── seed-sql/nist-800-53/ # Generated seed, loaded in file order
├── backend/                # Placeholder for future jobs and Lambda functions
├── docs/
│   ├── architecture/       # Architecture and decision records
│   ├── runbooks/           # Operational runbooks
│   └── scripts/            # One page per script
├── infra/                  # Terraform: bootstrap, environments (dev, prod), modules
└── scripts/                # Repository checks and utilities
```

## Technology Stack

This project uses the **T3-app framework**, an opinionated, type-safe toolchain for full-stack development.

### Application
- **Next.js** and **React**: the UI, with server-side rendering
- **TypeScript**: strict mode across the codebase
- **Tailwind CSS**: styling
- **tRPC**: an end-to-end type-safe API
- **Prisma** with **PostgreSQL**: the catalog, the mappings and the references
- **Auth.js**: sign-in wiring; see [auth-strategy.md](docs/architecture/auth-strategy.md)

### Hosting
- **AWS ECS on Fargate** behind an **Application Load Balancer** and **AWS WAF**
- **PostgreSQL** 16 on Amazon RDS
- **Terraform** for all infrastructure

## Getting Started

### 🐳 Docker Environments

This project runs the app four ways, in two port bands (3XXX for the dev server, 13XXX for the containers; see `docs/architecture/docker-environments.md`):
- **Local Development** (port 3000): `make dev` - Fastest, runs on your machine
- **Local Development with the inspector** (port 3001, inspector 3002): `make dev-debug` - The same, with the Node inspector for an editor to attach to
- **Containerized** (port 13000): `make container-up` - The hardened image that ships to AWS, run locally ("test what you ship")
- **Debug container** (port 13001): `make container-debug` - Local-only dev-shell image with hot reload; never deployed

**Check current environment:** `make check-env` · **The commands to run by hand:** `make help`

📖 **[Complete Docker Environments Guide](docs/architecture/docker-environments.md)** - Detailed setup, troubleshooting, and workflows

### Prerequisites

- **Node.js 24+ installed** (required)
- **Docker installed and running** (for local database)
- **Yarn 1.22.5 or later, or Corepack** (package manager): either runs the Yarn 4 release committed under `app/.yarn/releases`
- **Make installed** (for running commands)
- **Python 3 installed** (the seed check that runs before every seed is a Python script)

### First-Time Setup

**Single command setup (recommended):**

```bash
git clone <repository-url>
cd nist-decoder-ring-cisa
make setup
```

This will:
1. Start PostgreSQL database (Docker on port 5439)
2. Install all dependencies, and point git at the repository's hooks in `.husky/` (set `HUSKY=0` to skip that)
3. Copy `.env.example` to `.env`
4. Run Prisma migrations
5. Seed the database with the NIST SP 800-53 Rev 5 catalog (1,014 live controls and 182 withdrawn) and its Zero Trust overlay

**Then start development:**

```bash
make dev
# App available at http://localhost:3000
```

### Daily Development

```bash
cd nist-decoder-ring-cisa
make dev        # Starts database + Next.js dev server
# Work on code... hot-reload enabled
# Ctrl+C when done
make db-down    # Stop database
```

### Additional Commands

```bash
make help          # The workflows and the destructive resets
make check-env     # Check which Docker environment is running
make db-seed       # Re-seed the database (1,014 live controls, 182 withdrawn)
make db-studio     # Browse database visually
make app-check     # Run lint + typecheck
make container-up  # Run the hardened shipping image locally (:13000)
```

For complete Docker commands and workflows, see [Docker Environments Guide](docs/architecture/docker-environments.md).

### Prisma Client Regeneration

**When you might need to regenerate Prisma Client:**
- After pulling changes that modify the database schema
- After switching branches, since `app/generated/` is not committed
- If a query or a type names a model or field the client does not have

**Quick fix:**
```bash
make db-generate  # Regenerates the client, and nothing else
```

📖 **[Prisma Troubleshooting Runbook](docs/runbooks/prisma-client-troubleshooting.md)** - Complete guide for Prisma issues

📖 **[Reference links: how each pane's references are kept current](docs/architecture/reference-links.md)** — the catalog's citations and the Zero Trust references mapped per control, with the refresh runbook, `docs/runbooks/refresh-reference-links.md`.

**Note:** Most make commands (`make setup`, `make container-build`) handle Prisma generation automatically. Manual regeneration is rarely needed.

### Manual Setup (if needed)

```bash
make db-up
cd app
cp .env.example .env
yarn install
yarn prisma migrate deploy
SEED_CATALOG=nist-800-53 yarn prisma db seed
yarn dev
```

See `app/README.dev.md` for detailed development documentation.

## Data Sources

The catalog and its references come from public sources, and each catalog seed file records the source file and revision it was generated from.

- **[NIST SP 800-53 Rev 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)**: the controls with their statements, discussion, parameters and baselines, from NIST's published OSCAL catalog ([usnistgov/oscal-content](https://github.com/usnistgov/oscal-content)).
- **[NIST SP 800-53A Rev 5](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)**: the assessment procedures for each control.
- **[CISA Zero Trust Maturity Model](https://www.cisa.gov/zero-trust-maturity-model)**: the pillars, functions and maturity stages each mapping uses.
- **[CISA's Zero Trust Maturity Model control mapping](https://www.cisa.gov/zero-trust-maturity-model)** to NIST SP 800-53 Rev 5, as CISA published it: which pillars, functions and maturity stages each control maps to, with CISA's designations, generated into the seed by `app/prisma/generators/zt-overlay/`.
- **The Zero Trust guidance** shown for each pillar and function is this project's own text, written around the maturity model's stages and hand-maintained in `app/prisma/seed-sql/nist-800-53/12-ztmm-guidance-updated.sql`. It is not taken from a published source.
- **[OMB M-22-09](https://www.whitehouse.gov/wp-content/uploads/2022/01/M-22-09.pdf)** and CISA's supporting guides: the Zero Trust references cited for each control.

The pipeline from source files to seed SQL is described in [data-pipeline.md](docs/architecture/data-pipeline.md).

## Development Standards

- **Type Safety**: All code must pass TypeScript strict mode checks
- **Database Migrations**: Use Prisma migrations for all schema changes
- **Code Review**: All changes require peer review before merge
- **Testing**: Unit tests required for all business logic; `make ci-test` enforces the coverage floors (95% lines and statements, 90% functions, 88% branches). [docs/testing.md](./docs/testing.md) lists the test areas, how to run each, and where a new test goes

## Roadmap

### Current
- ✓ Control navigation with the visual "layer cake"
- ✓ A Zero Trust mapping per control, with guidance for each maturity stage
- ✓ The catalog's references and the Zero Trust references per control
- ✓ Filters by status and baseline, and search
- ✓ Export of any selection, from one control to the whole catalog, as XLSX or DOCX

### Future Iterations
- **More control catalogs.** The catalog is a first-class dimension of the data model, so another catalog arrives as data rather than as a fork of the application.
- **New editions of CISA's mapping.** Take in each corrected or extended edition CISA publishes; Standard authors no mapping of its own, so coverage follows CISA's.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the gates a change passes and the conventions it follows, [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), and [SECURITY.md](./SECURITY.md) for reporting a vulnerability privately.

## License

In the public domain within the United States, with copyright and related rights waived worldwide through CC0 1.0 Universal: see [LICENSE.md](./LICENSE.md).

## Security and Compliance

### Data Classification
- **No PII or PHI**: the application does not store or process personal or health information.
- **Public sources**: every catalog, mapping and reference row comes from a published source. The Zero Trust guidance text is this project's own, written around CISA's Zero Trust Maturity Model.

### Security Controls
- WAF protection for all public endpoints
- TLS 1.2+ for all data in transit
- Encryption at rest for the database
- VPC isolation for backend services
- Regular security scanning and vulnerability assessment
