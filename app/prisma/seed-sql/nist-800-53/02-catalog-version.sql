-- 02-catalog-version.sql
-- Source: NIST_SP-800-53_rev5_catalog-min.json (fallback, verified) blob 81c55f5c652bf2c6ccd5de0afe3ebe4618c6af91 @ oscal-content 78650f02ad93

INSERT INTO "NistVersion" ("id", "version", "catalogKey", "displayLabel", "upstreamRevision", "tailoringNote", "releaseDate", "isActive", "description", "createdAt", "updatedAt")
VALUES (
  'nist_r520',
  '800-53r5.2.0',
  'nist-800-53-r5',
  'NIST SP 800-53 Rev 5',
  'NIST SP 800-53 Rev 5.2.0',
  NULL,
  '2025-08-26T14:33:16.000Z',
  true,
  'Electronic (OSCAL) Version of NIST SP 800-53 Rev 5.2.0 Controls and SP 800-53A Rev 5.2.0 Assessment Procedures',
  NOW(),
  NOW()
);
