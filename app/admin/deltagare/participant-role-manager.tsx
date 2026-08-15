"use client";

import { useState } from "react";
import ParticipantPrivacyActions from "@/app/admin/deltagare/participant-privacy-actions";
import ParticipantIdentityForm from "@/app/admin/deltagare/participant-identity-form";

type Role =
  | "super_admin"
  | "course_admin"
  | "certification_admin"
  | "customer_support"
  | "company_admin"
  | "participant";
type Row = {
  id: string;
  email: string;
  company: string;
  role: Role;
  status: string;
  membershipRole: string;
  privacyUserId: string;
  identityLast4: string | null;
};

const labels: Record<Role, string> = {
  super_admin: "Super Admin",
  course_admin: "Course Admin",
  certification_admin: "Certification Admin",
  customer_support: "Customer Support",
  company_admin: "Company Admin",
  participant: "Participant",
};

export default function ParticipantRoleManager({
  initialRows,
  canManageRoles,
  canManageIdentity,
  canManagePrivacy,
}: {
  initialRows: Row[];
  canManageRoles: boolean;
  canManageIdentity: boolean;
  canManagePrivacy: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function changeRole(row: Row, role: Role) {
    if (role === row.role) return;
    setBusy(row.id);
    setMessage("");
    const response = await fetch(
      `/api/admin/users/${encodeURIComponent(row.id)}/role`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      },
    );
    const data = (await response.json()) as { error?: string };
    setBusy(null);
    if (!response.ok)
      return setMessage(data.error ?? "Rollen kunde inte ändras.");
    setRows((current) =>
      current.map((item) => (item.id === row.id ? { ...item, role } : item)),
    );
    setMessage(`Rollen för ${row.email} ändrades till ${labels[role]}.`);
  }

  return (
    <>
      <div className="admin-table">
        {rows.map((row) => (
          <div className="admin-table-row participant-row" key={row.id}>
            <div>
              <strong>{row.email}</strong>
              <span>{row.company}</span>
            </div>
            {canManageRoles && <select
              aria-label={`Roll för ${row.email}`}
              value={row.role}
              disabled={busy === row.id}
              onChange={(event) =>
                void changeRole(row, event.target.value as Role)
              }
            >
              {Object.entries(labels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>}
            <span>{row.status}</span>
            <span>{row.membershipRole}</span>
            {canManageIdentity && <ParticipantIdentityForm
              userId={row.id}
              identityLast4={row.identityLast4}
            />}
            {canManagePrivacy && <ParticipantPrivacyActions userId={row.privacyUserId} />}
          </div>
        ))}
      </div>
      {message && (
        <p className="admin-message" role="status">
          {message}
        </p>
      )}
    </>
  );
}
