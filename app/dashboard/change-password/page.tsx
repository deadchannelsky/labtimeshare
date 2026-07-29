import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import ChangePasswordForm from "../ChangePasswordForm";
import SignOutButton from "../SignOutButton";

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {process.env.NEXT_PUBLIC_APP_NAME ?? "LabTimeShare"}
            </h1>
            <p className="text-sm text-gray-500">
              Welcome, {session.username}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              ← Back to Dashboard
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-md">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Change Password
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Enter your current password and choose a new one.
          </p>
          <ChangePasswordForm />
        </div>
      </main>
    </div>
  );
}
