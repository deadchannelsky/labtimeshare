import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// ─── POST /api/requests/[id]/reveal-key ──────────────────────────────────────
// Returns the SSH private key for the user's ShellGrant.
// The key is retained in the DB so the web terminal can use it for the
// full lifetime of the grant.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Find the AccessRequest and verify it belongs to the current user
  const accessRequest = await prisma.accessRequest.findUnique({
    where: { id },
    include: { shellGrant: true },
  });

  if (!accessRequest || accessRequest.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const shellGrant = accessRequest.shellGrant;
  if (!shellGrant) {
    return NextResponse.json({ error: "No shell grant found" }, { status: 404 });
  }

  return NextResponse.json({
    sshPrivateKey: shellGrant.sshPrivateKey,
    initialPassword: shellGrant.initialPassword ?? null,
    linuxUsername: shellGrant.linuxUsername,
  });
}
