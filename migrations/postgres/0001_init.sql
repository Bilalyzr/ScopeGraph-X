-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'eu-central',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "authorizationRef" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeVersion" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rulesJson" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "provenance" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "proposedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "canonicalLocator" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "scopeState" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "authorizationNote" TEXT NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetObservation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AssetObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "budgetJson" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "emergencyStoppedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "requestJson" TEXT NOT NULL DEFAULT '{}',
    "resultJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Identity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "programId" TEXT,
    "roleLabel" TEXT NOT NULL,
    "tenantLabel" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'RESEARCHER_OWNED',
    "secretRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "routeTemplate" TEXT NOT NULL,
    "schemaRef" TEXT,
    "normalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "fixtureRef" TEXT,
    "ownerIdentityId" TEXT,
    "invariantJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "observationId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "policyContext" TEXT NOT NULL DEFAULT '',
    "derivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hypothesis" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "programId" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'AI',
    "category" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "assumptionsJson" TEXT NOT NULL DEFAULT '[]',
    "evidenceRefsJson" TEXT NOT NULL DEFAULT '[]',
    "risk" TEXT NOT NULL DEFAULT '',
    "proposedValidation" TEXT NOT NULL DEFAULT '',
    "requiredApprovalsJson" TEXT NOT NULL DEFAULT '[]',
    "expectedOutcome" TEXT NOT NULL DEFAULT '',
    "alternativeExplanationsJson" TEXT NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "limitations" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "modelVersion" TEXT NOT NULL DEFAULT 'mock-provider-1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "hypothesisId" TEXT,
    "orgId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "oracleId" TEXT NOT NULL DEFAULT '',
    "policyVersionId" TEXT,
    "approvalId" TEXT,
    "planJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "proposedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "evidenceId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizedJson" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "assetId" TEXT,
    "hypothesisId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "expectedBehavior" TEXT NOT NULL DEFAULT '',
    "observedBehavior" TEXT NOT NULL DEFAULT '',
    "reproductionJson" TEXT NOT NULL DEFAULT '[]',
    "impact" TEXT NOT NULL DEFAULT '',
    "limitations" TEXT NOT NULL DEFAULT '',
    "remediation" TEXT NOT NULL DEFAULT '',
    "validationStatus" TEXT NOT NULL DEFAULT 'UNVALIDATED',
    "assignedTo" TEXT,
    "validatedBy" TEXT,
    "policyVersionId" TEXT,
    "sourceDetector" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingStatusEvent" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingEvidence" (
    "findingId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "FindingEvidence_pkey" PRIMARY KEY ("findingId","evidenceId")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "encryptedObjectUri" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/json',
    "sensitivity" TEXT NOT NULL DEFAULT 'INTERNAL',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "redactionStatus" TEXT NOT NULL DEFAULT 'REDACTED',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "findingCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "requestRef" TEXT NOT NULL DEFAULT '',
    "prevDigest" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "key" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBodyJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "programId" TEXT,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL DEFAULT '',
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyStop" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "orgId" TEXT,
    "programId" TEXT,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "EmergencyStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EgressCheck" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "jobRef" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EgressCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMfa" (
    "userId" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "UserMfa_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AssetSnapshot" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "contentJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetChange" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "diffKind" TEXT NOT NULL,
    "beforeJson" TEXT NOT NULL DEFAULT '{}',
    "afterJson" TEXT NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedBy" TEXT,

    CONSTRAINT "AssetChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvariantRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "transitionsJson" TEXT NOT NULL DEFAULT '[]',
    "violationsJson" TEXT NOT NULL DEFAULT '[]',
    "evidenceId" TEXT,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvariantRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalFinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "assetId" TEXT,
    "tool" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "locator" TEXT NOT NULL DEFAULT '',
    "cwe" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT NOT NULL DEFAULT '',
    "evidenceId" TEXT,
    "correlatedFindingId" TEXT,
    "correlationStatus" TEXT NOT NULL DEFAULT 'UNCORRELATED',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "eventsJson" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "timestampMs" BIGINT NOT NULL,
    "nonce" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_principalId_key" ON "Membership"("orgId", "principalId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Program_orgId_idx" ON "Program"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Program_orgId_provider_handle_key" ON "Program"("orgId", "provider", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeVersion_programId_version_key" ON "ScopeVersion"("programId", "version");

-- CreateIndex
CREATE INDEX "Asset_orgId_scopeState_idx" ON "Asset"("orgId", "scopeState");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_programId_canonicalLocator_assetType_key" ON "Asset"("programId", "canonicalLocator", "assetType");

-- CreateIndex
CREATE INDEX "AssetObservation_assetId_observedAt_idx" ON "AssetObservation"("assetId", "observedAt");

-- CreateIndex
CREATE INDEX "Campaign_programId_state_idx" ON "Campaign"("programId", "state");

-- CreateIndex
CREATE INDEX "Campaign_orgId_idx" ON "Campaign"("orgId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Job_campaignId_idempotencyKey_key" ON "Job"("campaignId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Endpoint_assetId_method_routeTemplate_key" ON "Endpoint"("assetId", "method", "routeTemplate");

-- CreateIndex
CREATE INDEX "GraphEdge_sourceType_sourceId_relation_idx" ON "GraphEdge"("sourceType", "sourceId", "relation");

-- CreateIndex
CREATE INDEX "GraphEdge_targetType_targetId_relation_idx" ON "GraphEdge"("targetType", "targetId", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "GraphEdge_sourceType_sourceId_relation_targetType_targetId_key" ON "GraphEdge"("sourceType", "sourceId", "relation", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "Hypothesis_programId_status_idx" ON "Hypothesis"("programId", "status");

-- CreateIndex
CREATE INDEX "Test_programId_status_idx" ON "Test"("programId", "status");

-- CreateIndex
CREATE INDEX "Finding_orgId_status_idx" ON "Finding"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_programId_fingerprint_key" ON "Finding"("programId", "fingerprint");

-- CreateIndex
CREATE INDEX "FindingStatusEvent_findingId_idx" ON "FindingStatusEvent"("findingId");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_orgId_sha256_key" ON "Evidence"("orgId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_id_key" ON "AuditEvent"("id");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_timestamp_idx" ON "AuditEvent"("orgId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "EgressCheck_orgId_decision_idx" ON "EgressCheck"("orgId", "decision");

-- CreateIndex
CREATE INDEX "AssetSnapshot_assetId_createdAt_idx" ON "AssetSnapshot"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetChange_orgId_observedAt_idx" ON "AssetChange"("orgId", "observedAt");

-- CreateIndex
CREATE INDEX "AssetChange_programId_idx" ON "AssetChange"("programId");

-- CreateIndex
CREATE INDEX "InvariantRun_programId_ranAt_idx" ON "InvariantRun"("programId", "ranAt");

-- CreateIndex
CREATE INDEX "ExternalFinding_programId_tool_idx" ON "ExternalFinding"("programId", "tool");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_orgId_idx" ON "WebhookEndpoint"("orgId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MfaChallenge_userId_idx" ON "MfaChallenge"("userId");

-- AddForeignKey
ALTER TABLE "ScopeVersion" ADD CONSTRAINT "ScopeVersion_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetObservation" ADD CONSTRAINT "AssetObservation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingEvidence" ADD CONSTRAINT "FindingEvidence_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

