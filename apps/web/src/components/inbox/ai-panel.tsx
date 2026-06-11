'use client';

import { useState, useTransition } from 'react';
import { Sparkles, AlertTriangle, ArrowDownToLine } from 'lucide-react';
import { analyzeConversation, type AnalyzeResult } from '@/app/(dashboard)/inbox/ai-actions';
import { AI_DISCLOSURE } from '@/lib/ai/disclosure';

// Disclosed AI assist (CONTRACTS §6). Shows booking detection, neutral tags,
// ADVISORY red flags, confidence, the deterministic routing decision, and a draft
// reply the human can pull into the composer. Never sends; never blocks.
export function AiPanel({
  conversationId,
  onUseDraft,
}: {
  conversationId: string;
  onUseDraft: (text: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  function analyze() {
    setResult(null);
    startTransition(async () => setResult(await analyzeConversation(conversationId)));
  }

  const a = result?.analysis;
  const r = result?.routing;

  return (
    <div className="border-t border-border bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={analyze}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium disabled:opacity-60"
        >
          <Sparkles size={13} /> {pending ? 'Analyzing…' : 'Analyze with AI'}
        </button>
        {a && (
          <span className="text-[11px] text-muted-foreground">
            {a.is_booking ? 'Booking detected' : 'No booking'} · confidence{' '}
            {Math.round(a.confidence * 100)}% · {r?.escalate ? 'escalate to human' : 'auto-tag + draft'}
          </span>
        )}
      </div>

      {result && !result.ok && (
        <p className="mt-2 text-xs text-amber-700">{result.error}</p>
      )}

      {a && (
        <div className="mt-2 space-y-2 text-xs">
          {a.red_flags.length > 0 && (
            <div className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-800">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">Advisory red flags:</span> {a.red_flags.join(', ')}
                <span className="block text-[10px] opacity-80">
                  Advisory only — review and decide. Never an automated block.
                </span>
              </span>
            </div>
          )}

          {(a.intent_tags.length > 0 || a.service_tags.length > 0) && (
            <div className="flex flex-wrap gap-1">
              {[...a.intent_tags, ...a.service_tags].map((t, i) => (
                <span key={`${t}-${i}`} className="rounded bg-background px-1.5 py-0.5 text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          )}

          {a.booking_fields && (
            <div className="text-muted-foreground">
              {[
                a.booking_fields.service_label,
                a.booking_fields.date,
                a.booking_fields.time,
                a.booking_fields.location_type,
                a.booking_fields.amount != null ? `$${a.booking_fields.amount}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || null}
            </div>
          )}

          {a.suggested_reply && (
            <div className="rounded border border-border bg-background p-2">
              <p className="whitespace-pre-wrap">{a.suggested_reply}</p>
              <button
                onClick={() => onUseDraft(a.suggested_reply)}
                className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-primary"
              >
                <ArrowDownToLine size={12} /> Use as draft
              </button>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">{AI_DISCLOSURE}</p>
    </div>
  );
}
