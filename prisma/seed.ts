// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config();

import argon2 from "argon2";
import { PrismaClient } from "../generated/prisma/client";

type AdapterFactory = { new (config: { url: string }): object };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // Convert "file:./lts.db" → absolute path for libsql
  const libsqlUrl = url.startsWith("file:./")
    ? `file:${process.cwd()}/${url.slice(7)}`
    : url;

  // PrismaLibSql is a factory — pass the config object, not a pre-built client
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaLibSql } = require("@prisma/adapter-libsql") as {
    PrismaLibSql: AdapterFactory;
  };

  const adapter = new PrismaLibSql({ url: libsqlUrl });
  const prisma = new PrismaClient({ adapter } as never);

  const passwordHash = await argon2.hash("admin");

  const existing = await (prisma as any).user.findUnique({
    where: { username: "admin" },
  });

  if (existing) {
    console.log("Admin user already exists — skipping seed.");
    await prisma.$disconnect();
    return;
  }

  const admin = await (prisma as any).user.create({
    data: {
      username: "admin",
      email: "admin@localhost",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  console.log(`Seeded admin user: ${admin.username} (${admin.id})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
