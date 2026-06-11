'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { moveDeal, closeDeal } from '@/app/(dashboard)/pipeline/actions';

export interface StageOption {
  id: string;
  name: string;
}
export interface DealCardData {
  id: string;
  stageId: string;
  contactName: string;
  serviceLabel: string | null;
  feeAmount: number;
  scheduledDate: string | null;
}

const LOST_REASONS: Array<{ value: string; label: string }> = [
  { value: 'time_waster', label: 'Time-waster' },
  { value: 'dangerous', label: 'Dangerous client' },
  { value: 'ghosted', label: 'Ghosted' },
  { value: 'price', label: 'Price' },
  { value: 'scheduling', label: 'Scheduling' },
  { value: 'other', label: 'Other' },
];

export function DealCard({ deal, stages }: { deal: DealCardData; stages: StageOption[] }) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'idle' | 'won' | 'lost'>('idle');

  return (
    <div className="rounded-md border border-border bg-background p-2.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{deal.contactName}</span>
        {deal.feeAmount > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">${deal.feeAmount.toFixed(0)}</span>
        )}
      </div>
      {deal.serviceLabel && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{deal.serviceLabel}</p>
      )}
      {deal.scheduledDate && (
        <p className="mt-0.5 text-xs text-muted-foreground">{deal.scheduledDate}</p>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <select
          aria-label="Move to stage"
          value={deal.stageId}
          disabled={pending}
          onChange={(e) =>
            startTransition(async () => {
              await moveDeal(deal.id, e.target.value);
            })
          }
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-1.5 py-1 text-xs"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          title="Mark won"
          onClick={() => setMode(mode === 'won' ? 'idle' : 'won')}
          className="rounded p-1 text-emerald-600 hover:bg-muted"
        >
          <CheckCircle2 size={16} />
        </button>
        <button
          title="Mark lost"
          onClick={() => setMode(mode === 'lost' ? 'idle' : 'lost')}
          className="rounded p-1 text-red-600 hover:bg-muted"
        >
          <XCircle size={16} />
        </button>
      </div>

      {mode !== 'idle' && (
        // The booking close-loop. Submitting posts to the closeDeal server action;
        // on success the deal leaves the open board (no manual collapse needed).
        <form
          action={(fd) => startTransition(async () => void (await closeDeal(fd)))}
          className="mt-2 space-y-1.5 border-t border-border pt-2"
        >
          <input type="hidden" name="deal_id" value={deal.id} />
          <input type="hidden" name="outcome" value={mode} />
          <input
            name="service_label"
            defaultValue={deal.serviceLabel ?? ''}
            placeholder="Service"
            className="w-full rounded border border-border bg-transparent px-1.5 py-1 text-xs"
          />
          <div className="flex gap-1.5">
            <input
              name="fee_amount"
              type="number"
              step="0.01"
              defaultValue={deal.feeAmount || ''}
              placeholder="Fee"
              className="w-full rounded border border-border bg-transparent px-1.5 py-1 text-xs"
            />
            {mode === 'won' && (
              <input
                name="tip_amount"
                type="number"
                step="0.01"
                placeholder="Tip"
                className="w-full rounded border border-border bg-transparent px-1.5 py-1 text-xs"
              />
            )}
          </div>
          <input
            name="scheduled_date"
            type="date"
            className="w-full rounded border border-border bg-transparent px-1.5 py-1 text-xs"
          />
          {mode === 'won' && (
            <select
              name="rating"
              defaultValue=""
              className="w-full rounded border border-border bg-transparent px-1.5 py-1 text-xs"
            >
              <option value="">Rating…</option>
              {[1, 2, 3, 4, 5].map((r) => (
                <option key={r} value={r}>
                  {'★'.repeat(r)}
                </option>
              ))}
            </select>
          )}
          {mode === 'lost' && (
            <select
              name="lost_reason"
              defaultValue="time_waster"
              className="w-full rounded border border-border bg-transparent px-1.5 py-1 text-xs"
            >
              {LOST_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="w-full rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
          >
            {mode === 'won' ? 'Mark won' : 'Mark lost'}
          </button>
        </form>
      )}
    </div>
  );
}
