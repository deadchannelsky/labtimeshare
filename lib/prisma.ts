import { PrismaClient } from "../generated/prisma/client";

// PrismaLibSql is a factory that creates the connection — pass { url } config
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaLibSql } = require("@prisma/adapter-libsql") as {
  PrismaLibSql: new (config: { url: string }) => object;
};

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // Convert "file:./lts.db" → absolute path for libsql
  const libsqlUrl = url.startsWith("file:./")
    ? `file:${process.cwd()}/${url.slice(7)}`
    : url;

  const adapter = new PrismaLibSql({ url: libsqlUrl });
  return new PrismaClient({ adapter } as never);
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
