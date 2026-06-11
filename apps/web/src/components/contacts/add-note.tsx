'use client';

import { useRef, useTransition } from 'react';
import { addContactNote } from '@/app/(dashboard)/contacts/actions';

export function AddNote({ contactId }: { contactId: string }) {
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      action={(fd) =>
        start(async () => {
          const r = await addContactNote(fd);
          if (r.ok) ref.current?.reset();
        })
      }
      className="space-y-1.5"
    >
      <input type="hidden" name="contact_id" value={contactId} />
      <textarea
        name="body"
        rows={2}
        placeholder="Add a note (encrypted)…"
        className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
      />
      <button
        disabled={pending}
        className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? 'Adding…' : 'Add note'}
      </button>
    </form>
  );
}
