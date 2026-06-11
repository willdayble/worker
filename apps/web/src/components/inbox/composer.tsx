'use client';

import { useState, useTransition } from 'react';
import { SendHorizontal } from 'lucide-react';
import { stageOutbound } from '@/app/(dashboard)/inbox/actions';

// Composer that STAGES a human-approved draft. Clicking send is the human
// approval step (CONTRACTS §6: never auto-send) — it inserts bridge_outbound and
// the worker delivers. An AI-suggested reply (Deliverable 3) would pre-fill this
// box; a human still presses send.
export function Composer({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const body = text.trim();
    if (!body || pending) return;
    setStatus(null);
    startTransition(async () => {
      const res = await stageOutbound(conversationId, body);
      if (res.ok) {
        setText('');
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
          value={text}
          onChange={(e) => setText(e.target.value)}
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
          disabled={pending || !text.trim()}
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
