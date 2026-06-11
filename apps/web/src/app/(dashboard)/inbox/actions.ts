'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { encryptForUser, hmacIdentifier } from '@/lib/crypto';
import type { Channel } from '@workerchat/shared';

export interface StageResult {
  ok: boolean;
  error?: string;
}

// Human-approved outbound (CONTRACTS §4): the CRM inserts a bridge_outbound(pending)
// row ONLY when the human clicks send — never auto-send. The worker later claims it
// (pending→sending), decrypts in memory, and delivers. We store the destination
// encrypted + a salted HMAC routing index; nothing here ever calls a provider.
export async function stageOutbound(conversationId: string, text: string): Promise<StageResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: 'Message is empty.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  // RLS guarantees we only read our own conversation.
  const { data: conv, error } = await supabase
    .from('conversations')
    .select('id, channel, thread_key, window_expires_at')
    .eq('id', conversationId)
    .single();
  if (error || !conv) return { ok: false, error: 'Conversation not found.' };

  const channel = conv.channel as Channel;
  // thread_key = `${channel}:${channelUserId}` — recover the destination id.
  const threadKey = conv.thread_key as string;
  const channelUserId = threadKey.slice(threadKey.indexOf(':') + 1);
  if (!channelUserId) return { ok: false, error: 'Could not resolve destination.' };

  const { error: insertError } = await supabase.from('bridge_outbound').insert({
    user_id: user.id,
    channel,
    to_channel_user_id_enc: await encryptForUser(user.id, channelUserId),
    to_channel_user_id_hmac: await hmacIdentifier(user.id, channelUserId),
    body_enc: await encryptForUser(user.id, body),
    status: 'pending',
  });
  if (insertError) return { ok: false, error: insertError.message };

  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}
