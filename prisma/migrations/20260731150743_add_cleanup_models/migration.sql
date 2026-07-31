-- AlterTable
ALTER TABLE "ShellGrant" ADD COLUMN "autoDeleteAfterDays" INTEGER;
ALTER TABLE "ShellGrant" ADD COLUMN "deleteReason" TEXT;
ALTER TABLE "ShellGrant" ADD COLUMN "deleteScheduledAt" DATETIME;
ALTER TABLE "ShellGrant" ADD COLUMN "deletedAt" DATETIME;

-- CreateTable
CREATE TABLE "AuditLogDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditLogId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLogDetail_auditLogId_fkey" FOREIGN KEY ("auditLogId") REFERENCES "AuditLog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SshKeyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shellGrantId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SshKeyRecord_shellGrantId_fkey" FOREIGN KEY ("shellGrantId") REFERENCES "ShellGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AuditLogDetail_auditLogId_idx" ON "AuditLogDetail"("auditLogId");

-- CreateIndex
CREATE INDEX "SshKeyRecord_shellGrantId_idx" ON "SshKeyRecord"("shellGrantId");

-- CreateIndex
CREATE INDEX "SshKeyRecord_fingerprint_idx" ON "SshKeyRecord"("fingerprint");
