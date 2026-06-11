'use client';

import { useTransition, useState } from 'react';
import { updateScreening } from '@/app/(dashboard)/contacts/actions';

export function ScreeningForm({
  contactId,
  depositPaid,
  depositAmount,
  idVerified,
  references,
  notes,
}: {
  contactId: string;
  depositPaid: boolean;
  depositAmount: number | null;
  idVerified: boolean;
  references: boolean;
  notes: string;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        start(async () => {
          const r = await updateScreening(fd);
          setStatus(r.ok ? 'Saved ✓' : (r.error ?? 'Failed'));
        })
      }
      className="space-y-2"
    >
      <input type="hidden" name="contact_id" value={contactId} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="deposit_paid" defaultChecked={depositPaid} />
        Deposit paid
        <input
          name="deposit_amount"
          type="number"
          step="0.01"
          defaultValue={depositAmount ?? ''}
          placeholder="amount"
          className="ml-auto w-24 rounded border border-border bg-transparent px-2 py-1 text-xs"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="id_verified" defaultChecked={idVerified} />
        ID verified
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="references_provided" defaultChecked={references} />
        References provided
      </label>
      <textarea
        name="screening_notes"
        rows={2}
        defaultValue={notes}
        placeholder="Screening notes (encrypted)"
        className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
      />
      <div className="flex items-center gap-2">
        <button
          disabled={pending}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save screening'}
        </button>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>
    </form>
  );
}
