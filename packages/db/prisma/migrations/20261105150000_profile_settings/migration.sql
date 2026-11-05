ALTER TABLE "user_settings"
  ADD COLUMN "embeddingProvider" TEXT NOT NULL DEFAULT 'openai',
  ADD COLUMN "ollamaBaseUrl" TEXT NOT NULL DEFAULT 'http://localhost:11434',
  ADD COLUMN "imap" JSONB;
