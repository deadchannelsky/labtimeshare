import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// ─── POST /api/requests/[id]/reveal-key ──────────────────────────────────────
// Returns the SSH private key for the user's ShellGrant (one-time only),
// then NULLs it out in the DB so it cannot be retrieved again.

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

  // Already revealed — key was nulled out
  if (!shellGrant.sshPrivateKey) {
    return NextResponse.json(
      { error: "SSH key has already been revealed and cannot be shown again." },
      { status: 404 }
    );
  }

  const keyToReturn = shellGrant.sshPrivateKey;

  // Null out the private key — one-time reveal
  await prisma.shellGrant.update({
    where: { id: shellGrant.id },
    data: { sshPrivateKey: null },
  });

  return NextResponse.json({ sshPrivateKey: keyToReturn });
}
