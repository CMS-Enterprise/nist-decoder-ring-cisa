-- 19-zt-references-omb.sql
--
-- HAND-MAINTAINED (this file is the source of truth: edit it directly; no generator writes it).
--
-- Zero Trust references from OMB publications, each cited at the page or section that
-- addresses the control it is attached to. They show in the Zero Trust pane after the references
-- 14-zt-reference-links.sql seeds for the same control.
--
-- Every row meets the acceptance rule:
--   1. The document is published by CISA, OMB or NIST.
--   2. The address opens a specific page or section, a PDF page anchor or a section heading
--      anchor, never a landing page.
--   3. The row names a control the page or section addresses, and the document entry says in
--      one sentence what that page or section covers. A document is stored once per address,
--      so the sentence describes the page, not why one control cites it.
--   4. The link check passes on the address: make check-seed-links SEED_FILES=19-zt-references-omb.sql
--
-- Only controls in the CISA Zero Trust mapping take a row (sources/zt-mapping/cisa-ztmm-mapping.csv).
--
-- How to add a reference:
--   * A new address: add one documents entry (address, title, one-sentence description, domain),
--     then one attachments entry per control. The title names the document, the section and the
--     printed page; the anchor is the PDF page index, which can differ from the printed page.
--     Domain follows the host: NIST for nist.gov, FEDERAL for other .gov or .mil, else EXTERNAL.
--   * An address another seed file already defines: add only the attachments entry.
--   * An attachment names the control id as the catalog seeds it (ctrl_ac-03_r520,
--     ctrl_ac-03_07__r520), the address, and its position among the rows this file gives that
--     control (1, 2 and so on). It lands after the references earlier files gave the control.
--   * A wrong control id, an address with no document entry, or a pair already seeded fails the
--     seed rather than being skipped.
--   * When the links are checked again, set lastCrawled in the DataSource row to that date, in UTC
--     as the generated file records its check. The pane reports the oldest check across its
--     reference files.
--   * Keep comments free of apostrophes and web addresses: the link check reads this file as a
--     link list and skips only whole comment lines.

-- The check that verified these links. The pane dates its references by the oldest check.
INSERT INTO "DataSource" ("id", "name", "type", "url", "authorityLevel", "lastCrawled", "isActive", "description", "createdById", "createdAt", "updatedAt")
VALUES ('dsrc_zt-references_omb', 'omb zt references', 'zt-reference-links', NULL, 'reference'::"AuthorityLevel", '2026-10-28'::timestamp, true, 'Zero Trust references from OMB memoranda, maintained by hand in 19-zt-references-omb.sql and checked with make check-seed-links.', 'system_nist_gov', NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "lastCrawled" = EXCLUDED."lastCrawled", "description" = EXCLUDED."description", "updatedAt" = NOW();

-- Documents: one entry per address.
INSERT INTO "ReferenceLink" ("id", "url", "title", "description", "domain", "linkType", "dataSourceId", "createdAt", "updatedAt")
SELECT 'rlink_' || left(md5(d.url), 16), d.url, d.title, d.description, d.domain::"LinkDomain", 'GUIDANCE'::"ReferenceLinkType", 'dsrc_zt-references_omb', NOW(), NOW()
FROM (VALUES
  -- OMB M-26-14, agency logging and network visibility
  ('https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=2', 'OMB M-26-14, Prioritization (p. 2)', 'Office of Management and Budget, Memorandum M-26-14, Ensuring Effective and Efficient Agency Logging and Network Visibility to Defend Against Evolving Cyber Threats, May 2026, section Prioritization, page 2: the two logging objectives agencies prioritize, continuous event monitoring that flags and responds to anomalous activity in real time, and threat hunting, investigation, response and forensics on centralized logs kept in hot and cold storage.', 'FEDERAL'),
  ('https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=6', 'OMB M-26-14, Appendix B minimum logging baseline (p. 6)', 'Office of Management and Budget, Memorandum M-26-14, Ensuring Effective and Efficient Agency Logging and Network Visibility to Defend Against Evolving Cyber Threats, May 2026, Appendix B Minimum Logging Baseline Requirements and Objectives, page 6, the first of two: log retention, logs available to the agency security operations center, synchronized timestamps, coverage of all agency technology, and the first log collection activities.', 'FEDERAL'),
  ('https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=7', 'OMB M-26-14, Appendix B minimum logging baseline (p. 7)', 'Office of Management and Budget, Memorandum M-26-14, Ensuring Effective and Efficient Agency Logging and Network Visibility to Defend Against Evolving Cyber Threats, May 2026, Appendix B Minimum Logging Baseline Requirements and Objectives, page 7, the second of two: the remaining log collection activities, among them hunting for indicators of compromise and anomalous system or user activity, and automated alerts for each.', 'FEDERAL'),
  ('https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=8', 'OMB M-26-14, Appendix C logging maturity model (p. 8)', 'Office of Management and Budget, Memorandum M-26-14, Ensuring Effective and Efficient Agency Logging and Network Visibility to Defend Against Evolving Cyber Threats, May 2026, Appendix C Logging Maturity Model for an Information System, page 8: maturity levels for asset inventory visibility, log collection coverage and alerting, data retention, and log management including encryption and hashing.', 'FEDERAL')
) AS d (url, title, description, domain);

-- Attachments: control, document address, position among the rows this file gives that control.
INSERT INTO "NistControlLink" ("nistControlId", "linkId", "displayOrder")
SELECT v.control_id,
       (SELECT r.id FROM "ReferenceLink" r WHERE r.url = v.url),
       (SELECT COALESCE(MAX(x."displayOrder"), 0) FROM "NistControlLink" x WHERE x."nistControlId" = v.control_id) + v.position
FROM (VALUES
  -- OMB M-26-14, agency logging and network visibility
  ('ctrl_au-04_r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=2', 1),
  ('ctrl_au-06_r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=2', 1),
  ('ctrl_au-06_03__r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=2', 1),
  ('ctrl_si-04_02__r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=2', 1),
  ('ctrl_si-04_16__r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=2', 1),
  ('ctrl_au-02_r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=6', 1),
  ('ctrl_au-03_r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=6', 1),
  ('ctrl_au-06_04__r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=6', 1),
  ('ctrl_au-12_r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=6', 1),
  ('ctrl_si-04_r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=7', 1),
  ('ctrl_si-04_05__r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=7', 1),
  ('ctrl_si-04_12__r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=7', 1),
  ('ctrl_ac-02_12__r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=7', 1),
  ('ctrl_ra-10_r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=7', 1),
  ('ctrl_au-09_r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=8', 1),
  ('ctrl_cm-08_r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=8', 1),
  ('ctrl_cm-08_07__r520', 'https://www.whitehouse.gov/wp-content/uploads/2026/05/M-26-14-Ensuring-Effective-and-Efficient-Agency-Logging-and-Network-Visibility-to-Defend-Against-Evolving-Cyber-Threats.pdf#page=8', 1),
  -- OMB M-22-09, Appendix B task matrix
  ('ctrl_ia-05_01__r520', 'https://www.whitehouse.gov/wp-content/uploads/2022/01/M-22-09.pdf#page=28', 1),
  ('ctrl_sc-08_r520', 'https://www.whitehouse.gov/wp-content/uploads/2022/01/M-22-09.pdf#page=28', 1)
) AS v (control_id, url, position);
