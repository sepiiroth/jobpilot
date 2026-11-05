ALTER TABLE "resumes"
  ADD COLUMN "embeddingStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "embeddingProvider" TEXT,
  ADD COLUMN "embeddingModel" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
UPDATE "resumes" SET "embeddingStatus" = 'ready' WHERE embedding IS NOT NULL;
ALTER TABLE "llm_usage"
  ALTER COLUMN "costEstimate" DROP NOT NULL,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'succeeded',
  ADD COLUMN "reservedTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "promptVersion" TEXT;
CREATE INDEX "llm_usage_userId_createdAt_idx" ON "llm_usage" ("userId", "createdAt");
