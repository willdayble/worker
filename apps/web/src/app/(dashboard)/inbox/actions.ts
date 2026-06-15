'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { encryptForUser, hmacIdentifier } from '@/lib/crypto';
import type { Channel } from '@workerchat/shared';

export interface StageResult {
  ok: boolean;
  error?: string;
  code?: 'disconnected';
}

export interface OutboundAttachmentInput {
  bucket: string;
  path: string;
  kind: 'image' | 'video' | 'audio' | 'document';
  mimeType: string;
  bytes: number;
  filename?: string;
}

// Human-approved outbound (CONTRACTS §4): the CRM inserts a bridge_outbound(pending) row ONLY when
// the human clicks send — never auto-send. The worker later claims it (pending→sending), decrypts in
// memory, and delivers. The destination is stored encrypted + a salted HMAC routing index; media
// metadata (bucket/path/kind) is encrypted into attachment_enc. Nothing here calls a provider.
export async function stageOutbound(
  conversationId: string,
  text: string,
  attachment?: OutboundAttachmentInput,
): Promise<StageResult> {
  const body = text.trim();
  if (!body && !attachment) return { ok: false, error: 'Message is empty.' };

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

  // Don't stage into the void: if the channel isn't connected the worker can't deliver. Surface it
  // so the composer can prompt a reconnect instead of failing silently.
  const { data: chan } = await supabase
    .from('channels')
    .select('state')
    .eq('user_id', user.id)
    .eq('channel', channel)
    .maybeSingle();
  if ((chan as { state: string } | null)?.state !== 'connected') {
    const label = channel === 'telegram' ? 'Telegram' : 'WhatsApp';
    return { ok: false, error: `${label} isn’t connected.`, code: 'disconnected' };
  }

  const row: Record<string, unknown> = {
    user_id: user.id,
    channel,
    to_channel_user_id_enc: await encryptForUser(user.id, channelUserId),
    to_channel_user_id_hmac: await hmacIdentifier(user.id, channelUserId),
    body_enc: body ? await encryptForUser(user.id, body) : null,
    status: 'pending',
  };
  if (attachment) {
    // Matches shared's OutboundAttachment shape; the worker reads the blob from storage and sends it.
    const meta = [
      {
        kind: attachment.kind,
        storageBucket: attachment.bucket,
        storagePath: attachment.path,
        mimeType: attachment.mimeType,
        bytes: attachment.bytes,
        filename: attachment.filename,
      },
    ];
    row.attachment_enc = await encryptForUser(user.id, JSON.stringify(meta));
  }

  const { error: insertError } = await supabase.from('bridge_outbound').insert(row);
  if (insertError) return { ok: false, error: insertError.message };

  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}
