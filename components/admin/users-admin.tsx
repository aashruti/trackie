"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  createUserAction,
  setUserAccountsAction,
  setUserRolesAction,
  deleteUserAction,
  resetUserPasswordAction,
  signOutUserEverywhereAction,
} from "@/app/(app)/admin/users/actions";
import type { Role } from "@/lib/db/enums";
import type { UserRow } from "@/lib/dal/user-admin";

const ROLES: Role[] = ["super-admin", "sales", "hr", "delivery", "viewer"];
const ROLE_TONE: Record<Role, string> = {
  "super-admin": "info",
  sales: "pending",
  hr: "positive",
  delivery: "info",
  viewer: "neutral",
};
// Account-scoped roles — these are the ones scopeAccountIds actually reads
// assignments for (finance for sales, delivery module for delivery). Pure
// super-admin/hr/viewer never needs the account-assignment picker.
const SCOPED_ROLES: Role[] = ["sales", "delivery"];

interface AccountOption {
  id: number;
  name: string;
}

export function UsersAdmin({
  users,
  accounts,
  currentUserId,
}: {
  users: UserRow[];
  accounts: AccountOption[];
  currentUserId: number;
}) {
  return (
    <div className="space-y-5">
      <CreateUser />
      <div className="space-y-3">
        {users.map((u) => (
          <UserCard key={u.id} user={u} accounts={accounts} self={u.id === currentUserId} />
        ))}
      </div>
    </div>
  );
}

const inputCls =
  "rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

