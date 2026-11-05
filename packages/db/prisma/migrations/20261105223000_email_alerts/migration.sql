ALTER TABLE job_offers ADD COLUMN "privateUserId" UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX "job_offers_privateUserId_idx" ON job_offers("privateUserId");
CREATE TABLE email_mailboxes (
 id UUID PRIMARY KEY DEFAULT uuidv7(), "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 "accountKey" TEXT NOT NULL,"uidValidity" TEXT NOT NULL,"lastUid" TEXT NOT NULL DEFAULT '0',
 UNIQUE("userId","accountKey","uidValidity")
);
CREATE TABLE email_messages (
 id UUID PRIMARY KEY DEFAULT uuidv7(),"createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
 "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"accountKey" TEXT NOT NULL,
 "uidValidity" TEXT NOT NULL,uid TEXT NOT NULL,status TEXT NOT NULL,"senderKey" TEXT,"errorCode" TEXT,offers JSONB NOT NULL DEFAULT '[]',
 UNIQUE("userId","accountKey","uidValidity",uid)
);
CREATE INDEX "email_messages_userId_accountKey_uidValidity_createdAt_idx" ON email_messages("userId","accountKey","uidValidity","createdAt");
