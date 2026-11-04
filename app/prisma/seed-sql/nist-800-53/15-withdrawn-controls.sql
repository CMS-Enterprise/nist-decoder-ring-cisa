-- 15-withdrawn-controls.sql
-- Source: NIST_SP-800-53_rev5_catalog-min.json (fallback, verified) blob 81c55f5c652bf2c6ccd5de0afe3ebe4618c6af91 @ oscal-content 78650f02ad93
-- 182 withdrawn controls, 158 of them enhancements

INSERT INTO "NistControl" ("id", "controlNumber", "controlName", "discussion", "oscalId", "sortId", "baselineLabels", "relatedControls", "status", "controlFamilyId", "nistVersionId", "createdById", "updatedById", "createdAt", "updatedAt")
VALUES
  ('ctrl_ac-02_10__r520', 'AC-02(10)', 'Shared and Group Account Credential Change', NULL, 'ac-2.10', 'ac-02.10', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-03_01__r520', 'AC-03(01)', 'Restricted Access to Privileged Functions', NULL, 'ac-3.1', 'ac-03.01', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-03_06__r520', 'AC-03(06)', 'Protection of User and System Information', NULL, 'ac-3.6', 'ac-03.06', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-04_16__r520', 'AC-04(16)', 'Information Transfers on Interconnected Systems', NULL, 'ac-4.16', 'ac-04.16', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-04_18__r520', 'AC-04(18)', 'Security Attribute Binding', NULL, 'ac-4.18', 'ac-04.18', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-07_01__r520', 'AC-07(01)', 'Automatic Account Lock', NULL, 'ac-7.1', 'ac-07.01', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-13_r520', 'AC-13', 'Supervision and Review — Access Control', NULL, 'ac-13', 'ac-13', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-14_01__r520', 'AC-14(01)', 'Necessary Uses', NULL, 'ac-14.1', 'ac-14.01', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-15_r520', 'AC-15', 'Automated Marking', NULL, 'ac-15', 'ac-15', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-17_05__r520', 'AC-17(05)', 'Monitoring for Unauthorized Connections', NULL, 'ac-17.5', 'ac-17.05', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-17_07__r520', 'AC-17(07)', 'Additional Protection for Security Function Access', NULL, 'ac-17.7', 'ac-17.07', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-17_08__r520', 'AC-17(08)', 'Disable Nonsecure Network Protocols', NULL, 'ac-17.8', 'ac-17.08', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-18_02__r520', 'AC-18(02)', 'Monitoring Unauthorized Connections', NULL, 'ac-18.2', 'ac-18.02', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-19_01__r520', 'AC-19(01)', 'Use of Writable and Portable Storage Devices', NULL, 'ac-19.1', 'ac-19.01', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-19_02__r520', 'AC-19(02)', 'Use of Personally Owned Portable Storage Devices', NULL, 'ac-19.2', 'ac-19.02', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ac-19_03__r520', 'AC-19(03)', 'Use of Portable Storage Devices with No Identifiable Owner', NULL, 'ac-19.3', 'ac-19.03', '{}', '{}', 'WITHDRAWN', 'AC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_at-03_04__r520', 'AT-03(04)', 'Suspicious Communications and Anomalous System Behavior', NULL, 'at-3.4', 'at-03.04', '{}', '{}', 'WITHDRAWN', 'AT', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_at-05_r520', 'AT-05', 'Contacts with Security Groups and Associations', NULL, 'at-5', 'at-05', '{}', '{}', 'WITHDRAWN', 'AT', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-02_01__r520', 'AU-02(01)', 'Compilation of Audit Records from Multiple Sources', NULL, 'au-2.1', 'au-02.01', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-02_02__r520', 'AU-02(02)', 'Selection of Audit Events by Component', NULL, 'au-2.2', 'au-02.02', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-02_03__r520', 'AU-02(03)', 'Reviews and Updates', NULL, 'au-2.3', 'au-02.03', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-02_04__r520', 'AU-02(04)', 'Privileged Functions', NULL, 'au-2.4', 'au-02.04', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-03_02__r520', 'AU-03(02)', 'Centralized Management of Planned Audit Record Content', NULL, 'au-3.2', 'au-03.02', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-06_02__r520', 'AU-06(02)', 'Automated Security Alerts', NULL, 'au-6.2', 'au-06.02', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-06_10__r520', 'AU-06(10)', 'Audit Level Adjustment', NULL, 'au-6.10', 'au-06.10', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-07_02__r520', 'AU-07(02)', 'Automatic Sort and Search', NULL, 'au-7.2', 'au-07.02', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-08_01__r520', 'AU-08(01)', 'Synchronization with Authoritative Time Source', NULL, 'au-8.1', 'au-08.01', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-08_02__r520', 'AU-08(02)', 'Secondary Authoritative Time Source', NULL, 'au-8.2', 'au-08.02', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-10_05__r520', 'AU-10(05)', 'Digital Signatures', NULL, 'au-10.5', 'au-10.05', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-14_02__r520', 'AU-14(02)', 'Capture and Record Content', NULL, 'au-14.2', 'au-14.02', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_au-15_r520', 'AU-15', 'Alternate Audit Logging Capability', NULL, 'au-15', 'au-15', '{}', '{}', 'WITHDRAWN', 'AU', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ca-03_01__r520', 'CA-03(01)', 'Unclassified National Security System Connections', NULL, 'ca-3.1', 'ca-03.01', '{}', '{}', 'WITHDRAWN', 'CA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ca-03_02__r520', 'CA-03(02)', 'Classified National Security System Connections', NULL, 'ca-3.2', 'ca-03.02', '{}', '{}', 'WITHDRAWN', 'CA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ca-03_03__r520', 'CA-03(03)', 'Unclassified Non-national Security System Connections', NULL, 'ca-3.3', 'ca-03.03', '{}', '{}', 'WITHDRAWN', 'CA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ca-03_04__r520', 'CA-03(04)', 'Connections to Public Networks', NULL, 'ca-3.4', 'ca-03.04', '{}', '{}', 'WITHDRAWN', 'CA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ca-03_05__r520', 'CA-03(05)', 'Restrictions on External System Connections', NULL, 'ca-3.5', 'ca-03.05', '{}', '{}', 'WITHDRAWN', 'CA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ca-04_r520', 'CA-04', 'Security Certification', NULL, 'ca-4', 'ca-04', '{}', '{}', 'WITHDRAWN', 'CA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ca-07_02__r520', 'CA-07(02)', 'Types of Assessments', NULL, 'ca-7.2', 'ca-07.02', '{}', '{}', 'WITHDRAWN', 'CA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cm-02_01__r520', 'CM-02(01)', 'Reviews and Updates', NULL, 'cm-2.1', 'cm-02.01', '{}', '{}', 'WITHDRAWN', 'CM', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cm-02_04__r520', 'CM-02(04)', 'Unauthorized Software', NULL, 'cm-2.4', 'cm-02.04', '{}', '{}', 'WITHDRAWN', 'CM', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cm-02_05__r520', 'CM-02(05)', 'Authorized Software', NULL, 'cm-2.5', 'cm-02.05', '{}', '{}', 'WITHDRAWN', 'CM', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cm-05_02__r520', 'CM-05(02)', 'Review System Changes', NULL, 'cm-5.2', 'cm-05.02', '{}', '{}', 'WITHDRAWN', 'CM', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cm-05_03__r520', 'CM-05(03)', 'Signed Components', NULL, 'cm-5.3', 'cm-05.03', '{}', '{}', 'WITHDRAWN', 'CM', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cm-05_07__r520', 'CM-05(07)', 'Automatic Implementation of Security Safeguards', NULL, 'cm-5.7', 'cm-05.07', '{}', '{}', 'WITHDRAWN', 'CM', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cm-06_03__r520', 'CM-06(03)', 'Unauthorized Change Detection', NULL, 'cm-6.3', 'cm-06.03', '{}', '{}', 'WITHDRAWN', 'CM', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cm-06_04__r520', 'CM-06(04)', 'Conformance Demonstration', NULL, 'cm-6.4', 'cm-06.04', '{}', '{}', 'WITHDRAWN', 'CM', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cm-08_05__r520', 'CM-08(05)', 'No Duplicate Accounting of Components', NULL, 'cm-8.5', 'cm-08.05', '{}', '{}', 'WITHDRAWN', 'CM', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cm-11_01__r520', 'CM-11(01)', 'Alerts for Unauthorized Installations', NULL, 'cm-11.1', 'cm-11.01', '{}', '{}', 'WITHDRAWN', 'CM', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cp-02_04__r520', 'CP-02(04)', 'Resume All Mission and Business Functions', NULL, 'cp-2.4', 'cp-02.04', '{}', '{}', 'WITHDRAWN', 'CP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cp-05_r520', 'CP-05', 'Contingency Plan Update', NULL, 'cp-5', 'cp-05', '{}', '{}', 'WITHDRAWN', 'CP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cp-07_05__r520', 'CP-07(05)', 'Equivalent Information Security Safeguards', NULL, 'cp-7.5', 'cp-07.05', '{}', '{}', 'WITHDRAWN', 'CP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cp-09_04__r520', 'CP-09(04)', 'Protection from Unauthorized Modification', NULL, 'cp-9.4', 'cp-09.04', '{}', '{}', 'WITHDRAWN', 'CP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cp-10_01__r520', 'CP-10(01)', 'Contingency Plan Testing', NULL, 'cp-10.1', 'cp-10.01', '{}', '{}', 'WITHDRAWN', 'CP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cp-10_03__r520', 'CP-10(03)', 'Compensating Security Controls', NULL, 'cp-10.3', 'cp-10.03', '{}', '{}', 'WITHDRAWN', 'CP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_cp-10_05__r520', 'CP-10(05)', 'Failover Capability', NULL, 'cp-10.5', 'cp-10.05', '{}', '{}', 'WITHDRAWN', 'CP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-02_03__r520', 'IA-02(03)', 'Local Access to Privileged Accounts', NULL, 'ia-2.3', 'ia-02.03', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-02_04__r520', 'IA-02(04)', 'Local Access to Non-privileged Accounts', NULL, 'ia-2.4', 'ia-02.04', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-02_07__r520', 'IA-02(07)', 'Network Access to Non-privileged Accounts — Separate Device', NULL, 'ia-2.7', 'ia-02.07', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-02_09__r520', 'IA-02(09)', 'Network Access to Non-privileged Accounts — Replay Resistant', NULL, 'ia-2.9', 'ia-02.09', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-02_11__r520', 'IA-02(11)', 'Remote Access — Separate Device', NULL, 'ia-2.11', 'ia-02.11', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-03_02__r520', 'IA-03(02)', 'Cryptographic Bidirectional Network Authentication', NULL, 'ia-3.2', 'ia-03.02', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-04_02__r520', 'IA-04(02)', 'Supervisor Authorization', NULL, 'ia-4.2', 'ia-04.02', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-04_03__r520', 'IA-04(03)', 'Multiple Forms of Certification', NULL, 'ia-4.3', 'ia-04.03', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-04_07__r520', 'IA-04(07)', 'In-person Registration', NULL, 'ia-4.7', 'ia-04.07', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-05_03__r520', 'IA-05(03)', 'In-person or Trusted External Party Registration', NULL, 'ia-5.3', 'ia-05.03', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-05_04__r520', 'IA-05(04)', 'Automated Support for Password Strength Determination', NULL, 'ia-5.4', 'ia-05.04', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-05_11__r520', 'IA-05(11)', 'Hardware Token-based Authentication', NULL, 'ia-5.11', 'ia-05.11', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-08_03__r520', 'IA-08(03)', 'Use of FICAM-approved Products', NULL, 'ia-8.3', 'ia-08.03', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-09_01__r520', 'IA-09(01)', 'Information Exchange', NULL, 'ia-9.1', 'ia-09.01', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ia-09_02__r520', 'IA-09(02)', 'Transmission of Decisions', NULL, 'ia-9.2', 'ia-09.02', '{}', '{}', 'WITHDRAWN', 'IA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ir-09_01__r520', 'IR-09(01)', 'Responsible Personnel', NULL, 'ir-9.1', 'ir-09.01', '{}', '{}', 'WITHDRAWN', 'IR', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ir-10_r520', 'IR-10', 'Integrated Information Security Analysis Team', NULL, 'ir-10', 'ir-10', '{}', '{}', 'WITHDRAWN', 'IR', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ma-02_01__r520', 'MA-02(01)', 'Record Content', NULL, 'ma-2.1', 'ma-02.01', '{}', '{}', 'WITHDRAWN', 'MA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ma-04_02__r520', 'MA-04(02)', 'Document Nonlocal Maintenance', NULL, 'ma-4.2', 'ma-04.02', '{}', '{}', 'WITHDRAWN', 'MA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_mp-02_01__r520', 'MP-02(01)', 'Automated Restricted Access', NULL, 'mp-2.1', 'mp-02.01', '{}', '{}', 'WITHDRAWN', 'MP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_mp-02_02__r520', 'MP-02(02)', 'Cryptographic Protection', NULL, 'mp-2.2', 'mp-02.02', '{}', '{}', 'WITHDRAWN', 'MP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_mp-04_01__r520', 'MP-04(01)', 'Cryptographic Protection', NULL, 'mp-4.1', 'mp-04.01', '{}', '{}', 'WITHDRAWN', 'MP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_mp-05_01__r520', 'MP-05(01)', 'Protection Outside of Controlled Areas', NULL, 'mp-5.1', 'mp-05.01', '{}', '{}', 'WITHDRAWN', 'MP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_mp-05_02__r520', 'MP-05(02)', 'Documentation of Activities', NULL, 'mp-5.2', 'mp-05.02', '{}', '{}', 'WITHDRAWN', 'MP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_mp-05_04__r520', 'MP-05(04)', 'Cryptographic Protection', NULL, 'mp-5.4', 'mp-05.04', '{}', '{}', 'WITHDRAWN', 'MP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_mp-06_04__r520', 'MP-06(04)', 'Controlled Unclassified Information', NULL, 'mp-6.4', 'mp-06.04', '{}', '{}', 'WITHDRAWN', 'MP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_mp-06_05__r520', 'MP-06(05)', 'Classified Information', NULL, 'mp-6.5', 'mp-06.05', '{}', '{}', 'WITHDRAWN', 'MP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_mp-06_06__r520', 'MP-06(06)', 'Media Destruction', NULL, 'mp-6.6', 'mp-06.06', '{}', '{}', 'WITHDRAWN', 'MP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_mp-07_01__r520', 'MP-07(01)', 'Prohibit Use Without Owner', NULL, 'mp-7.1', 'mp-07.01', '{}', '{}', 'WITHDRAWN', 'MP', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pe-03_06__r520', 'PE-03(06)', 'Facility Penetration Testing', NULL, 'pe-3.6', 'pe-03.06', '{}', '{}', 'WITHDRAWN', 'PE', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pe-05_01__r520', 'PE-05(01)', 'Access to Output by Authorized Individuals', NULL, 'pe-5.1', 'pe-05.01', '{}', '{}', 'WITHDRAWN', 'PE', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pe-05_03__r520', 'PE-05(03)', 'Marking Output Devices', NULL, 'pe-5.3', 'pe-05.03', '{}', '{}', 'WITHDRAWN', 'PE', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pe-07_r520', 'PE-07', 'Visitor Control', NULL, 'pe-7', 'pe-07', '{}', '{}', 'WITHDRAWN', 'PE', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pe-08_02__r520', 'PE-08(02)', 'Physical Access Records', NULL, 'pe-8.2', 'pe-08.02', '{}', '{}', 'WITHDRAWN', 'PE', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pe-10_01__r520', 'PE-10(01)', 'Accidental and Unauthorized Activation', NULL, 'pe-10.1', 'pe-10.01', '{}', '{}', 'WITHDRAWN', 'PE', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pe-13_03__r520', 'PE-13(03)', 'Automatic Fire Suppression', NULL, 'pe-13.3', 'pe-13.03', '{}', '{}', 'WITHDRAWN', 'PE', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pe-18_01__r520', 'PE-18(01)', 'Facility Site', NULL, 'pe-18.1', 'pe-18.01', '{}', '{}', 'WITHDRAWN', 'PE', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pl-02_01__r520', 'PL-02(01)', 'Concept of Operations', NULL, 'pl-2.1', 'pl-02.01', '{}', '{}', 'WITHDRAWN', 'PL', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pl-02_02__r520', 'PL-02(02)', 'Functional Architecture', NULL, 'pl-2.2', 'pl-02.02', '{}', '{}', 'WITHDRAWN', 'PL', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pl-02_03__r520', 'PL-02(03)', 'Plan and Coordinate with Other Organizational Entities', NULL, 'pl-2.3', 'pl-02.03', '{}', '{}', 'WITHDRAWN', 'PL', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pl-03_r520', 'PL-03', 'System Security Plan Update', NULL, 'pl-3', 'pl-03', '{}', '{}', 'WITHDRAWN', 'PL', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pl-05_r520', 'PL-05', 'Privacy Impact Assessment', NULL, 'pl-5', 'pl-05', '{}', '{}', 'WITHDRAWN', 'PL', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_pl-06_r520', 'PL-06', 'Security-related Activity Planning', NULL, 'pl-6', 'pl-06', '{}', '{}', 'WITHDRAWN', 'PL', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ps-06_01__r520', 'PS-06(01)', 'Information Requiring Special Protection', NULL, 'ps-6.1', 'ps-06.01', '{}', '{}', 'WITHDRAWN', 'PS', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ra-04_r520', 'RA-04', 'Risk Assessment Update', NULL, 'ra-4', 'ra-04', '{}', '{}', 'WITHDRAWN', 'RA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ra-05_01__r520', 'RA-05(01)', 'Update Tool Capability', NULL, 'ra-5.1', 'ra-05.01', '{}', '{}', 'WITHDRAWN', 'RA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ra-05_07__r520', 'RA-05(07)', 'Automated Detection and Notification of Unauthorized Components', NULL, 'ra-5.7', 'ra-05.07', '{}', '{}', 'WITHDRAWN', 'RA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_ra-05_09__r520', 'RA-05(09)', 'Penetration Testing and Analyses', NULL, 'ra-5.9', 'ra-05.09', '{}', '{}', 'WITHDRAWN', 'RA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-04_04__r520', 'SA-04(04)', 'Assignment of Components to Systems', NULL, 'sa-4.4', 'sa-04.04', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-05_01__r520', 'SA-05(01)', 'Functional Properties of Security Controls', NULL, 'sa-5.1', 'sa-05.01', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-05_02__r520', 'SA-05(02)', 'Security-relevant External System Interfaces', NULL, 'sa-5.2', 'sa-05.02', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-05_03__r520', 'SA-05(03)', 'High-level Design', NULL, 'sa-5.3', 'sa-05.03', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-05_04__r520', 'SA-05(04)', 'Low-level Design', NULL, 'sa-5.4', 'sa-05.04', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-05_05__r520', 'SA-05(05)', 'Source Code', NULL, 'sa-5.5', 'sa-05.05', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-06_r520', 'SA-06', 'Software Usage Restrictions', NULL, 'sa-6', 'sa-06', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-07_r520', 'SA-07', 'User-installed Software', NULL, 'sa-7', 'sa-07', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_r520', 'SA-12', 'Supply Chain Protection', NULL, 'sa-12', 'sa-12', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_01__r520', 'SA-12(01)', 'Acquisition Strategies / Tools / Methods', NULL, 'sa-12.1', 'sa-12.01', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_02__r520', 'SA-12(02)', 'Supplier Reviews', NULL, 'sa-12.2', 'sa-12.02', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_03__r520', 'SA-12(03)', 'Trusted Shipping and Warehousing', NULL, 'sa-12.3', 'sa-12.03', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_04__r520', 'SA-12(04)', 'Diversity of Suppliers', NULL, 'sa-12.4', 'sa-12.04', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_05__r520', 'SA-12(05)', 'Limitation of Harm', NULL, 'sa-12.5', 'sa-12.05', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_06__r520', 'SA-12(06)', 'Minimizing Procurement Time', NULL, 'sa-12.6', 'sa-12.06', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_07__r520', 'SA-12(07)', 'Assessments Prior to Selection / Acceptance / Update', NULL, 'sa-12.7', 'sa-12.07', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_08__r520', 'SA-12(08)', 'Use of All-source Intelligence', NULL, 'sa-12.8', 'sa-12.08', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_09__r520', 'SA-12(09)', 'Operations Security', NULL, 'sa-12.9', 'sa-12.09', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_10__r520', 'SA-12(10)', 'Validate as Genuine and Not Altered', NULL, 'sa-12.10', 'sa-12.10', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_11__r520', 'SA-12(11)', 'Penetration Testing / Analysis of Elements, Processes, and Actors', NULL, 'sa-12.11', 'sa-12.11', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_12__r520', 'SA-12(12)', 'Inter-organizational Agreements', NULL, 'sa-12.12', 'sa-12.12', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_13__r520', 'SA-12(13)', 'Critical Information System Components', NULL, 'sa-12.13', 'sa-12.13', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_14__r520', 'SA-12(14)', 'Identity and Traceability', NULL, 'sa-12.14', 'sa-12.14', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-12_15__r520', 'SA-12(15)', 'Processes to Address Weaknesses or Deficiencies', NULL, 'sa-12.15', 'sa-12.15', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-13_r520', 'SA-13', 'Trustworthiness', NULL, 'sa-13', 'sa-13', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-14_r520', 'SA-14', 'Criticality Analysis', NULL, 'sa-14', 'sa-14', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-14_01__r520', 'SA-14(01)', 'Critical Components with No Viable Alternative Sourcing', NULL, 'sa-14.1', 'sa-14.01', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-15_04__r520', 'SA-15(04)', 'Threat Modeling and Vulnerability Analysis', NULL, 'sa-15.4', 'sa-15.04', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-15_09__r520', 'SA-15(09)', 'Use of Live Data', NULL, 'sa-15.9', 'sa-15.09', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-18_r520', 'SA-18', 'Tamper Resistance and Detection', NULL, 'sa-18', 'sa-18', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-18_01__r520', 'SA-18(01)', 'Multiple Phases of System Development Life Cycle', NULL, 'sa-18.1', 'sa-18.01', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-18_02__r520', 'SA-18(02)', 'Inspection of Systems or Components', NULL, 'sa-18.2', 'sa-18.02', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-19_r520', 'SA-19', 'Component Authenticity', NULL, 'sa-19', 'sa-19', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-19_01__r520', 'SA-19(01)', 'Anti-counterfeit Training', NULL, 'sa-19.1', 'sa-19.01', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-19_02__r520', 'SA-19(02)', 'Configuration Control for Component Service and Repair', NULL, 'sa-19.2', 'sa-19.02', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-19_03__r520', 'SA-19(03)', 'Component Disposal', NULL, 'sa-19.3', 'sa-19.03', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-19_04__r520', 'SA-19(04)', 'Anti-counterfeit Scanning', NULL, 'sa-19.4', 'sa-19.04', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-21_01__r520', 'SA-21(01)', 'Validation of Screening', NULL, 'sa-21.1', 'sa-21.01', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sa-22_01__r520', 'SA-22(01)', 'Alternative Sources for Continued Support', NULL, 'sa-22.1', 'sa-22.01', '{}', '{}', 'WITHDRAWN', 'SA', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-04_01__r520', 'SC-04(01)', 'Security Levels', NULL, 'sc-4.1', 'sc-04.01', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-07_01__r520', 'SC-07(01)', 'Physically Separated Subnetworks', NULL, 'sc-7.1', 'sc-07.01', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-07_02__r520', 'SC-07(02)', 'Public Access', NULL, 'sc-7.2', 'sc-07.02', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-07_06__r520', 'SC-07(06)', 'Response to Recognized Failures', NULL, 'sc-7.6', 'sc-07.06', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-09_r520', 'SC-09', 'Transmission Confidentiality', NULL, 'sc-9', 'sc-09', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-12_04__r520', 'SC-12(04)', 'PKI Certificates', NULL, 'sc-12.4', 'sc-12.04', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-12_05__r520', 'SC-12(05)', 'PKI Certificates / Hardware Tokens', NULL, 'sc-12.5', 'sc-12.05', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-13_01__r520', 'SC-13(01)', 'FIPS-validated Cryptography', NULL, 'sc-13.1', 'sc-13.01', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-13_02__r520', 'SC-13(02)', 'NSA-approved Cryptography', NULL, 'sc-13.2', 'sc-13.02', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-13_03__r520', 'SC-13(03)', 'Individuals Without Formal Access Approvals', NULL, 'sc-13.3', 'sc-13.03', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-13_04__r520', 'SC-13(04)', 'Digital Signatures', NULL, 'sc-13.4', 'sc-13.04', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-14_r520', 'SC-14', 'Public Access Protections', NULL, 'sc-14', 'sc-14', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-15_02__r520', 'SC-15(02)', 'Blocking Inbound and Outbound Communications Traffic', NULL, 'sc-15.2', 'sc-15.02', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-19_r520', 'SC-19', 'Voice Over Internet Protocol', NULL, 'sc-19', 'sc-19', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-20_01__r520', 'SC-20(01)', 'Child Subspaces', NULL, 'sc-20.1', 'sc-20.01', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-21_01__r520', 'SC-21(01)', 'Data Origin and Integrity', NULL, 'sc-21.1', 'sc-21.01', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-23_02__r520', 'SC-23(02)', 'User-initiated Logouts and Message Displays', NULL, 'sc-23.2', 'sc-23.02', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-23_04__r520', 'SC-23(04)', 'Unique Session Identifiers with Randomization', NULL, 'sc-23.4', 'sc-23.04', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-26_01__r520', 'SC-26(01)', 'Detection of Malicious Code', NULL, 'sc-26.1', 'sc-26.01', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-30_01__r520', 'SC-30(01)', 'Virtualization Techniques', NULL, 'sc-30.1', 'sc-30.01', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-33_r520', 'SC-33', 'Transmission Preparation Integrity', NULL, 'sc-33', 'sc-33', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-34_03__r520', 'SC-34(03)', 'Hardware-based Protection', NULL, 'sc-34.3', 'sc-34.03', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_sc-42_03__r520', 'SC-42(03)', 'Prohibit Use of Devices', NULL, 'sc-42.3', 'sc-42.03', '{}', '{}', 'WITHDRAWN', 'SC', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-02_01__r520', 'SI-02(01)', 'Central Management', NULL, 'si-2.1', 'si-02.01', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-03_01__r520', 'SI-03(01)', 'Central Management', NULL, 'si-3.1', 'si-03.01', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-03_02__r520', 'SI-03(02)', 'Automatic Updates', NULL, 'si-3.2', 'si-03.02', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-03_03__r520', 'SI-03(03)', 'Non-privileged Users', NULL, 'si-3.3', 'si-03.03', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-03_05__r520', 'SI-03(05)', 'Portable Storage Devices', NULL, 'si-3.5', 'si-03.05', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-03_07__r520', 'SI-03(07)', 'Nonsignature-based Detection', NULL, 'si-3.7', 'si-03.07', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-03_09__r520', 'SI-03(09)', 'Authenticate Remote Commands', NULL, 'si-3.9', 'si-03.09', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-04_06__r520', 'SI-04(06)', 'Restrict Non-privileged Users', NULL, 'si-4.6', 'si-04.06', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-04_08__r520', 'SI-04(08)', 'Protection of Monitoring Information', NULL, 'si-4.8', 'si-04.08', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-06_01__r520', 'SI-06(01)', 'Notification of Failed Security Tests', NULL, 'si-6.1', 'si-06.01', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-07_04__r520', 'SI-07(04)', 'Tamper-evident Packaging', NULL, 'si-7.4', 'si-07.04', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-07_11__r520', 'SI-07(11)', 'Confined Environments with Limited Privileges', NULL, 'si-7.11', 'si-07.11', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-07_13__r520', 'SI-07(13)', 'Code Execution in Protected Environments', NULL, 'si-7.13', 'si-07.13', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-07_14__r520', 'SI-07(14)', 'Binary or Machine Executable Code', NULL, 'si-7.14', 'si-07.14', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-08_01__r520', 'SI-08(01)', 'Central Management', NULL, 'si-8.1', 'si-08.01', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-09_r520', 'SI-09', 'Information Input Restrictions', NULL, 'si-9', 'si-09', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW()),
  ('ctrl_si-13_02__r520', 'SI-13(02)', 'Time Limit on Process Execution Without Supervision', NULL, 'si-13.2', 'si-13.02', '{}', '{}', 'WITHDRAWN', 'SI', 'nist_r520', 'system_nist_gov', 'system_nist_gov', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-02_r520' WHERE "id" = 'ctrl_ac-02_10__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-03_r520' WHERE "id" = 'ctrl_ac-03_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-03_r520' WHERE "id" = 'ctrl_ac-03_06__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-04_r520' WHERE "id" = 'ctrl_ac-04_16__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-04_r520' WHERE "id" = 'ctrl_ac-04_18__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-07_r520' WHERE "id" = 'ctrl_ac-07_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-14_r520' WHERE "id" = 'ctrl_ac-14_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-17_r520' WHERE "id" = 'ctrl_ac-17_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-17_r520' WHERE "id" = 'ctrl_ac-17_07__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-17_r520' WHERE "id" = 'ctrl_ac-17_08__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-18_r520' WHERE "id" = 'ctrl_ac-18_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-19_r520' WHERE "id" = 'ctrl_ac-19_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-19_r520' WHERE "id" = 'ctrl_ac-19_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-19_r520' WHERE "id" = 'ctrl_ac-19_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_at-03_r520' WHERE "id" = 'ctrl_at-03_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-02_r520' WHERE "id" = 'ctrl_au-02_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-02_r520' WHERE "id" = 'ctrl_au-02_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-02_r520' WHERE "id" = 'ctrl_au-02_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-02_r520' WHERE "id" = 'ctrl_au-02_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-03_r520' WHERE "id" = 'ctrl_au-03_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-06_r520' WHERE "id" = 'ctrl_au-06_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-06_r520' WHERE "id" = 'ctrl_au-06_10__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-07_r520' WHERE "id" = 'ctrl_au-07_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-08_r520' WHERE "id" = 'ctrl_au-08_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-08_r520' WHERE "id" = 'ctrl_au-08_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-10_r520' WHERE "id" = 'ctrl_au-10_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_au-14_r520' WHERE "id" = 'ctrl_au-14_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ca-03_r520' WHERE "id" = 'ctrl_ca-03_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ca-03_r520' WHERE "id" = 'ctrl_ca-03_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ca-03_r520' WHERE "id" = 'ctrl_ca-03_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ca-03_r520' WHERE "id" = 'ctrl_ca-03_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ca-03_r520' WHERE "id" = 'ctrl_ca-03_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ca-07_r520' WHERE "id" = 'ctrl_ca-07_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cm-02_r520' WHERE "id" = 'ctrl_cm-02_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cm-02_r520' WHERE "id" = 'ctrl_cm-02_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cm-02_r520' WHERE "id" = 'ctrl_cm-02_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cm-05_r520' WHERE "id" = 'ctrl_cm-05_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cm-05_r520' WHERE "id" = 'ctrl_cm-05_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cm-05_r520' WHERE "id" = 'ctrl_cm-05_07__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cm-06_r520' WHERE "id" = 'ctrl_cm-06_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cm-06_r520' WHERE "id" = 'ctrl_cm-06_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cm-08_r520' WHERE "id" = 'ctrl_cm-08_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cm-11_r520' WHERE "id" = 'ctrl_cm-11_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cp-02_r520' WHERE "id" = 'ctrl_cp-02_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cp-07_r520' WHERE "id" = 'ctrl_cp-07_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cp-09_r520' WHERE "id" = 'ctrl_cp-09_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cp-10_r520' WHERE "id" = 'ctrl_cp-10_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cp-10_r520' WHERE "id" = 'ctrl_cp-10_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_cp-10_r520' WHERE "id" = 'ctrl_cp-10_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-02_r520' WHERE "id" = 'ctrl_ia-02_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-02_r520' WHERE "id" = 'ctrl_ia-02_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-02_r520' WHERE "id" = 'ctrl_ia-02_07__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-02_r520' WHERE "id" = 'ctrl_ia-02_09__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-02_r520' WHERE "id" = 'ctrl_ia-02_11__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-03_r520' WHERE "id" = 'ctrl_ia-03_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-04_r520' WHERE "id" = 'ctrl_ia-04_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-04_r520' WHERE "id" = 'ctrl_ia-04_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-04_r520' WHERE "id" = 'ctrl_ia-04_07__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-05_r520' WHERE "id" = 'ctrl_ia-05_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-05_r520' WHERE "id" = 'ctrl_ia-05_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-05_r520' WHERE "id" = 'ctrl_ia-05_11__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-08_r520' WHERE "id" = 'ctrl_ia-08_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-09_r520' WHERE "id" = 'ctrl_ia-09_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ia-09_r520' WHERE "id" = 'ctrl_ia-09_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ir-09_r520' WHERE "id" = 'ctrl_ir-09_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ma-02_r520' WHERE "id" = 'ctrl_ma-02_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ma-04_r520' WHERE "id" = 'ctrl_ma-04_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_mp-02_r520' WHERE "id" = 'ctrl_mp-02_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_mp-02_r520' WHERE "id" = 'ctrl_mp-02_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_mp-04_r520' WHERE "id" = 'ctrl_mp-04_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_mp-05_r520' WHERE "id" = 'ctrl_mp-05_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_mp-05_r520' WHERE "id" = 'ctrl_mp-05_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_mp-05_r520' WHERE "id" = 'ctrl_mp-05_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_mp-06_r520' WHERE "id" = 'ctrl_mp-06_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_mp-06_r520' WHERE "id" = 'ctrl_mp-06_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_mp-06_r520' WHERE "id" = 'ctrl_mp-06_06__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_mp-07_r520' WHERE "id" = 'ctrl_mp-07_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_pe-03_r520' WHERE "id" = 'ctrl_pe-03_06__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_pe-05_r520' WHERE "id" = 'ctrl_pe-05_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_pe-05_r520' WHERE "id" = 'ctrl_pe-05_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_pe-08_r520' WHERE "id" = 'ctrl_pe-08_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_pe-10_r520' WHERE "id" = 'ctrl_pe-10_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_pe-13_r520' WHERE "id" = 'ctrl_pe-13_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_pe-18_r520' WHERE "id" = 'ctrl_pe-18_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_pl-02_r520' WHERE "id" = 'ctrl_pl-02_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_pl-02_r520' WHERE "id" = 'ctrl_pl-02_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_pl-02_r520' WHERE "id" = 'ctrl_pl-02_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ps-06_r520' WHERE "id" = 'ctrl_ps-06_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ra-05_r520' WHERE "id" = 'ctrl_ra-05_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ra-05_r520' WHERE "id" = 'ctrl_ra-05_07__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_ra-05_r520' WHERE "id" = 'ctrl_ra-05_09__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-04_r520' WHERE "id" = 'ctrl_sa-04_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-05_r520' WHERE "id" = 'ctrl_sa-05_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-05_r520' WHERE "id" = 'ctrl_sa-05_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-05_r520' WHERE "id" = 'ctrl_sa-05_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-05_r520' WHERE "id" = 'ctrl_sa-05_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-05_r520' WHERE "id" = 'ctrl_sa-05_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_06__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_07__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_08__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_09__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_10__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_11__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_12__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_13__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_14__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-12_r520' WHERE "id" = 'ctrl_sa-12_15__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-14_r520' WHERE "id" = 'ctrl_sa-14_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-15_r520' WHERE "id" = 'ctrl_sa-15_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-15_r520' WHERE "id" = 'ctrl_sa-15_09__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-18_r520' WHERE "id" = 'ctrl_sa-18_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-18_r520' WHERE "id" = 'ctrl_sa-18_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-19_r520' WHERE "id" = 'ctrl_sa-19_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-19_r520' WHERE "id" = 'ctrl_sa-19_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-19_r520' WHERE "id" = 'ctrl_sa-19_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-19_r520' WHERE "id" = 'ctrl_sa-19_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-21_r520' WHERE "id" = 'ctrl_sa-21_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sa-22_r520' WHERE "id" = 'ctrl_sa-22_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-04_r520' WHERE "id" = 'ctrl_sc-04_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-07_r520' WHERE "id" = 'ctrl_sc-07_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-07_r520' WHERE "id" = 'ctrl_sc-07_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-07_r520' WHERE "id" = 'ctrl_sc-07_06__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-12_r520' WHERE "id" = 'ctrl_sc-12_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-12_r520' WHERE "id" = 'ctrl_sc-12_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-13_r520' WHERE "id" = 'ctrl_sc-13_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-13_r520' WHERE "id" = 'ctrl_sc-13_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-13_r520' WHERE "id" = 'ctrl_sc-13_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-13_r520' WHERE "id" = 'ctrl_sc-13_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-15_r520' WHERE "id" = 'ctrl_sc-15_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-20_r520' WHERE "id" = 'ctrl_sc-20_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-21_r520' WHERE "id" = 'ctrl_sc-21_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-23_r520' WHERE "id" = 'ctrl_sc-23_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-23_r520' WHERE "id" = 'ctrl_sc-23_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-26_r520' WHERE "id" = 'ctrl_sc-26_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-30_r520' WHERE "id" = 'ctrl_sc-30_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-34_r520' WHERE "id" = 'ctrl_sc-34_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_sc-42_r520' WHERE "id" = 'ctrl_sc-42_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-02_r520' WHERE "id" = 'ctrl_si-02_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-03_r520' WHERE "id" = 'ctrl_si-03_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-03_r520' WHERE "id" = 'ctrl_si-03_02__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-03_r520' WHERE "id" = 'ctrl_si-03_03__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-03_r520' WHERE "id" = 'ctrl_si-03_05__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-03_r520' WHERE "id" = 'ctrl_si-03_07__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-03_r520' WHERE "id" = 'ctrl_si-03_09__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-04_r520' WHERE "id" = 'ctrl_si-04_06__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-04_r520' WHERE "id" = 'ctrl_si-04_08__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-06_r520' WHERE "id" = 'ctrl_si-06_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-07_r520' WHERE "id" = 'ctrl_si-07_04__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-07_r520' WHERE "id" = 'ctrl_si-07_11__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-07_r520' WHERE "id" = 'ctrl_si-07_13__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-07_r520' WHERE "id" = 'ctrl_si-07_14__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-08_r520' WHERE "id" = 'ctrl_si-08_01__r520';
  UPDATE "NistControl" SET "parentControlId" = 'ctrl_si-13_r520' WHERE "id" = 'ctrl_si-13_02__r520';
