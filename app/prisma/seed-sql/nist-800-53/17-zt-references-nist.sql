-- 17-zt-references-nist.sql
--
-- HAND-MAINTAINED (this file is the source of truth: edit it directly; no generator writes it).
--
-- Zero Trust references from NIST publications, each cited at the page or section that
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
--   4. The link check passes on the address: make check-seed-links SEED_FILES=17-zt-references-nist.sql
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
VALUES ('dsrc_zt-references_nist', 'nist zt references', 'zt-reference-links', NULL, 'reference'::"AuthorityLevel", '2026-10-28'::timestamp, true, 'Zero Trust references from NIST publications, maintained by hand in 17-zt-references-nist.sql and checked with make check-seed-links.', 'system_nist_gov', NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "lastCrawled" = EXCLUDED."lastCrawled", "description" = EXCLUDED."description", "updatedAt" = NOW();

-- Documents: one entry per address.
INSERT INTO "ReferenceLink" ("id", "url", "title", "description", "domain", "linkType", "dataSourceId", "createdAt", "updatedAt")
SELECT 'rlink_' || left(md5(d.url), 16), d.url, d.title, d.description, d.domain::"LinkDomain", 'GUIDANCE'::"ReferenceLinkType", 'dsrc_zt-references_nist', NOW(), NOW()
FROM (VALUES
  -- NIST SP 800-207, Zero Trust Architecture
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=15', 'NIST SP 800-207, Tenets of Zero Trust (p. 6)', 'NIST, SP 800-207, Zero Trust Architecture, August 2020, section 2.1 Tenets of Zero Trust, page 6: every data source and computing service is a resource; all communication is secured regardless of network location; access is granted per session with least privilege; access is set by dynamic policy on subject, asset and environmental attributes.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=16', 'NIST SP 800-207, Tenets of Zero Trust (p. 7)', 'NIST, SP 800-207, Zero Trust Architecture, August 2020, section 2.1 Tenets of Zero Trust, page 7: the enterprise monitors and measures the integrity and security posture of all its assets, enforces authentication and authorization dynamically before access, and collects information on assets, infrastructure and communications to improve its posture.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=18', 'NIST SP 800-207, Logical Components of Zero Trust Architecture (p. 9)', 'NIST, SP 800-207, Zero Trust Architecture, August 2020, section 3 Logical Components of Zero Trust Architecture, page 9: the policy engine decides, and logs, whether to grant, deny or revoke access to a resource; the policy administrator opens or shuts down the communication path by commanding policy enforcement points.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=19', 'NIST SP 800-207, Logical Components of Zero Trust Architecture (p. 10)', 'NIST, SP 800-207, Zero Trust Architecture, August 2020, section 3 Logical Components of Zero Trust Architecture, page 10: the policy enforcement point that enables, monitors and terminates connections, and the data sources that inform the policy engine, among them diagnostics and mitigation systems, threat intelligence and near-real-time activity logs.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=21', 'NIST SP 800-207, ZTA Using Micro-Segmentation (p. 12)', 'NIST, SP 800-207, Zero Trust Architecture, August 2020, section 3.1.2 ZTA Using Micro-Segmentation, page 12: resources placed on their own network segments behind gateway devices or host-based agents and firewalls acting as enforcement points, which reconfigure to respond to threats or workflow changes.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=22', 'NIST SP 800-207, Device Agent/Gateway-Based Deployment (p. 13)', 'NIST, SP 800-207, Zero Trust Architecture, August 2020, section 3.2.1 Device Agent/Gateway-Based Deployment, page 13: an agent on each enterprise asset directs traffic to the enforcement point, and a gateway in front of each resource allows only the communication paths the policy administrator approves.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=29', 'NIST SP 800-207, Trust Algorithm Variations (p. 20)', 'NIST, SP 800-207, Zero Trust Architecture, August 2020, section 3.3.1 Trust Algorithm Variations, page 20: contextual trust algorithms that compare requests with a subject history, so that deviations raise alerts, require stronger authentication or deny the request.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=30', 'NIST SP 800-207, Network/Environment Components (p. 21)', 'NIST, SP 800-207, Zero Trust Architecture, August 2020, section 3.4 Network/Environment Components, page 21: separate control and data plane flows; resources reachable only through an enforcement point and closed to arbitrary incoming connections; all traffic observable; the policy components on a logically separate network.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=38', 'NIST SP 800-207, Visibility on the Network (p. 29)', 'NIST, SP 800-207, Zero Trust Architecture, August 2020, section 5.4 Visibility on the Network, page 29: traffic inspected, logged and analyzed to identify and react to attacks, with encrypted traffic analyzed through its metadata.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=49', 'NIST SP 800-207, Initial Deployment and Monitoring (p. 40)', 'NIST, SP 800-207, Zero Trust Architecture, August 2020, section 7.3.6 Initial Deployment and Monitoring, page 40: an initial deployment in observation mode, comparing connection logs with policy to learn baseline access requests, behavior and communication patterns.', 'NIST'),
  -- NIST SP 800-63-4 and SP 800-63B-4, Digital Identity Guidelines
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63-4.pdf#page=12', 'NIST SP 800-63-4, Scope and Applicability (p. 2)', 'NIST, SP 800-63-4, Digital Identity Guidelines, July 2025, section 1.1 Scope and Applicability, page 2: the guidelines cover online services that need assurance in a digital identity, focus on services used by external users such as the public and partners, and also apply to federal systems used by employees and contractors.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63-4.pdf#page=46', 'NIST SP 800-63-4, Authentication Assurance Level (p. 36)', 'NIST, SP 800-63-4, Digital Identity Guidelines, July 2025, section 3.3.2.2 Authentication Assurance Level, page 36: the three authentication assurance levels, AAL2 requiring two distinct authentication factors and AAL3 a phishing-resistant public-key authenticator, with the control objectives of each level.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=15', 'NIST SP 800-63B-4, Authentication Assurance Levels (p. 4)', 'NIST, SP 800-63B-4, Digital Identity Guidelines: Authentication and Authenticator Management, July 2025, section 2 Authentication Assurance Levels, page 4: authentication at least as strong as the required level, yielding an identifier that uniquely identifies the subscriber, with federal agencies selecting at least AAL2 where personal information is available online.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=17', 'NIST SP 800-63B-4, Authentication Assurance Level 2 (p. 6)', 'NIST, SP 800-63B-4, Digital Identity Guidelines: Authentication and Authenticator Management, July 2025, section 2.2 Authentication Assurance Level 2, page 6: AAL2 requires proof of possession and control of two distinct authentication factors through secure authentication protocols.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=25', 'NIST SP 800-63B-4, Passwords (p. 14)', 'NIST, SP 800-63B-4, Digital Identity Guidelines: Authentication and Authenticator Management, July 2025, section 3.1.1 Passwords, page 14: password verifier requirements, among them a blocklist of common or compromised values, minimum and maximum lengths, no composition rules, and changes on evidence of compromise rather than on a schedule.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=29', 'NIST SP 800-63B-4, Out-of-Band Devices (p. 18)', 'NIST, SP 800-63B-4, Digital Identity Guidelines: Authentication and Authenticator Management, July 2025, section 3.1.3 Out-of-Band Devices, page 18: out-of-band authenticators that prove possession over an independent secondary channel, such as an application or text message, which are not phishing-resistant.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=47', 'NIST SP 800-63B-4, Replay Resistance (p. 36)', 'NIST, SP 800-63B-4, Digital Identity Guidelines: Authentication and Authenticator Management, July 2025, section 3.2.7 Replay Resistance, page 36: replay resistance, which makes it impractical to authenticate by recording and replaying a previous authentication message, and the authenticator types that provide it.', 'NIST'),
  ('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=54', 'NIST SP 800-63B-4, Authenticator Event Management (p. 43)', 'NIST, SP 800-63B-4, Digital Identity Guidelines: Authentication and Authenticator Management, July 2025, section 4 Authenticator Event Management, page 43: the events in an authenticator lifetime, from binding and maintenance to loss, theft, compromise, expiration and revocation, and the record kept of each bound authenticator.', 'NIST')
) AS d (url, title, description, domain);

-- Attachments: control, document address, position among the rows this file gives that control.
INSERT INTO "NistControlLink" ("nistControlId", "linkId", "displayOrder")
SELECT v.control_id,
       (SELECT r.id FROM "ReferenceLink" r WHERE r.url = v.url),
       (SELECT COALESCE(MAX(x."displayOrder"), 0) FROM "NistControlLink" x WHERE x."nistControlId" = v.control_id) + v.position
FROM (VALUES
  -- NIST SP 800-207, Zero Trust Architecture
  ('ctrl_ac-03_r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=18', 1),
  ('ctrl_ac-03_08__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=18', 1),
  ('ctrl_ac-24_r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=18', 1),
  ('ctrl_ac-03_13__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=15', 1),
  ('ctrl_ca-07_r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=16', 1),
  ('ctrl_si-04_02__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=19', 1),
  ('ctrl_si-04_03__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=19', 1),
  ('ctrl_sc-07_r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=21', 1),
  ('ctrl_sc-07_12__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=21', 1),
  ('ctrl_sc-07_20__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=21', 1),
  ('ctrl_sc-07_29__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=21', 1),
  ('ctrl_ac-04_r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=22', 1),
  ('ctrl_si-04_05__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=29', 1),
  ('ctrl_si-04_07__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=29', 1),
  ('ctrl_si-04_12__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=29', 1),
  ('ctrl_ac-04_21__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=30', 1),
  ('ctrl_sc-07_05__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=30', 1),
  ('ctrl_sc-07_11__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=30', 1),
  ('ctrl_sc-07_13__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=30', 1),
  ('ctrl_si-04_25__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=30', 1),
  ('ctrl_si-04_r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=38', 1),
  ('ctrl_si-04_10__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=38', 1),
  ('ctrl_si-04_13__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf#page=49', 1),
  -- NIST SP 800-63-4 and SP 800-63B-4, Digital Identity Guidelines
  ('ctrl_ia-08_r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63-4.pdf#page=12', 1),
  ('ctrl_ia-02_02__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63-4.pdf#page=46', 1),
  ('ctrl_ia-02_r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=15', 1),
  ('ctrl_ia-02_02__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=17', 2),
  ('ctrl_ia-05_01__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=25', 1),
  ('ctrl_ia-02_13__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=29', 1),
  ('ctrl_ia-02_08__r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=47', 1),
  ('ctrl_ia-05_r520', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=54', 1)
) AS v (control_id, url, position);
