import { cookies } from "next/headers";
import { verifyJwt, type SessionPayload } from "./auth";

const COOKIE_NAME = "lts-session";

export async function getSession(
  request?: Request
): Promise<SessionPayload | null> {
  let token: string | undefined;

  if (request) {
    // Called from API route — read from the incoming request headers
    const cookieHeader = request.headers.get("cookie") ?? "";
    const match = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    token = match ? match.slice(COOKIE_NAME.length + 1) : undefined;
  } else {
    // Called from a server component — use next/headers
    const jar = await cookies();
    token = jar.get(COOKIE_NAME)?.value;
  }

  if (!token) return null;
  return verifyJwt(token);
}
