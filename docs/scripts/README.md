# Scripts reference

Reference documentation for the repo's standalone scripts — one doc per script.
Each script carries a header comment pointing back here.

This is **distinct from `docs/runbooks/`**: runbooks are operational,
per-environment procedures (deploy, WAF rollback, DB recovery). The docs here
describe **what a script does and how to run it** (purpose, modes/flags, usage,
exit behavior, gotchas).

## Convention

- One markdown file per script: `docs/scripts/<script-name>.md`.
- Each script begins with a header comment pointing to its doc here, e.g.
  `Docs: docs/scripts/check-links.md`.
- A doc covers: purpose, usage (incl. the relevant `make` targets), modes/flags,
  exit semantics, and any gotchas.

## Index

| Script | Doc | Status |
|---|---|---|
| `app/scripts/check-links.ts` | [check-links.md](./check-links.md) | ✅ documented |
| `app/prisma/seed.ts` | [seed.md](./seed.md) | ✅ documented |
| `app/prisma/seed-ecs.ts` | [seed-ecs.md](./seed-ecs.md) | ✅ documented |
| `app/prisma/generators/catalog/generate-seed.ts` | [generate-nist-seed.md](./generate-nist-seed.md) | ✅ documented |
| `app/prisma/generators/reference-links/retrieve.ts`, `build.ts` | [README in the folder](../../app/prisma/generators/reference-links/README.md); runbook [refresh-reference-links.md](../runbooks/refresh-reference-links.md) | ✅ documented |
| `app/prisma/generators/zt-reference-links/retrieve.ts`, `build.ts` | [README in the folder](../../app/prisma/generators/zt-reference-links/README.md); the same runbook | ✅ documented |
| `app/prisma/generators/zt-overlay/transform.ts`, `generate.ts` | [README in the folder](../../app/prisma/generators/zt-overlay/README.md) | ✅ documented |
| `scripts/check-seed-sql.py` | [check-seed-sql.md](./check-seed-sql.md) | ✅ documented |
| `scripts/refresh-image-digests.sh` | [refresh-image-digests.md](./refresh-image-digests.md) | ✅ documented |
| `scripts/scan-base.sh` | [scan-base.md](./scan-base.md) | ✅ documented |
| `scripts/check-rds-bundle.py` | [check-rds-bundle.md](./check-rds-bundle.md) | ✅ documented |
| `scripts/check-environment.sh` | [docker-environments.md](../architecture/docker-environments.md), which its header names | ✅ documented |
| `scripts/db-recover.sh`, `db-recover-check.cjs` | [db-recover.md](./db-recover.md) | ✅ documented |
