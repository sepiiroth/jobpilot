-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'fr',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_secrets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "user_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "llmProvider" TEXT NOT NULL,
    "generationModel" TEXT NOT NULL,
    "scoringModel" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "collectionCron" TEXT,
    "collectionCooldownMin" INTEGER NOT NULL DEFAULT 30,
    "userId" UUID NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resumes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "userId" UUID NOT NULL,

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "searches" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "titles" TEXT[],
    "includeKeywords" TEXT[],
    "excludeKeywords" TEXT[],
    "locations" JSONB NOT NULL,
    "radiusKm" INTEGER,
    "remote" TEXT[],
    "contractTypes" TEXT[],
    "salaryMin" DECIMAL(65,30),
    "seniority" TEXT,
    "sources" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" UUID NOT NULL,

    CONSTRAINT "searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_companies" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "atsType" TEXT NOT NULL,
    "atsToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "tracked_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alternateUrls" TEXT[],
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" JSONB NOT NULL,
    "remote" TEXT NOT NULL,
    "contractType" TEXT NOT NULL,
    "salaryMin" DECIMAL(65,30),
    "salaryMax" DECIMAL(65,30),
    "salaryCurrency" TEXT,
    "description" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ,
    "fetchedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_job_matches" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobOfferId" UUID NOT NULL,
    "searchId" UUID NOT NULL,
    "hardFilterPassed" BOOLEAN NOT NULL,
    "similarity" DOUBLE PRECISION,
    "llmScore" INTEGER,
    "llmAnalysis" JSONB,
    "status" TEXT NOT NULL DEFAULT 'new',
    "userId" UUID NOT NULL,

    CONSTRAINT "user_job_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "userId" UUID NOT NULL,

    CONSTRAINT "collection_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobOfferId" UUID NOT NULL,
    "resumeId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "params" JSONB NOT NULL,
    "integrityReport" JSONB,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobOfferId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'to_apply',
    "appliedAt" TIMESTAMPTZ,
    "followUpAt" TIMESTAMPTZ,
    "notes" TEXT,
    "resumeDocId" UUID,
    "letterDocId" UUID,
    "userId" UUID NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "costEstimate" DECIMAL(18,8) NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "llm_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "ip" TEXT,
    "userId" UUID NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_userId_id_key" ON "sessions"("userId", "id");

-- CreateIndex
CREATE INDEX "user_secrets_userId_idx" ON "user_secrets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_secrets_userId_kind_key" ON "user_secrets"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "user_secrets_userId_id_key" ON "user_secrets"("userId", "id");

-- CreateIndex
CREATE INDEX "user_settings_userId_idx" ON "user_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_id_key" ON "user_settings"("userId", "id");

-- CreateIndex
CREATE INDEX "resumes_userId_idx" ON "resumes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "resumes_userId_id_key" ON "resumes"("userId", "id");

-- CreateIndex
CREATE INDEX "searches_userId_idx" ON "searches"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "searches_userId_id_key" ON "searches"("userId", "id");

-- CreateIndex
CREATE INDEX "tracked_companies_userId_idx" ON "tracked_companies"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_companies_userId_atsType_atsToken_key" ON "tracked_companies"("userId", "atsType", "atsToken");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_companies_userId_id_key" ON "tracked_companies"("userId", "id");

-- CreateIndex
CREATE INDEX "job_offers_dedupKey_fetchedAt_idx" ON "job_offers"("dedupKey", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_offers_sourceId_externalId_key" ON "job_offers"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "user_job_matches_userId_idx" ON "user_job_matches"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_job_matches_userId_jobOfferId_key" ON "user_job_matches"("userId", "jobOfferId");

-- CreateIndex
CREATE UNIQUE INDEX "user_job_matches_userId_id_key" ON "user_job_matches"("userId", "id");

-- CreateIndex
CREATE INDEX "collection_runs_userId_idx" ON "collection_runs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_runs_userId_id_key" ON "collection_runs"("userId", "id");

-- CreateIndex
CREATE INDEX "generated_documents_userId_idx" ON "generated_documents"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_userId_jobOfferId_resumeId_kind_version_key" ON "generated_documents"("userId", "jobOfferId", "resumeId", "kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_userId_id_key" ON "generated_documents"("userId", "id");

-- CreateIndex
CREATE INDEX "applications_userId_idx" ON "applications"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "applications_userId_jobOfferId_key" ON "applications"("userId", "jobOfferId");

-- CreateIndex
CREATE UNIQUE INDEX "applications_userId_id_key" ON "applications"("userId", "id");

-- CreateIndex
CREATE INDEX "llm_usage_userId_idx" ON "llm_usage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "llm_usage_userId_id_key" ON "llm_usage"("userId", "id");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_userId_id_key" ON "audit_logs"("userId", "id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_secrets" ADD CONSTRAINT "user_secrets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "searches" ADD CONSTRAINT "searches_userId_resumeId_fkey" FOREIGN KEY ("userId", "resumeId") REFERENCES "resumes"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "searches" ADD CONSTRAINT "searches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_companies" ADD CONSTRAINT "tracked_companies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_job_matches" ADD CONSTRAINT "user_job_matches_jobOfferId_fkey" FOREIGN KEY ("jobOfferId") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_job_matches" ADD CONSTRAINT "user_job_matches_userId_searchId_fkey" FOREIGN KEY ("userId", "searchId") REFERENCES "searches"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_job_matches" ADD CONSTRAINT "user_job_matches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_jobOfferId_fkey" FOREIGN KEY ("jobOfferId") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_userId_resumeId_fkey" FOREIGN KEY ("userId", "resumeId") REFERENCES "resumes"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_userId_letterDocId_fkey" FOREIGN KEY ("userId", "letterDocId") REFERENCES "generated_documents"("userId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_userId_resumeDocId_fkey" FOREIGN KEY ("userId", "resumeDocId") REFERENCES "generated_documents"("userId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_jobOfferId_fkey" FOREIGN KEY ("jobOfferId") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

