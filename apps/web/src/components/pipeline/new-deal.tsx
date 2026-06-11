'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { createDeal } from '@/app/(dashboard)/pipeline/actions';
import type { StageOption } from './deal-card';

// Quick-add a deal to the board. A deal can also originate from a conversation
// later; for now this seeds the kanban directly.
export function NewDeal({
  stages,
  contacts,
}: {
  stages: StageOption[];
  contacts: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (contacts.length === 0) {
    return <span className="text-xs text-muted-foreground">Add a contact to create deals.</span>;
  }

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createDeal(formData);
      if (res.ok) setOpen(false);
      else setError(res.error ?? 'Failed to create deal.');
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
      >
        <Plus size={15} /> New deal
      </button>
      {open && (
        <form
          action={onSubmit}
          className="absolute right-0 z-10 mt-2 w-72 space-y-2 rounded-lg border border-border bg-background p-3 shadow-lg"
        >
          <select
            name="contact_id"
            required
            defaultValue=""
            className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Contact…
            </option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            name="stage_id"
            required
            defaultValue={stages[0]?.id ?? ''}
            className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            name="service_label"
            placeholder="Service (optional)"
            className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
          />
          <input
            name="fee_amount"
            type="number"
            step="0.01"
            placeholder="Fee (optional)"
            className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {pending ? 'Adding…' : 'Add deal'}
          </button>
        </form>
      )}
    </div>
  );
}
