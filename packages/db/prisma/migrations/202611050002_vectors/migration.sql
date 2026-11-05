CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE resumes ADD COLUMN embedding vector(1024);
ALTER TABLE job_offers ADD COLUMN embedding vector(1024);
CREATE INDEX resumes_embedding_hnsw ON resumes USING hnsw (embedding vector_cosine_ops);
CREATE INDEX job_offers_embedding_hnsw ON job_offers USING hnsw (embedding vector_cosine_ops);
ALTER TABLE user_job_matches ADD CONSTRAINT score_range CHECK ("llmScore" BETWEEN 0 AND 100);
ALTER TABLE generated_documents ADD CONSTRAINT document_version_positive CHECK (version > 0);
ALTER TABLE searches ADD CONSTRAINT search_radius_nonnegative CHECK ("radiusKm" >= 0);
CREATE UNIQUE INDEX collection_runs_one_active_per_user ON collection_runs ("userId") WHERE status IN ('queued','running');
