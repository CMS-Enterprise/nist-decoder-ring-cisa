-- 12-ztmm-guidance-updated.sql
--
-- The guidance describes Zero Trust pillars and functions and has nothing to
-- do with which control catalog is loaded. createdById names this catalog's
-- system user.
-- Columnar ZTMM guidance.
--
-- One row per (pillar, function). `base` is shared prose rendered for every
-- maturity; the four maturity columns hold the level-specific fragment. The API
-- resolves by natural key (pillar, functionGroup) and concatenates every row in a
-- group — rendering base + the maturity column for each (function-name order).
--
-- This project's own guidance text, written around the stages of CISA's Zero Trust
-- Maturity Model; it is not taken from a published source.
--
-- HAND-AUTHORED CONTRACT (this file is the source of truth; edit it directly):
--   * pillar       : a ZTPillar enum value.
--   * function     : the function's name in the function-code table of CISA's Zero
--                    Trust Maturity Model control mapping (32 functions across five
--                    pillars; the in-pillar capabilities carry the pillar's name, e.g.
--                    'Device Visibility and Analytics'). Use 'and', never '&'. CISA
--                    maps no Governance function and no standalone capability, so
--                    this file has no row for either. Must match 09-zt-mappings.sql.
--   * functionGroup: the key a mapping resolves against. = function for singletons;
--                    multi-part functions share one base group (see MULTI-PART below).
--   * base         : NOT NULL prose; maturity columns are nullable fragments.
--   * id           : "<pillar-slug>.<...>" — hand-authored; short forms OK, but the
--                    pillar-slug prefix must match the pillar and be unique.
--   * one row per (pillar, function) — @@unique([pillar, function]).
--
-- GRAMMAR — base is a sentence STEM that each maturity fragment completes:
--   base        = "Users authenticate using:"
--   traditional = "Username and password, two-step verification (2SV), or MFA."
--   rendered   -> "Users authenticate using:" + newline + the fragment.
--   Keep base ending in a lead-in (e.g. ":") and fragments as completing clauses.
--
-- MULTI-PART GROUPS (one mapping function -> several rows, concatenated):
--   IDENTITY     | Authentication                  -> Authentication of Non-Person Entities (NPEs); Authentication of Users
--   IDENTITY     | Identity Stores                 -> Identity Stores-Developers; -APIs; -Users
--   APPLICATIONS | Application Access              -> Application Access-API; -Users
--
-- `make db-seed-check` enforces all of the above + reports resolution coverage.

