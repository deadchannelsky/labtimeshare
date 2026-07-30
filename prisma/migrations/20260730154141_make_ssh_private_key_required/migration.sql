/*
  Warnings:

  - Made the column `sshPrivateKey` on table `ShellGrant` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShellGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "linuxUsername" TEXT NOT NULL,
    "sshPublicKey" TEXT NOT NULL,
    "sshPrivateKey" TEXT NOT NULL,
    "initialPassword" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "ShellGrant_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AccessRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ShellGrant" ("createdAt", "id", "initialPassword", "isActive", "linuxUsername", "requestId", "revokedAt", "sshPrivateKey", "sshPublicKey") SELECT "createdAt", "id", "initialPassword", "isActive", "linuxUsername", "requestId", "revokedAt", "sshPrivateKey", "sshPublicKey" FROM "ShellGrant";
DROP TABLE "ShellGrant";
ALTER TABLE "new_ShellGrant" RENAME TO "ShellGrant";
CREATE UNIQUE INDEX "ShellGrant_requestId_key" ON "ShellGrant"("requestId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
