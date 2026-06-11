import { CheckCircle2, XCircle } from 'lucide-react';

export interface ClosedDeal {
  id: string;
  status: 'won' | 'lost';
  lostReason: string | null;
  feeAmount: number;
  tipAmount: number;
  serviceLabel: string | null;
  scheduledDate: string | null;
  contactName: string;
}

const LOST_LABEL: Record<string, string> = {
  time_waster: 'time-waster',
  dangerous: 'dangerous',
  ghosted: 'ghosted',
  price: 'price',
  scheduling: 'scheduling',
  other: 'other',
};

// Recent close-loop results — the proof the booking loop closes (SCOPE §5):
// won/lost with service, fee, date logged.
export function ClosedSummary({ deals }: { deals: ClosedDeal[] }) {
  if (deals.length === 0) return null;
  return (
    <div className="border-t border-border px-4 py-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Recently closed
      </p>
      <ul className="flex flex-wrap gap-2">
        {deals.map((d) => (
          <li
            key={d.id}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
          >
            {d.status === 'won' ? (
              <CheckCircle2 size={13} className="text-emerald-600" />
            ) : (
              <XCircle size={13} className="text-red-600" />
            )}
            <span className="font-medium">{d.contactName}</span>
            {d.serviceLabel && <span className="text-muted-foreground">· {d.serviceLabel}</span>}
            {d.status === 'won' && d.feeAmount + d.tipAmount > 0 && (
              <span className="text-muted-foreground">
                · ${(d.feeAmount + d.tipAmount).toFixed(0)}
              </span>
            )}
            {d.status === 'lost' && d.lostReason && (
              <span className="text-muted-foreground">· {LOST_LABEL[d.lostReason] ?? d.lostReason}</span>
            )}
            {d.scheduledDate && <span className="text-muted-foreground">· {d.scheduledDate}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
