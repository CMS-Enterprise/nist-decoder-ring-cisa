-- 00-cleanup.sql
-- Source: NIST_SP-800-53_rev5_catalog-min.json (fallback, verified) blob 81c55f5c652bf2c6ccd5de0afe3ebe4618c6af91 @ oscal-content 78650f02ad93

-- CASCADE emits a NOTICE per dependent table; quiet them so a real warning stands out.
SET client_min_messages = warning;
TRUNCATE TABLE "Fips200Requirement" CASCADE;
TRUNCATE TABLE "FipsImpactLevel" CASCADE;
TRUNCATE TABLE "ControlLineage" CASCADE;
TRUNCATE TABLE "NistControlExternalEntity" CASCADE;
TRUNCATE TABLE "ExternalEntity" CASCADE;
TRUNCATE TABLE "NistControlLink" CASCADE;
TRUNCATE TABLE "ReferenceLink" CASCADE;
TRUNCATE TABLE "NistLink" CASCADE;
TRUNCATE TABLE "ZeroTrustMapping" CASCADE;
TRUNCATE TABLE "ZTMMGuidance" CASCADE;
TRUNCATE TABLE "AssessmentObjective" CASCADE;
TRUNCATE TABLE "AssessmentMethod" CASCADE;
TRUNCATE TABLE "ControlParameter" CASCADE;
TRUNCATE TABLE "ControlPart" CASCADE;
TRUNCATE TABLE "NistControl" CASCADE;
TRUNCATE TABLE "ControlFamily" CASCADE;
TRUNCATE TABLE "NistVersion" CASCADE;
