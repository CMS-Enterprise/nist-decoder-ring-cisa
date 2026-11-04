# Seed Data Pipeline

> **The full pipeline docs moved.** Provenance, the four generators (the NIST catalog, the Zero Trust overlay from CISA's mapping, and the two reference-link pipelines), the two-hierarchy model, `seed-sql/` file order including the withdrawn controls and their lineage, and the deprecation inventory now live in **[`docs/architecture/data-pipeline.md`](../../docs/architecture/data-pipeline.md)**.

## Running the seed

```bash
make db-seed     # Re-seed the database (preferred — handles container, user, and ports)
```

To regenerate the SQL from source, or for the per-file breakdown of `seed-sql/`, see [`docs/architecture/data-pipeline.md`](../../docs/architecture/data-pipeline.md).
