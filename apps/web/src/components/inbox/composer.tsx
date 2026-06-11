'use client';

import { useState, useTransition } from 'react';
import { SendHorizontal } from 'lucide-react';
import { stageOutbound } from '@/app/(dashboard)/inbox/actions';

// Composer that STAGES a human-approved draft (CONTRACTS §6: never auto-send).
// Controlled: the parent owns the text so an AI suggestion can pre-fill it. Clicking
// send is the human approval step — it inserts bridge_outbound; the worker delivers.
export function Composer({
  conversationId,
  value,
  onChange,
}: {
  conversationId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const body = value.trim();
    if (!body || pending) return;
    setStatus(null);
    startTransition(async () => {
      const res = await stageOutbound(conversationId, body);
      if (res.ok) {
        onChange('');
        setStatus('Queued for delivery ✓');
      } else {
        setStatus(res.error ?? 'Failed to queue.');
      }
    });
  }

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Write a reply…  (⌘/Ctrl+Enter to queue)"
          className="min-h-[2.5rem] flex-1 resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={send}
          disabled={pending || !value.trim()}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <SendHorizontal size={15} />
          {pending ? 'Queuing…' : 'Send'}
        </button>
      </div>
      {status && <p className="mt-1.5 text-xs text-muted-foreground">{status}</p>}
      <p className="mt-1 text-[11px] text-muted-foreground">
        Sends are queued for the messaging worker — the CRM never contacts a provider directly.
      </p>
    </div>
  );
}
