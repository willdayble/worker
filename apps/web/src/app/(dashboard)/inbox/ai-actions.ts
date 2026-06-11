'use server';

import { createClient } from '@/lib/supabase/server';
import { decryptForUser, safeDecrypt } from '@/lib/crypto';
import { analyzeInbound } from '@/lib/ai/analyze';
import { routeInbound, type InboundAnalysis, type InboundRouting } from '@workerchat/shared';

export interface AnalyzeResult {
  ok: boolean;
  analysis?: InboundAnalysis;
  routing?: InboundRouting;
  error?: string;
}

// Run the disclosed AI assist over a conversation's latest inbound message.
// ADVISORY ONLY (CONTRACTS §6): returns analysis + deterministic routing to the UI;
// it does NOT persist tags, send, or block. A human acts on the result.
export async function analyzeConversation(conversationId: string): Promise<AnalyzeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  // RLS restricts messages to conversations the user owns.
  const { data: rows } = await supabase
    .from('messages')
    .select('direction, body_enc, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: false })
    .limit(8);
  if (!rows || rows.length === 0) return { ok: false, error: 'No messages to analyze.' };

  const latestInbound = rows.find((r) => r.direction === 'in');
  if (!latestInbound) return { ok: false, error: 'No inbound message to analyze.' };

  const latestText = await safeDecrypt(decryptForUser, user.id, latestInbound.body_enc as string | null);
  if (!latestText) return { ok: false, error: 'Latest inbound message has no readable text.' };

  // A few recent messages (oldest→newest) as context, labelled neutrally.
  const context = (
    await Promise.all(
      rows
        .slice(0, 6)
        .reverse()
        .map(async (r) => {
          const t = await safeDecrypt(decryptForUser, user.id, r.body_enc as string | null);
          return t ? `${r.direction === 'in' ? 'client' : 'me'}: ${t}` : '';
        }),
    )
  ).filter(Boolean);

  try {
    const analysis = await analyzeInbound(latestText, context);
    return { ok: true, analysis, routing: routeInbound(analysis) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'AI analysis failed.' };
  }
}