INSERT INTO "ZTMMGuidance" (
  "id",
  "pillar",
  "function",
  "functionGroup",
  "base",
  "traditional",
  "initial",
  "advanced",
  "optimal",
  "createdById",
  "createdAt",
  "updatedAt"
)
VALUES

  (
    'identity.authentication-npe',
    'IDENTITY'::"ZTPillar",
    'Authentication of Non-Person Entities (NPEs)',
    'Authentication',
    'Authentication mechanisms used by NPEs to verify the identity of a user or device attempting to access a resource or service. [NPEs includes Service Accounts, devices, and APIs]

NPEs authenticate using:',
    'access lists and rules for subnets and routing.',
    'client certificates and/or API keys. Access is managed via certificate authority (CA) routing.',
    'a shared secret (JWT, API Key). Access is managed via cloud transit gateway and security groups. Initial access decision requires compliant device posture check.',
    'continuous validation for initial access and throughout the session; uses PKI, phish-resistant, or password-less MFA. Dynamic, attribute-based access control.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'identity.authentication-users',
    'IDENTITY'::"ZTPillar",
    'Authentication of Users',
    'Authentication',
    'Authentication mechanisms used for Users to verify the identity of a user or device attempting to access a resource or service.

Users authenticate using:',
    'Username and password, two-step verification (2SV), or MFA.',
    'using username & password and 2SV. MFA options are available.',
    'MFA (encouraged); phishing-resistant options offered.',
    'continuous validation for initial access and throughout the session; phish-resistant and/or password-less MFA. Dynamic, attribute-based access control.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'identity.id-stores-developer',
    'IDENTITY'::"ZTPillar",
    'Identity Stores-Developers',
    'Identity Stores',
    'How and where unique attributes associated with system developers (Devs) are stored and managed within identity and access management systems.

Devs ID information is stored using identity stores provided by the agency''s cloud platform. Service Level Users are created by cloud platform administrators.',
    'The system owner sometimes creates non-service level Users manually within its account(s).',
    'The system owner sometimes creates users manually within its account(s), and those users follow RBAC.',
    'The system owner does not create Users manually within its account(s).',
    'The system owner is prevented from creating Users manually within its account(s).',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'identity.id-stores-api',
    'IDENTITY'::"ZTPillar",
    'Identity Stores-APIs',
    'Identity Stores',
    'How and where unique attributes associated with an API user identity are stored and managed within identity and access management systems.

API ID information is stored using:',
    'manually managed lifecycle access. User identities may not be fully documented.',
    'manually managed lifecycle access. API identities are all assigned expirations. User identities are mostly documented.',
    'a mix of manual and automated lifecycle access. API identities have an automated expiration. User identities are fully documented.',
    'automated lifecycle access. API identities have an automated expiration. User identities are fully documented.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'identity.id-stores-user',
    'IDENTITY'::"ZTPillar",
    'Identity Stores-Users',
    'Identity Stores',
    'How and where unique attributes associated with identities for Users are stored and managed within identity and access management systems.

User ID information is stored using:',
    'a bespoke user identity store such as Amazon Cognito. User identity may not be fully documented.',
    'Agency-provided identity store. User identity may not be fully documented.',
    'Agency-provided identity store. User identities are fully documented.',
    'Agency-provided identity store. System can automatically remove unneeded users.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'identity.risk-assessments',
    'IDENTITY'::"ZTPillar",
    'Risk Assessments',
    'Risk Assessments',
    'How an agency looks for and assesses the risk of an identity or credential being counterfeit.

Agency determines identity risk:',
    'using limited manual and static processes.',
    'based on simple analytics and static rules for Users and/or APIs. Alternatively, the agency depends on the risk assessments of its identity provider.',
    'with some automated analysis and dynamic rules to inform access decisions and response activities.',
    'analyzing user behavior continually in real time with machine learning algorithms to determine risk and deliver ongoing protection.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'identity.access-management',
    'IDENTITY'::"ZTPillar",
    'Access Management',
    'Access Management',
    'How unique identifiers and attributes to govern and control access to resources and services are used.

Agency authorizes:',
    'permanent access with periodic review for both privileged and unprivileged accounts.',
    'access that expires with automated review, including for privileged access requests.',
    'need-based and session-based access that is tailored to actions and resources, including for privileged access requests.',
    'just-in-time and just-enough access tailored to individual actions and individual resource needs using automation.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'identity.automation-and-orchestration-capability',
    'IDENTITY'::"ZTPillar",
    'Identity Automation and Orchestration',
    'Identity Automation and Orchestration',
    'How system, API, and User identities are automated and how workflows provision and manage identity-related access controls and security policies.

Agency:',
    'manually orchestrates (onboards, offboards, and disables) self-managed identities (users and entities) with little integration and performs regular review.',
    'administers identity and credentials across identity stores using a mix of manual configuration and the cloud account management service. Automates orchestration of non-privileged users and self-managed entities.',
    'manually orchestrates privileged user identities; uses basic automated orchestration to federate identity and permit administration across identity stores using a mix of manual configuration and the cloud account management service.',
    'fully orchestrates the identity lifecycle; dynamic user profiling, dynamic identity and group membership across all environments based on behaviors, enrollments, and deployment needs. Just-in-time and just-enough access controls are implemented.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'identity.visibility-and-analytics-capability',
    'IDENTITY'::"ZTPillar",
    'Identity Visibility and Analytics',
    'Identity Visibility and Analytics',
    'How the system tracks and analyzes user and entity behavior across an organization''s environment using identity-related data and contextual information.

Agency:',
    'collects user and entity activity logs, especially for privileged credentials, and performs some basic, static, manual analysis.',
    'collects user and entity activity logs and augments visibility with routine manual analysis and refinement by the agency''s security operations center (SOC). Some automated analysis, with limited correlation between log types.',
    'aggregates user activity visibility with basic attributes including automated analysis across some user and entity activity and then analyzes and reports for manual refinement by the agency''s SOC.',
    'centralizes comprehensive user visibility and situational awareness with high fidelity attributes for user and entity behavior analytics (UEBA) supported by the agency''s SOC.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'devices.policy-enforcement',
    'DEVICES'::"ZTPillar",
    'Policy Enforcement',
    'Policy Enforcement',
    'Processes and technologies used to enforce security policies and monitor compliance on devices, systems, and network components.

Agency:',
    'has limited, if any, visibility (i.e., ability to inspect device behavior) into device compliance with few methods of enforcing policies or managing software, configurations, or vulnerabilities. Implicit trust of each system.',
    'receives self-reported device characteristics (e.g., keys, tokens, users, etc.) from systems, but has limited enforcement mechanisms. Agency has a preliminary, basic process in place to approve software use and push updates and configuration changes to hardened base images.',
    'has verified insights (i.e., agency-controlled remote audit) of system resources, including remote policy scans, via AWS SecurityHub and configuration management. Agency enforces compliance for most systems and virtual assets. Agency uses automated methods to manage virtual assets, approve software, identify vulnerabilities and install patches.',
    'continuously verifies insights and enforces compliance throughout the lifetime of devices and virtual assets via agency-controlled Endpoint Management. Integrates device virtual assets, software, configuration, and vulnerability management across all agency environments, including for virtual assets. Policies are auditable and enforceable. Non-compliance is actively prevented by agency standards and policies. Zero Trust of each system.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'devices.asset-and-supply-chain-risk-management',
    'DEVICES'::"ZTPillar",
    'Asset and Supply Chain',
    'Asset and Supply Chain',
    'Manage and mitigate risks in procuring, inventorying, and maintaining devices, systems, VMs and containers in your accounts.

Agency:',
    'depends on AWS to inventory VMs and Containers and does not track physical or virtual assets enterprise-wide or across vendors. Agency manages its own supply chain device and service acquisition ad hoc with limited view of enterprise-wide risks.',
    'tracks all physical and some virtual assets and manages supply chain risks by establishing policies and control baselines according to federal recommendations using a robust framework [NIST SCRM], or automates methods to identify vulnerabilities and patch assets.',
    'begins to develop a comprehensive enterprise view of physical and virtual assets via automated processes that can function across multiple vendors to verify acquisitions, track development cycles, provide third-party assessments, inventory VMs and containers, identify vulnerabilities, and patch assets.',
    'has a comprehensive, at- or near- real-time view, uses automated methods to inventory VMs and containers, identify vulnerabilities, and patch assets. Agency can automatically identify VMs and containers that are non-sanctioned assets and automate supply chain risk management as applicable, build operations that tolerate supply chain failures, and incorporate best practices.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'devices.resource-access',
    'DEVICES'::"ZTPillar",
    'Resource Access',
    'Resource Access',
    'Processes and controls to govern and manage data and critical resource access on devices and systems.

Agency:',
    'does not require visibility into devices or virtual assets used to access resources. When visibility is required device access to data is governed by static access controls.',
    'approve resource access by requiring some devices or virtual assets to report characteristics through dynamic access controls that consider contextual information such as the user''s identity, device type, location, and other relevant factors.',
    'initial resource access considers verified device or virtual asset insights based on a device-level signal.',
    'device access to data considers real-time risk analytics about device & role and actively prevents non-compliant devices from accessing data.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'devices.device-threat-protection',
    'DEVICES'::"ZTPillar",
    'Device Threat Protection',
    'Device Threat Protection',
    'Technologies and controls used to detect, prevent, and mitigate threats and vulnerabilities on devices and systems.

Agency:',
    'manually deploys threat protection capabilities to some devices.',
    'automates some processes for deploying and updating threat protection capabilities to devices and virtual assets with limited policy enforcement and compliance monitoring integration.',
    'begins to consolidate threat protection capabilities, centralize solutions for devices and virtual assets, and integrates most of these capabilities with policy enforcement and compliance monitoring.',
    'has centralized threat protection security solution(s) deployed with advanced capabilities for all devices and virtual assets and a unified approach for device threat protection, policy enforcement, and compliance monitoring.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'devices.automation-and-orchestration-capability',
    'DEVICES'::"ZTPillar",
    'Device Automation and Orchestration',
    'Device Automation and Orchestration',
    'How devices and systems, including VMS and Containers, are provisioned and managed using automated processes and workflows.

Agency provisions VMs and Containers:',
    'with static capacity allocations. Manual configurations, settings, and provisioning are allowed.',
    'automatically via CSP tooling that relies on pre-determined policies and semi-automated risk assessments. Device security controls are configured manually but audited automatically.',
    'using automated, repeatable methods with policy-driven capacity allocations and risk-based reactive scaling and remediation. Device security controls are configured automatically. Non-compliant devices disconnected manually.',
    'use continuous integration and continuous deployment (CI/CD) principles with immutable infrastructure and dynamic scaling. Continuous testing prevents non-compliant deployments.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'devices.visibility-and-analytics-capability',
    'DEVICES'::"ZTPillar",
    'Device Visibility and Analytics',
    'Device Visibility and Analytics',
    'How devices, including VMs and Containers are inventoried and assessed

Devices and virtual assets:',
    'rely on manual label inspections and periodic network discovery and reporting.',
    'are inventoried using digital labels with some assets under automated analysis (e.g., software-based scanning) for anomaly detection based on risk.',
    'are all automatically inventoried and automatically monitored [software-based scanning] for unauthorized devices.',
    'postures when network-connected, are assessed continuously and automatically [using endpoint detection and anomaly response (EDR) tools] associated with Identity, to inform resource access. Agency tracks patterns of provisioning and/or de- provisioning of virtual assets for anomalies.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'networks.network-segmentation',
    'NETWORKS'::"ZTPillar",
    'Traffic Segmentation',
    'Traffic Segmentation',
    'How the agency thinks about dividing an organization''s network into smaller, isolated segments to control access and reduce the risk of lateral movement by threat actors.

Agency defines network architecture:',
    'using large perimeter or macro-segmentation. [An application may run in a single VPC with no subnets.]',
    'using some segmentation that prioritizes critical workloads with multiple layers of AuthN and AuthZ on internal perimeters. Systems that share an AWS account rely on static assigned permission-based access controls to stay separated.',
    'with more ingress/egress micro-perimeters and some internal micro-segmentation. When multiple systems share an AWS account, they are separated within the account or by service architecture. There are Subnets within the VPC; segmentation may use security groups.',
    'consisting of fully distributed ingress/egress microperimeters and deeper internal microsegmentation based around application workflows. Each resource in an AWS account has a configuration (through IAM, Security Groups, or other) to control who it can and cannot connect to. Resources doing the same thing, e.g. multiple instances of the same Container, may share the same configuration, but it should be applied at the individual resource.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'networks.network-traffic-management',
    'NETWORKS'::"ZTPillar",
    'Traffic Management',
    'Traffic Management',
    'Techniques and technologies used to monitor, control, and secure network traffic.

Agency:',
    'manually implements static network rules and configurations at service provisioning with limited monitoring capabilities [application performance monitoring or anomaly detection] and manual audits of profile changes for mission-critical applications.',
    'establishes application profiles with distinct traffic management features and begins to map all applications to these profiles. Agency expands application of static rules to all applications, performing periodic manual audits of application profile assessments.',
    'configures network with dynamic rules and configurations for resource optimization that are periodically adapted based upon automated risk-aware and risk-responsive application profile assessments and monitoring.',
    'configures network with dynamic rules and configurations that continuously evolve to meet application profile needs and reprioritize applications based on mission criticality, risk, etc.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'networks.traffic-encryption',
    'NETWORKS'::"ZTPillar",
    'Traffic Encryption',
    'Traffic Encryption',
    'How granular encryption of data in transit is applied.

Agency encrypts:',
    'minimal internal or external traffic, and relies on manual or ad hoc processes to manage and secure encryption keys.',
    'all external traffic with basic TLS (whether to another account in the agency''s AWS organization or out of AWS.) Some data encryption is in place to address VPC peering between accounts and limited other internal traffic, at the application level. More formal policies are in place to manage encryption keys, and secure server/service encryption keys.',
    'all traffic at TLS 1.2 or higher that leaves the AWS account (whether to another account in the agency''s AWS organization or out of AWS,) as well as some traffic within the AWS account. Encryption to external entities may occur at CloudFront, the network load balancer, or API Gateway. For VPC peering between accounts, encryption applied at the application level. Agency manages issuance and rotation of keys and certificates, and begins to incorporate best practices for cryptographic agility.',
    'all traffic at TLS 1.2 or higher to internal and external locations. External traffic is terminated as close to the application as possible. Exceptions may exist because a required component cannot handle encrypted network traffic. Agency enforces least privilege principles for secure key management, and incorporates best practices for cryptographic agility as widely as possible.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'networks.network-resilience',
    'NETWORKS'::"ZTPillar",
    'Resilience',
    'Resilience',
    'Ability of an organization''s network to withstand and recover from disruptions or attacks.

Agency configures network capabilities:',
    'on a case-by-case basis to only match individual application availability demands with limited resilience mechanisms for workloads not deemed mission critical.',
    'to begin to manage availability demands for additional applications and expand resilience mechanisms for workloads not deemed mission critical.',
    'to dynamically manage the availability demands and resilience mechanisms for the majority of their applications.',
    'to integrate holistic delivery and awareness in adapting to changes in availability demands for all workloads and provides proportionate resilience.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'networks.automation-and-orchestration-capability',
    'NETWORKS'::"ZTPillar",
    'Network Automation and Orchestration',
    'Network Automation and Orchestration',
    'How networks are created and maintained.

Agency initiates and executes network and environment changes:',
    'manually through the AWS console following change management workflows.',
    'manually using some automated workflows. Changes are made via scripts run on-demand by the agency.',
    'manually using all automated workflows. Changes are made via scripts run on demand by the agency.',
    'using systemic infrastructure-as-code (IaC), with pervasive automation, following (CI/CD) deployment models. Manual changes, either by console or CLI, are prohibited.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'networks.visibility-and-analytics-capability',
    'NETWORKS'::"ZTPillar",
    'Network Visibility and Analytics',
    'Network Visibility and Analytics',
    'How network configuration and use is monitored.

Agency:',
    'provides visibility at perimeter with centralized aggregation and analysis. Stores VPC flow logs in S3. Stores VPC-related changes in CloudTrail.',
    'integrates analysis across multiple sensor types and locations with centralized aggregation and analysis. Sends VPC flow logs to CloudWatch. Sends VPC-related changes to CloudWatch from CloudTrail. Logs from AWS WAF and CloudFront also in CloudWatch. Analysis is based on known Indicators of Compromise (IOCs).',
    'integrates emergent threat analysis across multiple sensor types and locations within the system''s environment using manual policy-driven alerts and triggers; centralized logging. Sends VPC flow logs to CloudWatch. Sends VPC-related changes CloudWatch from CloudTrail. Logs from AWS WAF and CloudFront also in CloudWatch. Alerts are manually reviewed within CloudWatch.',
    'integrates analysis both internally and compatible with the agency''s monitoring across multiple sensor types and positions with automated alerts and triggers; centralized logging. Alerts include machine learning or behavior analytics. CloudWatch has an assortment of alerts and triggers specifically for network changes and network use automatically raised to the system owner or to the agency''s SOC.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'applications.application-access-users',
    'APPLICATIONS'::"ZTPillar",
    'Application Access-Users',
    'Application Access',
    'How application access authorization is determined for interactive users granting and controlling access to applications and workloads.

User access to applications:',
    'is primarily based on local authorization and static attributes with rights remaining post-session.',
    'begins incorporating centralized authentication, authorization, monitoring, and attributes. Access is long-lived and remains post-session.',
    'is automated and relies on centralized authentication, authorization, monitoring, and attributes. Access is granted for a time-bound session, and adheres to least-privilege principles.',
    'is continuously authorized considering real-time risk analytics, including user behavior patterns. Access can be automatically revoked.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'applications.application-access-API',
    'APPLICATIONS'::"ZTPillar",
    'Application Access-API',
    'Application Access',
    'How application access authorization is determined for APIs.

API Access:',
    'is primarily based on local authorization and static attributes with rights remaining post-session.',
    'relies on centralized authentication, authorization, monitoring, and attributes. Is long-lived and granted based on IAM roles or static permissions.',
    'relies on centralized authentication, authorization, monitoring, and attributes; expires after a predetermined time. API Gateway integrated with IAM; resource- and identity-based policies; service roles.',
    'is controlled by API Gateway and fully integrated with IAM to continuously authorize considering real-time risk analytics. Policies and service roles adhere to least-privilege principles.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'applications.application-threat-protection',
    'APPLICATIONS'::"ZTPillar",
    'Application Threat Protection',
    'Application Threat Protection',
    'How threat protections are applied to the application or workload.

Application or workload threat protections:',
    'have minimal integration with application workflows, applying general-purpose protections for known threats.',
    'have minimal integration with application workflows, primarily applying protections for known threats to mission critical workflows, with some application-specific protections.',
    'have basic integration into all application workflows, primarily applying protections for known and targeted threats with some application-specific protections.',
    'are strongly integrated into application workflows, with analytics to provide protections that understand and account for application-specific behavior, offering real-time visibility and protections against sophisticated attacks that are tailored to each application.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'applications.accessible-applications',
    'APPLICATIONS'::"ZTPillar",
    'Accessible Applications',
    'Accessible Applications',
    'What network does a user need to be on to access the application.',
    'Users are required to be on a specific private network to access the application [VPN or agency network].',
    'Mission-critical applications are accessible via brokered connections on public networks with secure remote access mechanisms such as VPNs or on secure remote desktops.',
    'Mission critical components of an application are accessible to some users over the public internet, but privileged users must be on a specific network [VPN or agency network].',
    'Application is directly accessible for all users over the internet.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'applications.secure-development-and-deployment-workflow',
    'APPLICATIONS'::"ZTPillar",
    'Secure App Development',
    'Secure App Development',
    'How applications and workloads are built, tested, and deployed using secure development practices and zero trust principles.

Agency:',
    'has ad hoc development, testing, and production environments with non-robust code deployment mechanisms.',
    'provides infrastructure for development, testing, and production environments (including automation) with formal code deployment mechanisms through CI/CD pipelines and requisite access controls in support of least-privilege principles.',
    'uses distinct and coordinated teams for development, security, and operations while removing developer access to production environment for code deployment.',
    'leverages immutable workloads where feasible, only allowing changes to take effect through redeployment, and removes administrator access to deployment environments in favor of automated processes for code deployment.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'applications.application-security-testing',
    'APPLICATIONS'::"ZTPillar",
    'Security Testing',
    'Security Testing',
    'How code and infrastructure is tested for security vulnerabilities.

Agency application security testing:',
    'is performed prior to deployment, primarily through static and manual testing methods. SAST in Dev.',
    'is integrated into the development and deployment process, primarily through static and manual testing methods. SAST in Dev.',
    'is integrated into the application development and deployment process, including the use of dynamic testing methods. SAST and DAST in Dev.',
    'is integrated throughout the development and deployment process, with regular automated testing of deployed applications. Includes DAST in Prod.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'applications.automation-and-orchestration-capability',
    'APPLICATIONS'::"ZTPillar",
    'Application Automation and Orchestration',
    'Application Automation and Orchestration',
    'How the system is able to automate its performance.',
    'System establishes application hosting location and access at provisioning. Changes in scale are handled manually. Limited maintenance and review.',
    'Changes in scale are handled manually. System periodically modifies application configurations (including location and access) to meet relevant security and performance goals. Basic automation is implemented.',
    'System can inform device and network components of changing state. Changes in scale are handled automatically.',
    'Applications automatically adapt to ongoing environmental changes for security and performance optimization.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'applications.visibility-and-analytics-capability',
    'APPLICATIONS'::"ZTPillar",
    'Application Visibility and Analytics',
    'Application Visibility and Analytics',
    'How the system monitors the health of the application and/or workloads.

System performs application health and security monitoring:',
    'in isolation using external sensors and/or application/workload data. Aggregation and analysis is limited.',
    'in isolation with limited automation using external sensors and application/workload data. Basic monitoring capabilities such as logging, analytics, and health monitoring are included for applications.',
    'automated in context with some external sensors and application/workload data. Processes are refined over time to address gaps in visibility.',
    'continuously and dynamically with external sensors and application/workload data. Comprehensive visibility.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'data.data-inventory-management',
    'DATA'::"ZTPillar",
    'Inventory Management',
    'Inventory Management',
    'How the agency classifies and inventories data sources throughout their lifecycle.

Agency:',
    'has minimal, manual data inventorying [mission critical data].',
    'begins to automate data inventory processes, covering most data and begins to incorporate protections against data loss. Some automated tracking of critical data.',
    'automates data inventory and tracking, covering all applicable data with data loss prevention strategies based upon static attributes and/or labels.',
    'continuously inventories and tags all applicable data and employs robust data loss prevention and tracking strategies that dynamically block suspected data exfiltration.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'data.data-categorization',
    'DATA'::"ZTPillar",
    'Categorization',
    'Categorization',
    'How the agency categorizes data based on sensitivity and criticality.

Agency:',
    'manually categorizes data ad hoc, leading to inconsistent categorization.',
    'adds consistency data categorization strategy and analysis methods by including defined labels and manual enforcement mechanisms.',
    'categorizes data using a combination of manual and static analysis methods while automating some data categorization and labeling processes in a consistent, tiered, targeted manner with simple, structured formats and regular review.',
    'consistenly automates data categorization and labeling throughout, and augments categorization with robust techniques; granular, structured formats; and mechanisms to address all data types including machine learning models.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'data.data-availability',
    'DATA'::"ZTPillar",
    'Availability',
    'Availability',
    'Ensuring that authorized users have access to data when they need it.

Agency:',
    'primarily makes data available through cloud-based data stores with some on-prem and off-site backups.',
    'provides limited access to data through redundant and highly available cloud-based data stores, such as the agency''s cloud platform and AWS, while also maintaining off-site backups of on-prem data.',
    'primarily makes data available from redundant, highly available data stores [the agency''s cloud platform, AWS] and ensures access to historical data via AWS S3.',
    'Agency uses dynamic methods [AWS microservices] to optimize data availability, including historical data, according to user and entity need.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'data.data-access',
    'DATA'::"ZTPillar",
    'Data Access',
    'Data Access',
    'How access to data is granted based on policies and user authentication.',
    'Static access controls govern user and entity access [permissions to read, write, copy, grant others access, etc.]',
    'Deployment of automated access controls that incorporate elements of least privilege across the enterprise.',
    'Automated access controls that consider various attributes [identity, device risk, application, data category, and time, etc.] are time-limited where applicable.',
    'Access is dynamic just-in-time (JIT) and just-enough (JEA). Controls are enterprise-wide with continuous review of permissions, risk-based determinations.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'data.data-encryption',
    'DATA'::"ZTPillar",
    'Encryption',
    'Encryption',
    'How data at rest is encrypted.

Agency encrypts:',
    'only some data stores at rest or in transit. Relies on manual or ad hoc processes to manage and secure encryption keys. Might exclude public data from encryption.',
    'all data at-rest and all in-transit data that falls outside of the IaaS account. Team has begun to formalize key management policies and secure encryption keys.',
    'all data in the agency''s AWS environment in transit and at rest (both within and outside of IaaS account) to the maximum extent possible. Incorporates cryptographic agility into their processes and protects encryption keys.',
    'all data in-use where appropriate. Encryption is applied at the most granular level, [individual fields in a database can be decrypted without revealing others]. Agency enforces least privilege for key management, and applies encryption using up-to-date standards and cryptographic agility to the extent possible.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'data.automation-and-orchestration-capability',
    'DATA'::"ZTPillar",
    'Data Automation and Orchestration',
    'Data Automation and Orchestration',
    'How an agency is able to automatically label data.

Agency:',
    'categorizes and labels data [access, usage, storage, encryption, configurations, protections, backups, sanitization] through manual, and potentially ad hoc, processes, which prevents automation and orchestration.',
    'manually identifies high-value data and analyzes access controls on an ad hoc basis. Uses some automated processes to categorize and label data.',
    'runs scheduled audits that locate high-value data and analyze access controls. Data categorization and labeling is run primarily through automated methods for most system data in a consistent, tiered, targeted manner.',
    'automatically tags and categorizes all data to the maximum extent possible. Data inventories are automatically updated.',
    'system_nist_gov',
    NOW(),
    NOW()
  ),
  (
    'data.visibility-and-analytics-capability',
    'DATA'::"ZTPillar",
    'Data Visibility and Analytics',
    'Data Visibility and Analytics',
    'Visibility into Data inventory, as well as records on data access.

Agency:',
    'has limited visibility into data inventories except in specific circumstances. Records some data access by humans, including any of the person who accessed, what they accessed, and when it was accessed. Data is analyzed manually.',
    'obtains visibility based on inventory management, categorization, and encryption for critical data [mission critical data]. Analytics and correlation is automated in some instances, but is limited to plaintext data. Records some data access to specific data stores by human users, including the person who accessed, what they accessed, and when it was accessed.',
    'has more comprehensive visibility into regularly updated data inventory. Analysis and correlation are automated but limited to plaintext data. Records all data access by human users, including the person who accessed, what they accessed, and when it was accessed. Begins to employ predictive analytics. Some data is available for agency-level visibility.',
    'data inventory is highly visible across the full data lifecycle and can always be accounted for. Logs and analyzes all access events. Analytics, including predictive analytics, is performed on encrypted data. Records all data access (including changes) by human users, including the person who accessed, what they accessed, when it was accessed, and why it was accessed. All system analysis data is available and supported at the agency level.',
    'system_nist_gov',
    NOW(),
    NOW()
  )
ON CONFLICT ("pillar", "function") DO UPDATE SET
  "functionGroup" = EXCLUDED."functionGroup",
  "base" = EXCLUDED."base",
  "traditional" = EXCLUDED."traditional",
  "initial" = EXCLUDED."initial",
  "advanced" = EXCLUDED."advanced",
  "optimal" = EXCLUDED."optimal",
  "updatedAt" = NOW();
