ALTER TABLE collection_runs ADD COLUMN "enqueuedAt" TIMESTAMPTZ, ADD COLUMN "heartbeatAt" TIMESTAMPTZ, ADD COLUMN "workerToken" UUID;
CREATE UNIQUE INDEX collection_one_active_user ON collection_runs("userId") WHERE status IN ('queued','running');
ALTER TABLE job_offers ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';
CREATE TABLE collection_steps (
 id UUID PRIMARY KEY DEFAULT uuidv7(), "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 "runId" UUID NOT NULL, "searchId" UUID NOT NULL, source TEXT NOT NULL, criteria JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', errors JSONB NOT NULL DEFAULT '[]',
 UNIQUE("userId",id), UNIQUE("runId","searchId",source), FOREIGN KEY("userId","runId") REFERENCES collection_runs("userId",id) ON DELETE CASCADE
);
CREATE TABLE collection_items (
 id UUID PRIMARY KEY DEFAULT uuidv7(), "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 "runId" UUID NOT NULL, "stepId" UUID NOT NULL, "externalId" TEXT NOT NULL,
 "jobOfferId" UUID NOT NULL REFERENCES job_offers(id) ON DELETE CASCADE, "isNew" BOOLEAN NOT NULL,
 UNIQUE("stepId","externalId"), FOREIGN KEY("userId","runId") REFERENCES collection_runs("userId",id) ON DELETE CASCADE,
 FOREIGN KEY("userId","stepId") REFERENCES collection_steps("userId",id) ON DELETE CASCADE
);
CREATE INDEX "collection_items_userId_runId_idx" ON collection_items("userId","runId");
CREATE TABLE job_offer_aliases ("sourceId" TEXT NOT NULL,"externalId" TEXT NOT NULL,"jobOfferId" UUID NOT NULL REFERENCES job_offers(id) ON DELETE CASCADE,PRIMARY KEY("sourceId","externalId"));
CREATE TABLE offer_embeddings (
 id UUID PRIMARY KEY DEFAULT uuidv7(), "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 "jobOfferId" UUID NOT NULL REFERENCES job_offers(id) ON DELETE CASCADE, "profileKey" TEXT NOT NULL,
 "contentHash" TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', embedding vector(1024),
 UNIQUE("userId","jobOfferId","profileKey","contentHash")
);
CREATE INDEX "offer_embeddings_userId_status_idx" ON offer_embeddings("userId",status);
CREATE INDEX offer_embeddings_hnsw ON offer_embeddings USING hnsw (embedding vector_cosine_ops);
