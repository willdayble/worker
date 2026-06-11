'use client';

import { useTransition, useState } from 'react';
import { updateProfile } from '@/app/(dashboard)/contacts/actions';

const AGE_GROUPS = ['18-24', '25-35', '36-50', '50s-60s', '70+'];

export function ProfileForm({
  contactId,
  displayName,
  ageGroup,
  rating,
}: {
  contactId: string;
  displayName: string;
  ageGroup: string | null;
  rating: number | null;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        start(async () => {
          const r = await updateProfile(fd);
          setStatus(r.ok ? 'Saved ✓' : (r.error ?? 'Failed'));
        })
      }
      className="space-y-2"
    >
      <input type="hidden" name="contact_id" value={contactId} />
      <label className="block text-xs text-muted-foreground">Name</label>
      <input
        name="display_name"
        defaultValue={displayName}
        className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs text-muted-foreground">Age group</label>
          <select
            name="age_group"
            defaultValue={ageGroup ?? ''}
            className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {AGE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-muted-foreground">Rating</label>
          <select
            name="star_rating"
            defaultValue={rating ?? ''}
            className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                {'★'.repeat(r)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          disabled={pending}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>
    </form>
  );
}
