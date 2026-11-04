-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AuthorityLevel" AS ENUM ('official', 'approved', 'reference');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('partner', 'tool', 'team', 'agency');

-- CreateEnum
CREATE TYPE "ZTPillar" AS ENUM ('IDENTITY', 'DEVICES', 'NETWORKS', 'APPLICATIONS', 'DATA', 'CROSS_CUTTING', 'TBD');

-- CreateEnum
CREATE TYPE "ZTMaturityLevel" AS ENUM ('TRADITIONAL', 'INITIAL', 'ADVANCED', 'OPTIMAL', 'TBD');

-- CreateEnum
CREATE TYPE "ZTDesignation" AS ENUM ('KEY', 'SUPPORTING', 'INFORMATIVE');

-- CreateEnum
CREATE TYPE "ReferenceLinkType" AS ENUM ('REFERENCE', 'TOOL', 'GUIDANCE', 'POLICY');

-- CreateEnum
CREATE TYPE "LinkDomain" AS ENUM ('NIST', 'FEDERAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "Baseline" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'PRIVACY');

-- CreateEnum
CREATE TYPE "ControlStatus" AS ENUM ('LIVE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LineageKind" AS ENUM ('INCORPORATED_INTO', 'MOVED_TO', 'ADDED', 'DROPPED');

-- CreateEnum
CREATE TYPE "AssessmentMethodKind" AS ENUM ('EXAMINE', 'INTERVIEW', 'TEST');

-- CreateTable
CREATE TABLE "NistVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "catalogKey" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "upstreamRevision" TEXT NOT NULL,
    "tailoringNote" TEXT,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NistVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlFamily" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ControlFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NistControl" (
    "id" TEXT NOT NULL,
    "controlNumber" TEXT NOT NULL,
    "controlName" TEXT NOT NULL,
    "discussion" TEXT,
    "oscalId" TEXT,
    "sortId" TEXT,
    "reviewFrequency" TEXT,
    "assessmentFrequency" TEXT,
    "baselineLabels" TEXT[],
    "priority" TEXT,
    "relatedControls" TEXT[],
    "referencePolicy" TEXT,
    "status" "ControlStatus" NOT NULL DEFAULT 'LIVE',
    "controlFamilyId" TEXT NOT NULL,
    "parentControlId" TEXT,
    "nistVersionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NistControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlLineage" (
    "id" TEXT NOT NULL,
    "nistVersionId" TEXT NOT NULL,
    "controlNumber" TEXT NOT NULL,
    "kind" "LineageKind" NOT NULL,
    "relatedControlNumber" TEXT,
    "relatedPartOscalId" TEXT,
    "release" TEXT NOT NULL,
    "sinceRelease" TEXT,
    "controlId" TEXT,
    "relatedControlId" TEXT,
    "relatedPartId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlLineage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlPart" (
    "id" TEXT NOT NULL,
    "oscalPartId" TEXT NOT NULL,
    "label" TEXT,
    "name" TEXT NOT NULL,
    "prose" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "parentPartId" TEXT,
    "nistControlId" TEXT NOT NULL,

    CONSTRAINT "ControlPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentObjective" (
    "id" TEXT NOT NULL,
    "cprtIdentifier" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "nistControlId" TEXT NOT NULL,
    "partId" TEXT,

    CONSTRAINT "AssessmentObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentMethod" (
    "id" TEXT NOT NULL,
    "cprtIdentifier" TEXT NOT NULL,
    "method" "AssessmentMethodKind" NOT NULL,
    "text" TEXT NOT NULL,
    "nistControlId" TEXT NOT NULL,

    CONSTRAINT "AssessmentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlParameter" (
    "id" TEXT NOT NULL,
    "nistControlId" TEXT NOT NULL,
    "partId" TEXT,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ControlParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlParameterValue" (
    "id" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "baselines" "Baseline"[],
    "value" TEXT NOT NULL,

    CONSTRAINT "ControlParameterValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZTMMGuidance" (
    "id" TEXT NOT NULL,
    "pillar" "ZTPillar" NOT NULL,
    "function" TEXT NOT NULL,
    "functionGroup" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "traditional" TEXT,
    "initial" TEXT,
    "advanced" TEXT,
    "optimal" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZTMMGuidance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZeroTrustMapping" (
    "id" TEXT NOT NULL,
    "nistControlId" TEXT NOT NULL,
    "pillars" "ZTPillar"[] DEFAULT ARRAY[]::"ZTPillar"[],
    "function" TEXT NOT NULL,
    "maturityLevel" "ZTMaturityLevel" NOT NULL,
    "dataSourceId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZeroTrustMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZTMappingAffinity" (
    "id" TEXT NOT NULL,
    "ztMappingId" TEXT NOT NULL,
    "pillar" "ZTPillar" NOT NULL,
    "function" TEXT NOT NULL,
    "maturity" "ZTMaturityLevel" NOT NULL,
    "designation" "ZTDesignation",
    "ifApplicable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ZTMappingAffinity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NistLink" (
    "id" TEXT NOT NULL,
    "nistControlId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "resolvedUrl" TEXT,
    "contentType" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "dataSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NistLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceLink" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "domain" "LinkDomain" NOT NULL,
    "linkType" "ReferenceLinkType" NOT NULL DEFAULT 'REFERENCE',
    "dataSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NistControlLink" (
    "nistControlId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NistControlLink_pkey" PRIMARY KEY ("nistControlId","linkId")
);

-- CreateTable
CREATE TABLE "ZTPartCoverage" (
    "id" TEXT NOT NULL,
    "ztMappingId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,

    CONSTRAINT "ZTPartCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "authorityLevel" "AuthorityLevel" NOT NULL DEFAULT 'reference',
    "lastCrawled" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalEntity" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "description" TEXT,
    "contactInfo" TEXT,
    "websiteUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NistControlExternalEntity" (
    "id" TEXT NOT NULL,
    "nistControlId" TEXT NOT NULL,
    "externalEntityId" TEXT NOT NULL,
    "inheritanceType" TEXT,
    "coverageDetails" TEXT,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NistControlExternalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "refresh_token_expires_in" INTEGER,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "NistVersion_version_key" ON "NistVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "NistVersion_catalogKey_key" ON "NistVersion"("catalogKey");

-- CreateIndex
CREATE INDEX "NistVersion_isActive_idx" ON "NistVersion"("isActive");

-- CreateIndex
CREATE INDEX "NistControl_controlFamilyId_nistVersionId_idx" ON "NistControl"("controlFamilyId", "nistVersionId");

-- CreateIndex
CREATE INDEX "NistControl_controlNumber_idx" ON "NistControl"("controlNumber");

-- CreateIndex
CREATE INDEX "NistControl_parentControlId_idx" ON "NistControl"("parentControlId");

-- CreateIndex
CREATE INDEX "NistControl_nistVersionId_status_idx" ON "NistControl"("nistVersionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NistControl_controlNumber_nistVersionId_key" ON "NistControl"("controlNumber", "nistVersionId");

-- CreateIndex
CREATE INDEX "ControlLineage_controlId_idx" ON "ControlLineage"("controlId");

-- CreateIndex
CREATE INDEX "ControlLineage_relatedControlId_idx" ON "ControlLineage"("relatedControlId");

-- CreateIndex
CREATE INDEX "ControlLineage_relatedPartId_idx" ON "ControlLineage"("relatedPartId");

-- CreateIndex
CREATE INDEX "ControlLineage_nistVersionId_kind_idx" ON "ControlLineage"("nistVersionId", "kind");

-- CreateIndex
CREATE INDEX "ControlPart_nistControlId_idx" ON "ControlPart"("nistControlId");

-- CreateIndex
CREATE INDEX "ControlPart_parentPartId_idx" ON "ControlPart"("parentPartId");

-- CreateIndex
CREATE INDEX "AssessmentObjective_nistControlId_idx" ON "AssessmentObjective"("nistControlId");

-- CreateIndex
CREATE INDEX "AssessmentObjective_partId_idx" ON "AssessmentObjective"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentObjective_cprtIdentifier_nistControlId_key" ON "AssessmentObjective"("cprtIdentifier", "nistControlId");

-- CreateIndex
CREATE INDEX "AssessmentMethod_nistControlId_idx" ON "AssessmentMethod"("nistControlId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentMethod_nistControlId_method_key" ON "AssessmentMethod"("nistControlId", "method");

-- CreateIndex
CREATE INDEX "ControlParameter_nistControlId_idx" ON "ControlParameter"("nistControlId");

-- CreateIndex
CREATE INDEX "ControlParameter_partId_idx" ON "ControlParameter"("partId");

-- CreateIndex
CREATE INDEX "ControlParameterValue_parameterId_idx" ON "ControlParameterValue"("parameterId");

-- CreateIndex
CREATE INDEX "ZTMMGuidance_pillar_functionGroup_idx" ON "ZTMMGuidance"("pillar", "functionGroup");

-- CreateIndex
CREATE UNIQUE INDEX "ZTMMGuidance_pillar_function_key" ON "ZTMMGuidance"("pillar", "function");

-- CreateIndex
CREATE UNIQUE INDEX "ZeroTrustMapping_nistControlId_key" ON "ZeroTrustMapping"("nistControlId");

-- CreateIndex
CREATE INDEX "ZeroTrustMapping_pillars_idx" ON "ZeroTrustMapping" USING GIN ("pillars");

-- CreateIndex
CREATE INDEX "ZeroTrustMapping_maturityLevel_idx" ON "ZeroTrustMapping"("maturityLevel");

-- CreateIndex
CREATE INDEX "ZeroTrustMapping_dataSourceId_idx" ON "ZeroTrustMapping"("dataSourceId");

-- CreateIndex
CREATE INDEX "ZeroTrustMapping_pillars_maturityLevel_idx" ON "ZeroTrustMapping"("pillars", "maturityLevel");

-- CreateIndex
CREATE INDEX "ZTMappingAffinity_ztMappingId_idx" ON "ZTMappingAffinity"("ztMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "ZTMappingAffinity_ztMappingId_pillar_function_maturity_key" ON "ZTMappingAffinity"("ztMappingId", "pillar", "function", "maturity");

-- CreateIndex
CREATE INDEX "NistLink_nistControlId_displayOrder_idx" ON "NistLink"("nistControlId", "displayOrder");

-- CreateIndex
CREATE INDEX "NistLink_dataSourceId_idx" ON "NistLink"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceLink_url_key" ON "ReferenceLink"("url");

-- CreateIndex
CREATE INDEX "ReferenceLink_dataSourceId_idx" ON "ReferenceLink"("dataSourceId");

-- CreateIndex
CREATE INDEX "NistControlLink_linkId_idx" ON "NistControlLink"("linkId");

-- CreateIndex
CREATE INDEX "ZTPartCoverage_partId_idx" ON "ZTPartCoverage"("partId");

-- CreateIndex
CREATE INDEX "ZTPartCoverage_ztMappingId_idx" ON "ZTPartCoverage"("ztMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "ZTPartCoverage_ztMappingId_partId_key" ON "ZTPartCoverage"("ztMappingId", "partId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_name_key" ON "DataSource"("name");

-- CreateIndex
CREATE INDEX "DataSource_authorityLevel_idx" ON "DataSource"("authorityLevel");

-- CreateIndex
CREATE INDEX "DataSource_isActive_idx" ON "DataSource"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalEntity_provider_key" ON "ExternalEntity"("provider");

-- CreateIndex
CREATE INDEX "ExternalEntity_entityType_idx" ON "ExternalEntity"("entityType");

-- CreateIndex
CREATE INDEX "NistControlExternalEntity_nistControlId_idx" ON "NistControlExternalEntity"("nistControlId");

-- CreateIndex
CREATE INDEX "NistControlExternalEntity_externalEntityId_idx" ON "NistControlExternalEntity"("externalEntityId");

-- CreateIndex
CREATE INDEX "NistControlExternalEntity_isRecommended_idx" ON "NistControlExternalEntity"("isRecommended");

-- CreateIndex
CREATE UNIQUE INDEX "NistControlExternalEntity_nistControlId_externalEntityId_key" ON "NistControlExternalEntity"("nistControlId", "externalEntityId");

-- CreateIndex
CREATE INDEX "Post_name_idx" ON "Post"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- AddForeignKey
ALTER TABLE "NistControl" ADD CONSTRAINT "NistControl_controlFamilyId_fkey" FOREIGN KEY ("controlFamilyId") REFERENCES "ControlFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistControl" ADD CONSTRAINT "NistControl_parentControlId_fkey" FOREIGN KEY ("parentControlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistControl" ADD CONSTRAINT "NistControl_nistVersionId_fkey" FOREIGN KEY ("nistVersionId") REFERENCES "NistVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistControl" ADD CONSTRAINT "NistControl_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistControl" ADD CONSTRAINT "NistControl_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLineage" ADD CONSTRAINT "ControlLineage_nistVersionId_fkey" FOREIGN KEY ("nistVersionId") REFERENCES "NistVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLineage" ADD CONSTRAINT "ControlLineage_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLineage" ADD CONSTRAINT "ControlLineage_relatedControlId_fkey" FOREIGN KEY ("relatedControlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLineage" ADD CONSTRAINT "ControlLineage_relatedPartId_fkey" FOREIGN KEY ("relatedPartId") REFERENCES "ControlPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlPart" ADD CONSTRAINT "ControlPart_parentPartId_fkey" FOREIGN KEY ("parentPartId") REFERENCES "ControlPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlPart" ADD CONSTRAINT "ControlPart_nistControlId_fkey" FOREIGN KEY ("nistControlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentObjective" ADD CONSTRAINT "AssessmentObjective_nistControlId_fkey" FOREIGN KEY ("nistControlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentObjective" ADD CONSTRAINT "AssessmentObjective_partId_fkey" FOREIGN KEY ("partId") REFERENCES "ControlPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentMethod" ADD CONSTRAINT "AssessmentMethod_nistControlId_fkey" FOREIGN KEY ("nistControlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlParameter" ADD CONSTRAINT "ControlParameter_nistControlId_fkey" FOREIGN KEY ("nistControlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlParameter" ADD CONSTRAINT "ControlParameter_partId_fkey" FOREIGN KEY ("partId") REFERENCES "ControlPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlParameterValue" ADD CONSTRAINT "ControlParameterValue_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "ControlParameter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZTMMGuidance" ADD CONSTRAINT "ZTMMGuidance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZTMMGuidance" ADD CONSTRAINT "ZTMMGuidance_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZeroTrustMapping" ADD CONSTRAINT "ZeroTrustMapping_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZeroTrustMapping" ADD CONSTRAINT "ZeroTrustMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZeroTrustMapping" ADD CONSTRAINT "ZeroTrustMapping_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZeroTrustMapping" ADD CONSTRAINT "ZeroTrustMapping_nistControlId_fkey" FOREIGN KEY ("nistControlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZTMappingAffinity" ADD CONSTRAINT "ZTMappingAffinity_ztMappingId_fkey" FOREIGN KEY ("ztMappingId") REFERENCES "ZeroTrustMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistLink" ADD CONSTRAINT "NistLink_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistLink" ADD CONSTRAINT "NistLink_nistControlId_fkey" FOREIGN KEY ("nistControlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceLink" ADD CONSTRAINT "ReferenceLink_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistControlLink" ADD CONSTRAINT "NistControlLink_nistControlId_fkey" FOREIGN KEY ("nistControlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistControlLink" ADD CONSTRAINT "NistControlLink_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ReferenceLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZTPartCoverage" ADD CONSTRAINT "ZTPartCoverage_ztMappingId_fkey" FOREIGN KEY ("ztMappingId") REFERENCES "ZeroTrustMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZTPartCoverage" ADD CONSTRAINT "ZTPartCoverage_partId_fkey" FOREIGN KEY ("partId") REFERENCES "ControlPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalEntity" ADD CONSTRAINT "ExternalEntity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalEntity" ADD CONSTRAINT "ExternalEntity_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistControlExternalEntity" ADD CONSTRAINT "NistControlExternalEntity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistControlExternalEntity" ADD CONSTRAINT "NistControlExternalEntity_nistControlId_fkey" FOREIGN KEY ("nistControlId") REFERENCES "NistControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NistControlExternalEntity" ADD CONSTRAINT "NistControlExternalEntity_externalEntityId_fkey" FOREIGN KEY ("externalEntityId") REFERENCES "ExternalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written, beyond what the schema can declare: Prisma emits no NOT NULL for a list
-- column, and the migrations this baseline replaces made ZeroTrustMapping.pillars NOT NULL.
ALTER TABLE "ZeroTrustMapping" ALTER COLUMN "pillars" SET NOT NULL;
