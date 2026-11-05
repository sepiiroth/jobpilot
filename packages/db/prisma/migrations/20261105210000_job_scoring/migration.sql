ALTER TABLE collection_runs ADD COLUMN stage TEXT NOT NULL DEFAULT 'collection';
CREATE TABLE scoring_tasks (
 id UUID PRIMARY KEY DEFAULT uuidv7(), "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 "runId" UUID NOT NULL, "searchId" UUID NOT NULL, fingerprint TEXT NOT NULL, budget INTEGER NOT NULL CHECK (budget BETWEEN 0 AND 100),
 "attemptedIds" TEXT[] NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
 UNIQUE("runId","searchId"), FOREIGN KEY("userId","runId") REFERENCES collection_runs("userId",id) ON DELETE CASCADE
);
CREATE INDEX "scoring_tasks_userId_idx" ON scoring_tasks("userId");
CREATE TABLE search_matches (
 id UUID PRIMARY KEY DEFAULT uuidv7(), "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 "searchId" UUID NOT NULL, "jobOfferId" UUID NOT NULL REFERENCES job_offers(id) ON DELETE CASCADE,
 "runId" UUID NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "inputKey" TEXT NOT NULL,
 passed BOOLEAN NOT NULL, notes TEXT[] NOT NULL, similarity DOUBLE PRECISION, "llmScore" INTEGER CHECK("llmScore" BETWEEN 0 AND 100), "llmAnalysis" JSONB, state TEXT NOT NULL DEFAULT 'waiting',
 UNIQUE("userId","searchId","jobOfferId"),
 FOREIGN KEY("userId","searchId") REFERENCES searches("userId",id) ON DELETE CASCADE,
 FOREIGN KEY("userId","runId") REFERENCES collection_runs("userId",id) ON DELETE CASCADE
);
CREATE INDEX "search_matches_userId_passed_llmScore_idx" ON search_matches("userId",passed,"llmScore");
