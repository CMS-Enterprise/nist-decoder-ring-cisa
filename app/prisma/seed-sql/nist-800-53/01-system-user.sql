-- 01-system-user.sql
-- Source: NIST_SP-800-53_rev5_catalog-min.json (fallback, verified) blob 81c55f5c652bf2c6ccd5de0afe3ebe4618c6af91 @ oscal-content 78650f02ad93

INSERT INTO "User" ("id", "email", "name", "emailVerified")
VALUES ('system_nist_gov', 'system@nist.gov', 'System', NOW())
ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name";
