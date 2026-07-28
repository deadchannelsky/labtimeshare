"use client";

import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-sm text-gray-600 border border-gray-300 px-3 py-2 rounded-md hover:bg-gray-100 transition-colors"
    >
      Sign Out
    </button>
  );
}