function CreateUser() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<Set<Role>>(new Set(["sales"]));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(r: Role) {
    setRoles((p) => {
      const n = new Set(p);
      if (n.has(r)) n.delete(r);
      else n.add(r);
      return n;
    });
  }

  function submit() {
    setError(null);
    setMsg(null);
    if (roles.size === 0) {
      setError("Pick at least one role");
      return;
    }
    startTransition(async () => {
      try {
        await createUserAction({ name, email, password, roles: [...roles] });
        setMsg(`Created ${email}`);
        setName("");
        setEmail("");
        setPassword("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create user");
      }
    });
  }

  return (
    <Card>
      <CardHeader title="Add user" subtitle="Create a team member and set their roles" />
      <div className="flex flex-wrap items-end gap-3 p-5">
        <label className="block">
          <span className="text-[11px] text-text-muted">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 block ${inputCls}`} />
        </label>
        <label className="block">
          <span className="text-[11px] text-text-muted">Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={`mt-1 block ${inputCls}`} />
        </label>
        <label className="block">
          <span className="text-[11px] text-text-muted">Password</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" placeholder="min 6 chars" className={`mt-1 block ${inputCls}`} />
        </label>
        <div className="block">
          <span className="text-[11px] text-text-muted">Roles</span>
          <div className="mt-1 flex flex-wrap gap-3 rounded-md border border-border-strong bg-surface px-3 py-2">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1.5 text-sm text-text-secondary">
                <input type="checkbox" checked={roles.has(r)} onChange={() => toggleRole(r)} />
                {r}
              </label>
            ))}
          </div>
        </div>
        <button onClick={submit} disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
          {pending ? "Creating…" : "Create user"}
        </button>
        {msg && <span className="text-xs text-[var(--positive-text)]">{msg}</span>}
        {error && <span className="text-xs text-[var(--negative-text)]">{error}</span>}
      </div>
    </Card>
  );
}

function UserCard({ user, accounts, self }: { user: UserRow; accounts: AccountOption[]; self: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set(user.assignedAccountIds));
  const [rolesOpen, setRolesOpen] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<Set<Role>>(new Set(user.roles));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pwDone, setPwDone] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Account-scoped roles (sales, delivery) are the ones the assignment
  // picker below actually matters for — a pure super-admin/hr/viewer set
  // never reads user_accounts.
  const scoped = user.roles.some((r) => SCOPED_ROLES.includes(r));

  function toggle(id: number) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function saveAssignments() {
    setError(null);
    startTransition(async () => {
      try {
        await setUserAccountsAction(user.id, [...selected]);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  function toggleRole(role: Role) {
    setSelectedRoles((p) => {
      const n = new Set(p);
      if (n.has(role)) n.delete(role);
      else n.add(role);
      return n;
    });
  }

  function saveRoles() {
    setError(null);
    if (selectedRoles.size === 0) {
      setError("Pick at least one role");
      return;
    }
    startTransition(async () => {
      const res = await setUserRolesAction(user.id, [...selectedRoles]);
      if (res.ok) {
        setRolesOpen(false);
      } else {
        setError(res.error);
        // A rejected change (empty set / last super-admin) wasn't saved —
        // snap the checkboxes back to what's actually persisted.
        setSelectedRoles(new Set(user.roles));
      }
    });
  }

  function remove() {
    if (!confirm(`Delete ${user.email}?`)) return;
    startTransition(async () => {
      try {
        await deleteUserAction(user.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  function resetPassword() {
    setError(null);
    setPwDone(false);
    startTransition(async () => {
      const res = await resetUserPasswordAction(user.id, pw);
      if (res.ok) {
        setPwDone(true);
        setPw("");
      } else {
        setError(res.error);
      }
    });
  }

  function signOutEverywhere() {
    if (!confirm(`Sign ${user.name} out of every device? They'll need to sign in again.`)) return;
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await signOutUserEverywhereAction(user.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Say what happened. Ending zero sessions is a real, useful answer — it
      // means they were not signed in anywhere — and without this the button
      // looks broken in exactly that case.
      setPwDone(false);
      setNote(
        res.ended === 0
          ? `${user.name} wasn't signed in anywhere.`
          : `Signed ${user.name} out of ${res.ended} session${res.ended === 1 ? "" : "s"}.`,
      );
    });
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-text-primary">{user.name}</span>
            {user.roles.map((r) => <Badge key={r} tone={ROLE_TONE[r]}>{r}</Badge>)}
            {self && <span className="text-[11px] text-text-muted">(you)</span>}
          </div>
          <div className="text-xs text-text-muted">{user.email}</div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => { setSelectedRoles(new Set(user.roles)); setRolesOpen((o) => !o); }}
            disabled={pending || self}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
            title={self ? "You can't change your own roles" : "Edit roles"}
          >
            Edit roles
          </button>
          {scoped && (
            <button onClick={() => setOpen((o) => !o)} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">
              Assign accounts ({user.assignedAccountIds.length})
            </button>
          )}
          {!self && (
            <button
              onClick={() => { setPwOpen((o) => !o); setPwDone(false); }}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
            >
              Reset password
            </button>
          )}
          <button
            onClick={signOutEverywhere}
            disabled={pending}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
          >
            Sign out everywhere
          </button>
          {!self && (
            <button onClick={remove} disabled={pending} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-[var(--negative-text)] hover:bg-surface-hover">
              Delete
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-[var(--negative-text)]">{error}</p>}
      {note && <p className="mt-2 text-xs text-[var(--positive-text)]">{note}</p>}

      {rolesOpen && !self && (
        <div className="mt-4 rounded-lg border border-border bg-surface-sunken p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Roles ({selectedRoles.size})
          </div>
          <div className="flex flex-wrap gap-3">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-surface-hover">
                <input type="checkbox" checked={selectedRoles.has(r)} onChange={() => toggleRole(r)} />
                <span className="text-text-secondary">{r}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => { setRolesOpen(false); setSelectedRoles(new Set(user.roles)); }} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">Cancel</button>
            <button onClick={saveRoles} disabled={pending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
              {pending ? "Saving…" : "Save roles"}
            </button>
          </div>
        </div>
      )}

      {open && scoped && (
        <div className="mt-4 rounded-lg border border-border bg-surface-sunken p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Assigned accounts ({selected.size})
            </span>
            <div className="flex gap-2">
              <button onClick={() => setSelected(new Set(accounts.map((a) => a.id)))} className="text-xs text-[var(--primary-text)] hover:underline">All</button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-text-muted hover:underline">None</button>
            </div>
          </div>
          <div className="grid max-h-64 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-hover">
                <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                <span className="truncate text-text-secondary">{a.name}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">Cancel</button>
            <button onClick={saveAssignments} disabled={pending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
              {pending ? "Saving…" : "Save assignments"}
            </button>
          </div>
        </div>
      )}

      {pwOpen && !self && (
        <div className="mt-4 rounded-lg border border-border bg-surface-sunken p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Reset password for {user.email}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Deliberately type="text": this is not your own secret, it is a value
                you must read and pass on. Masking it invites transcription typos. */}
            <input
              type="text"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="New password (min 8 characters)"
              className={`${inputCls} flex-1 py-1.5`}
            />
            <button
              onClick={resetPassword}
              disabled={pending || pw.length < 8}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Set password"}
            </button>
            <button
              onClick={() => { setPwOpen(false); setPw(""); }}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
          {pwDone && (
            <p className="mt-2 text-xs text-[var(--positive-text)]">
              Password updated and {user.name} is signed out everywhere. Send them the new password — this is the only time it is shown.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
