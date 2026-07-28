import AuditLogClient from "./AuditLogClient";

export default function AuditLogPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Audit Log</h2>
        <p className="text-sm text-gray-500">
          All provisioning, revocation, and admin actions — newest first.
        </p>
      </div>
      <AuditLogClient />
    </div>
  );
}
