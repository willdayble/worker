'use client';

import { useTransition, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { flagContact, unflagContact } from '@/app/(dashboard)/contacts/actions';

// Dangerous-client flag — ADVISORY ONLY (CONTRACTS §6). Flagging requires a reason
// (audited); clearing is a human-driven false-positive recovery (also audited, M14).
export function FlagControl({
  contactId,
  flagged,
  reason,
}: {
  contactId: string;
  flagged: boolean;
  reason: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (flagged) {
    return (
      <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
          <AlertTriangle size={15} /> Flagged as dangerous (advisory)
        </div>
        {reason && <p className="text-sm text-amber-900">{reason}</p>}
        <form
          action={(fd) =>
            start(async () => {
              const r = await unflagContact(fd);
              if (!r.ok) setError(r.error ?? 'Failed');
            })
          }
          className="space-y-1.5"
        >
          <input type="hidden" name="contact_id" value={contactId} />
          <input
            name="reason"
            placeholder="Reason for clearing (optional, audited)"
            className="w-full rounded border border-amber-300 bg-white px-2 py-1.5 text-sm text-amber-900"
          />
          <button
            disabled={pending}
            className="rounded border border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-800 disabled:opacity-60"
          >
            {pending ? 'Clearing…' : 'Remove flag'}
          </button>
        </form>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <form
      action={(fd) =>
        start(async () => {
          const r = await flagContact(fd);
          if (!r.ok) setError(r.error ?? 'Failed');
        })
      }
      className="space-y-1.5 rounded-md border border-border p-3"
    >
      <input type="hidden" name="contact_id" value={contactId} />
      <input
        name="reason"
        required
        placeholder="Reason (required, encrypted + audited)"
        className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
      />
      <button
        disabled={pending}
        className="flex items-center gap-1.5 rounded border border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-700 disabled:opacity-60"
      >
        <AlertTriangle size={14} /> {pending ? 'Flagging…' : 'Flag as dangerous'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-[11px] text-muted-foreground">
        Advisory only — never auto-blocks. Flag/unflag are recorded in an append-only audit.
      </p>
    </form>
  );
}
