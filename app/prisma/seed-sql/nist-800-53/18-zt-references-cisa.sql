-- 18-zt-references-cisa.sql
--
-- HAND-MAINTAINED (this file is the source of truth: edit it directly; no generator writes it).
--
-- Zero Trust references from CISA publications, each cited at the page or section that
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
--   4. The link check passes on the address: make check-seed-links SEED_FILES=18-zt-references-cisa.sql
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
VALUES ('dsrc_zt-references_cisa', 'cisa zt references', 'zt-reference-links', NULL, 'reference'::"AuthorityLevel", '2026-10-28'::timestamp, true, 'Zero Trust references from CISA publications, maintained by hand in 18-zt-references-cisa.sql and checked with make check-seed-links.', 'system_nist_gov', NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "lastCrawled" = EXCLUDED."lastCrawled", "description" = EXCLUDED."description", "updatedAt" = NOW();

-- Documents: one entry per address.
INSERT INTO "ReferenceLink" ("id", "url", "title", "description", "domain", "linkType", "dataSourceId", "createdAt", "updatedAt")
SELECT 'rlink_' || left(md5(d.url), 16), d.url, d.title, d.description, d.domain::"LinkDomain", 'GUIDANCE'::"ReferenceLinkType", 'dsrc_zt-references_cisa', NOW(), NOW()
FROM (VALUES
  -- CISA, Implementing Phishing-Resistant MFA
  ('https://www.cisa.gov/sites/default/files/publications/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf#page=1', 'Implementing Phishing-Resistant MFA, Overview (p. 1)', 'CISA, Implementing Phishing-Resistant MFA, October 2022, Overview, page 1: what multifactor authentication is, the call to use it for all users and all services, phishing-resistant MFA as its most secure form, and the threats to weaker forms.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/publications/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf#page=2', 'Implementing Phishing-Resistant MFA, Recommended Implementations (p. 2)', 'CISA, Implementing Phishing-Resistant MFA, October 2022, Recommended Implementations, page 2: forms of MFA ranked from phishing-resistant FIDO and PKI-based MFA, through one-time passwords and push notifications with number matching, to push without it and text or voice messages.', 'FEDERAL'),
  -- CISA, Encrypted DNS Implementation Guidance
  ('https://www.cisa.gov/sites/default/files/2024-05/Encrypted%20DNS%20Implementation%20Guidance_508c.pdf#page=10', 'Encrypted DNS Implementation Guidance, Encrypted DNS (p. 10)', 'CISA, Encrypted DNS Implementation Guidance, Version 1.0, April 2024, section 3.1 Encrypted DNS, page 10: the encrypted DNS protocols, DNS over HTTPS, TLS and QUIC, that give DNS traffic between clients and servers confidentiality and integrity.', 'FEDERAL'),
  -- CISA, Using SASE in a Modern TIC 3.0 Solution
  ('https://www.cisa.gov/sites/default/files/2026-07/The_Journey_to_Zero_Trust-Using_SAS_in_a_Modern_TIC3.0_Solution.pdf#page=8', 'Using SASE in a Modern TIC 3.0 Solution, Secure Access Service Edge (p. 4)', 'CISA, The Journey to Zero Trust: Using SASE in a Modern TIC 3.0 Solution, June 2026, section 4 Secure Access Service Edge, page 4: the capabilities SASE combines, among them zero trust network access, a secure web gateway and a cloud access security broker, and one control plane for access, visibility and enforcement wherever the user or device is.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2026-07/The_Journey_to_Zero_Trust-Using_SAS_in_a_Modern_TIC3.0_Solution.pdf#page=12', 'Using SASE in a Modern TIC 3.0 Solution, Security Patterns (p. 8)', 'CISA, The Journey to Zero Trust: Using SASE in a Modern TIC 3.0 Solution, June 2026, section 5.3 Security Patterns, page 8: patterns in which campus, branch and remote users reach agency services, the web and cloud providers through the SASE solution, which authenticates, authorizes, enforces and observes that traffic.', 'FEDERAL'),
  -- CISA, Trusted Internet Connections 3.0 core guidance
  ('https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Program_Guidebook_September_2026_47.pdf#page=10', 'TIC 3.0 Program Guidebook, History of TIC (p. 3)', 'CISA, Trusted Internet Connections 3.0 Program Guidebook, Version 1.2, September 2026, section 3 History of TIC, page 3: TIC 1.0 reducing federal external network connections and internet points of presence to 50, and TIC 2.0 standardizing remote and external agency connections.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Reference_Architecture_September_2026_14.pdf#page=16', 'TIC 3.0 Reference Architecture, Evolving from the Traditional Perimeter (p. 13)', 'CISA, Trusted Internet Connections 3.0 Reference Architecture, Version 1.2, September 2026, section 6 Evolving from the Traditional Perimeter Architecture, page 13: the traditional model of internal and external trust zones with one enforcement point at the TIC access point, extended to branch offices, remote workers and cloud by private connections back to the campus.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Security_Capabilities_Catalogs_September_2026_17.pdf#page=9', 'TIC 3.0 Security Capabilities Catalog, Security Objectives (p. 3)', 'CISA, Trusted Internet Connections 3.0 Security Capabilities Catalog, Version 3.3, September 2026, section 3 Security Objectives of TIC 3.0, page 3: the TIC objectives of managing traffic with least privilege and default deny, protecting the confidentiality and integrity of traffic, and ensuring service resiliency and effective response.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Security_Capabilities_Catalogs_September_2026_17.pdf#page=17', 'TIC 3.0 Security Capabilities Catalog, Web Capabilities (p. 11)', 'CISA, Trusted Internet Connections 3.0 Security Capabilities Catalog, Version 3.3, September 2026, section 4.2 Policy Enforcement Point Capabilities, page 11: email and web enforcement capabilities, among them break and inspect, content filtering and authenticated proxies.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Security_Capabilities_Catalogs_September_2026_17.pdf#page=19', 'TIC 3.0 Security Capabilities Catalog, Networking Capabilities (p. 13)', 'CISA, Trusted Internet Connections 3.0 Security Capabilities Catalog, Version 3.3, September 2026, section 4.2 Policy Enforcement Point Capabilities, page 13: networking enforcement capabilities, among them access control, address denylisting, host and resource containment, network segmentation and microsegmentation.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Security_Capabilities_Catalogs_September_2026_17.pdf#page=24', 'TIC 3.0 Security Capabilities Catalog, Data Protection Capabilities (p. 18)', 'CISA, Trusted Internet Connections 3.0 Security Capabilities Catalog, Version 3.3, September 2026, section 4.2 Policy Enforcement Point Capabilities, page 18: data protection and services capabilities, among them data loss prevention, data access telemetry, data labeling and inventory, and protocol compliance enforcement.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Remote_User_Use_Case_September_2026_61.pdf#page=16', 'TIC 3.0 Remote User Use Case, Agency Services Connectivity (p. 10)', 'CISA, Trusted Internet Connections 3.0 Remote User Use Case, Version 2.2, September 2026, section 5.2 Agency Services Connectivity Considerations, page 10: the ways remote users reach agency and cloud services, by direct connection, virtual private network or remote desktop, and what each means for agency control and protections.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Remote_User_Use_Case_September_2026_61.pdf#page=39', 'TIC 3.0 Remote User Use Case, Networking Capabilities (p. 33)', 'CISA, Trusted Internet Connections 3.0 Remote User Use Case, Version 2.2, September 2026, section 7.2.4 Networking PEP Security Capabilities, page 33: remote user guidance on web content filtering and access control, device health checks, multifactor authentication, and firewalls on remote user devices.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Remote_User_Use_Case_September_2026_61.pdf#page=41', 'TIC 3.0 Remote User Use Case, Networking and Resiliency Capabilities (p. 35)', 'CISA, Trusted Internet Connections 3.0 Remote User Use Case, Version 2.2, September 2026, sections 7.2.4 and 7.2.5, page 35: automatically containing remote user devices on risk-based determinations, then denial of service protections and elastic expansion.', 'FEDERAL'),
  -- CISA, Cloud Security Technical Reference Architecture
  ('https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=33', 'Cloud Security Technical Reference Architecture, Public-facing Services (p. 27)', 'CISA, Cloud Security Technical Reference Architecture, Version 2.0, June 2022, section 4.5.4 Public-facing Services, page 27: centralized domains, DNS and certificates for public websites, and web application firewalls, API gateways and content delivery networks that also absorb denial of service traffic.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=40', 'Cloud Security Technical Reference Architecture, Identity, Credential, and Access Management (p. 34)', 'CISA, Cloud Security Technical Reference Architecture, Version 2.0, June 2022, section 5.2.3 Identity, Credential, and Access Management, page 34: posture management tools across the identity life cycle, account activity logs analyzed for anomalous behavior, and phishing-resistant MFA for privileged accounts.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=41', 'Cloud Security Technical Reference Architecture, Data Protection (p. 35)', 'CISA, Cloud Security Technical Reference Architecture, Version 2.0, June 2022, section 5.2.4 Data Protection, page 35: data protection responsibilities shared with the cloud provider across data states, key management, and encryption of data at rest and in transit.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=51', 'Cloud Security Technical Reference Architecture, Access Management (p. 45)', 'CISA, Cloud Security Technical Reference Architecture, Version 2.0, June 2022, section 5.3.4 Identity, Credential, and Access Management, page 45: least privilege within each authentication realm, audits that find over-privileged accounts, and entitlement management that monitors authorizations.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=52', 'Cloud Security Technical Reference Architecture, Visibility and Sensor Placement (p. 46)', 'CISA, Cloud Security Technical Reference Architecture, Version 2.0, June 2022, section 5.3.6 Visibility and Sensor Placement, page 46: sensors placed to monitor and control inbound, outbound and service-to-service traffic, with alerts on unauthorized or suspicious traffic.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=55', 'Cloud Security Technical Reference Architecture, Cloud-Native Authentication and Authorization (p. 49)', 'CISA, Cloud Security Technical Reference Architecture, Version 2.0, June 2022, section 5.3.8 Application Programming Interfaces, page 49: API gateways, service mesh proxies that enforce security policy at runtime and encrypt service traffic, and attribute-based access control.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=56', 'Cloud Security Technical Reference Architecture, Telemetry and Logs (p. 50)', 'CISA, Cloud Security Technical Reference Architecture, Version 2.0, June 2022, section 5.3.9 Telemetry and Logs, page 50: knowing which logs a cloud service provides and how they are delivered and stored, confirming the necessary data is logged and retained, and keeping log volume within ingestion capacity.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=57', 'Cloud Security Technical Reference Architecture, Telemetry and Logs (p. 51)', 'CISA, Cloud Security Technical Reference Architecture, Version 2.0, June 2022, section 5.3.9 Telemetry and Logs, page 51: monitoring identity, access policy and API activity logs for anomalies, synchronized clocks so logs correlate, and logs consolidated centrally across accounts, regions and providers.', 'FEDERAL'),
  ('https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=60', 'Cloud Security Technical Reference Architecture, Key Management (p. 54)', 'CISA, Cloud Security Technical Reference Architecture, Version 2.0, June 2022, section 5.3.10 Deployment, Automation, and Orchestration, page 54: provider or third-party key management, separation of duties over encrypted content, keys, policies and monitoring, and periodic rotation of keys and secrets.', 'FEDERAL'),
  -- CISA, SCuBA secure configuration baselines (BOD 25-01)
  ('https://github.com/cisagov/ScubaGear/blob/v2.0.0/PowerShell/ScubaGear/baselines/aad.md#baseline-policies', 'SCuBA Microsoft Entra ID baseline, ScubaGear v2.0.0, Baseline Policies', 'CISA, M365 Secure Configuration Baseline for Microsoft Entra ID, ScubaGear release v2.0.0, section Baseline Policies: the secure configuration policies for Entra ID, from legacy authentication and strong authentication to privileged and guest user access.', 'EXTERNAL'),
  ('https://github.com/cisagov/ScubaGear/blob/v2.0.0/PowerShell/ScubaGear/baselines/aad.md#1-legacy-authentication', 'SCuBA Microsoft Entra ID baseline, ScubaGear v2.0.0, Legacy Authentication', 'CISA, M365 Secure Configuration Baseline for Microsoft Entra ID, ScubaGear release v2.0.0, section 1 Legacy Authentication: blocking legacy authentication protocols, which do not support multifactor authentication.', 'EXTERNAL'),
  ('https://github.com/cisagov/ScubaGoggles/blob/v1.1.0/scubagoggles/baselines/commoncontrols.md#baseline-policies', 'SCuBA Google Workspace Common Controls baseline, ScubaGoggles v1.1.0, Baseline Policies', 'CISA, Google Workspace Secure Configuration Baseline for Common Controls, ScubaGoggles release v1.1.0, section Baseline Policies: the tenant-wide secure configuration policies for the Google Workspace admin console, from phishing-resistant MFA and sessions to app access, logs and data loss prevention.', 'EXTERNAL'),
  ('https://github.com/cisagov/ScubaGoggles/blob/v1.1.0/scubagoggles/baselines/commoncontrols.md#11-authorized-google-marketplace-apps', 'SCuBA Google Workspace Common Controls baseline, ScubaGoggles v1.1.0, Authorized Google Marketplace Apps', 'CISA, Google Workspace Secure Configuration Baseline for Common Controls, ScubaGoggles release v1.1.0, section 11 Authorized Google Marketplace Apps: installing only the Marketplace applications an administrator has allowed.', 'EXTERNAL')
) AS d (url, title, description, domain);

-- Attachments: control, document address, position among the rows this file gives that control.
INSERT INTO "NistControlLink" ("nistControlId", "linkId", "displayOrder")
SELECT v.control_id,
       (SELECT r.id FROM "ReferenceLink" r WHERE r.url = v.url),
       (SELECT COALESCE(MAX(x."displayOrder"), 0) FROM "NistControlLink" x WHERE x."nistControlId" = v.control_id) + v.position
FROM (VALUES
  -- CISA, Implementing Phishing-Resistant MFA
  ('ctrl_ia-02_r520', 'https://www.cisa.gov/sites/default/files/publications/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf#page=1', 1),
  ('ctrl_ia-02_02__r520', 'https://www.cisa.gov/sites/default/files/publications/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf#page=1', 1),
  ('ctrl_ia-02_13__r520', 'https://www.cisa.gov/sites/default/files/publications/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf#page=2', 1),
  -- CISA, Encrypted DNS Implementation Guidance
  ('ctrl_sc-08_r520', 'https://www.cisa.gov/sites/default/files/2024-05/Encrypted%20DNS%20Implementation%20Guidance_508c.pdf#page=10', 1),
  -- CISA, Microsegmentation in Zero Trust, Part One
  ('ctrl_ac-04_21__r520', 'https://www.cisa.gov/sites/default/files/2025-07/ZT-Microsegmentation-Guidance-Part-One_508c.pdf#page=13', 1),
  -- CISA, Using SASE in a Modern TIC 3.0 Solution
  ('ctrl_ac-17_01__r520', 'https://www.cisa.gov/sites/default/files/2026-07/The_Journey_to_Zero_Trust-Using_SAS_in_a_Modern_TIC3.0_Solution.pdf#page=8', 1),
  ('ctrl_sc-07_r520', 'https://www.cisa.gov/sites/default/files/2026-07/The_Journey_to_Zero_Trust-Using_SAS_in_a_Modern_TIC3.0_Solution.pdf#page=12', 1),
  ('ctrl_ac-17_03__r520', 'https://www.cisa.gov/sites/default/files/2026-07/The_Journey_to_Zero_Trust-Using_SAS_in_a_Modern_TIC3.0_Solution.pdf#page=12', 1),
  -- CISA, Trusted Internet Connections 3.0 core guidance
  ('ctrl_sc-07_03__r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Program_Guidebook_September_2026_47.pdf#page=10', 1),
  ('ctrl_sc-07_r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Reference_Architecture_September_2026_14.pdf#page=16', 2),
  ('ctrl_sc-07_05__r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Security_Capabilities_Catalogs_September_2026_17.pdf#page=9', 1),
  ('ctrl_sc-08_r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Security_Capabilities_Catalogs_September_2026_17.pdf#page=9', 2),
  ('ctrl_sc-07_08__r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Security_Capabilities_Catalogs_September_2026_17.pdf#page=17', 1),
  ('ctrl_sc-07_11__r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Security_Capabilities_Catalogs_September_2026_17.pdf#page=19', 1),
  ('ctrl_sc-07_29__r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Security_Capabilities_Catalogs_September_2026_17.pdf#page=19', 1),
  ('ctrl_sc-07_10__r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Security_Capabilities_Catalogs_September_2026_17.pdf#page=24', 1),
  ('ctrl_ac-17_r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Remote_User_Use_Case_September_2026_61.pdf#page=16', 1),
  ('ctrl_sc-07_12__r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Remote_User_Use_Case_September_2026_61.pdf#page=39', 1),
  ('ctrl_sc-07_20__r520', 'https://www.cisa.gov/sites/default/files/2026-09/TIC_3.0_Remote_User_Use_Case_September_2026_61.pdf#page=41', 1),
  -- CISA, Cloud Security Technical Reference Architecture
  ('ctrl_sc-05_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=33', 1),
  ('ctrl_ac-02_12__r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=40', 1),
  ('ctrl_sc-08_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=41', 3),
  ('ctrl_sc-08_01__r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=41', 1),
  ('ctrl_sc-28_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=41', 1),
  ('ctrl_sc-28_01__r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=41', 1),
  ('ctrl_ac-06_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=51', 1),
  ('ctrl_ac-06_07__r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=51', 1),
  ('ctrl_sc-07_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=52', 3),
  ('ctrl_ac-03_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=55', 1),
  ('ctrl_ac-03_13__r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=55', 1),
  ('ctrl_au-02_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=56', 1),
  ('ctrl_au-04_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=56', 1),
  ('ctrl_au-06_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=57', 1),
  ('ctrl_au-06_03__r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=57', 1),
  ('ctrl_au-06_04__r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=57', 1),
  ('ctrl_sc-45_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=57', 1),
  ('ctrl_sc-12_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=60', 1),
  ('ctrl_ac-05_r520', 'https://www.cisa.gov/sites/default/files/2023-05/Cloud%20Security%20Technical%20Reference%20Architecture%20v2.pdf#page=60', 1),
  -- CISA, SCuBA secure configuration baselines (BOD 25-01)
  ('ctrl_cm-06_r520', 'https://github.com/cisagov/ScubaGear/blob/v2.0.0/PowerShell/ScubaGear/baselines/aad.md#baseline-policies', 1),
  ('ctrl_cm-07_r520', 'https://github.com/cisagov/ScubaGear/blob/v2.0.0/PowerShell/ScubaGear/baselines/aad.md#1-legacy-authentication', 1),
  ('ctrl_cm-06_r520', 'https://github.com/cisagov/ScubaGoggles/blob/v1.1.0/scubagoggles/baselines/commoncontrols.md#baseline-policies', 2),
  ('ctrl_cm-07_r520', 'https://github.com/cisagov/ScubaGoggles/blob/v1.1.0/scubagoggles/baselines/commoncontrols.md#11-authorized-google-marketplace-apps', 2)
) AS v (control_id, url, position);
