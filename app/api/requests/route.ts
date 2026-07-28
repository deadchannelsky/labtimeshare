import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// ─── GET /api/requests ────────────────────────────────────────────────────────
// Returns the current user's AccessRequests with nested grants, newest first.

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requests = await prisma.accessRequest.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    include: {
      apiKeyGrant: true,
      shellGrant: true,
    },
  });

  return NextResponse.json(requests);
}

// ─── POST /api/requests ───────────────────────────────────────────────────────
// Creates a new PENDING AccessRequest for the current user.

const CreateRequestSchema = z.object({
  path: z.enum(["API_KEY", "SHELL_ACCESS"]),
  requestedDurationHours: z
    .number()
    .int()
    .min(1, "Minimum duration is 1 hour")
    .max(168, "Maximum duration is 168 hours (1 week)"),
});

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Validation error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { path, requestedDurationHours } = parsed.data;

  // Check for an existing PENDING or APPROVED (active) request for the same path
  const existing = await prisma.accessRequest.findFirst({
    where: {
      userId: session.userId,
      path,
      status: { in: ["PENDING", "APPROVED"] },
    },
  });

  if (existing) {
    return NextResponse.json(
      {
        error:
          "You already have a pending or active request for this access path.",
      },
      { status: 409 }
    );
  }

  const newRequest = await prisma.accessRequest.create({
    data: {
      userId: session.userId,
      path,
      requestedDurationHours,
      status: "PENDING",
    },
  });

  return NextResponse.json(newRequest, { status: 201 });
}
