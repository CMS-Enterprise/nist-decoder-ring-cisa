-- 03-control-families.sql
-- Source: NIST_SP-800-53_rev5_catalog-min.json (fallback, verified) blob 81c55f5c652bf2c6ccd5de0afe3ebe4618c6af91 @ oscal-content 78650f02ad93

INSERT INTO "ControlFamily" ("id", "name", "sortOrder")
VALUES
  ('AC', 'Access Control', 1),
  ('AT', 'Awareness and Training', 2),
  ('AU', 'Audit and Accountability', 3),
  ('CA', 'Assessment, Authorization, and Monitoring', 4),
  ('CM', 'Configuration Management', 5),
  ('CP', 'Contingency Planning', 6),
  ('IA', 'Identification and Authentication', 7),
  ('IR', 'Incident Response', 8),
  ('MA', 'Maintenance', 9),
  ('MP', 'Media Protection', 10),
  ('PE', 'Physical and Environmental Protection', 11),
  ('PL', 'Planning', 12),
  ('PM', 'Program Management', 13),
  ('PS', 'Personnel Security', 14),
  ('PT', 'Personally Identifiable Information Processing and Transparency', 15),
  ('RA', 'Risk Assessment', 16),
  ('SA', 'System and Services Acquisition', 17),
  ('SC', 'System and Communications Protection', 18),
  ('SI', 'System and Information Integrity', 19),
  ('SR', 'Supply Chain Risk Management', 20)
ON CONFLICT ("id") DO NOTHING;
