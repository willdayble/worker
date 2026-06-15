import { createClient } from '@/lib/supabase/server';
import { decryptForUser, safeDecrypt } from '@/lib/crypto';
import { ConversationListClient, type ConversationListItem } from './conversation-list-client';

// WhatsApp linked devices can't read your saved contact names (those live on your phone), so when we
// have no name, fall back to the phone number for WhatsApp threads. LID-addressed threads (privacy
// alias) have no number → stay "Unknown contact".
export function fallbackContactName(channel: string, threadKey: string): string {
  if (channel === 'whatsapp_unofficial' || channel === 'whatsapp_official') {
    const cuid = threadKey.slice(threadKey.indexOf(':') + 1);
    if (/^\d{7,15}$/.test(cuid)) return `+${cuid}`;
  }
  return 'Unknown contact';
}

// Server component: fetch the user's conversations (RLS-scoped), decrypt each
// preview, hand plain data to the client list (active-state + Realtime). Ordered
// by last_message_at (provider time), newest first.
export async function ConversationList() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('conversations')
    .select(
      'id, channel, thread_key, status, last_message_at, last_message_preview_enc, contact:contacts(display_name, is_flagged)',
    )
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) {
    return <div className="p-4 text-sm text-red-600">Failed to load conversations.</div>;
  }

  const items: ConversationListItem[] = await Promise.all(
    (data ?? []).map(async (c) => {
      // supabase types the joined relation loosely; narrow what we read.
      const contact = (Array.isArray(c.contact) ? c.contact[0] : c.contact) as
        | { display_name: string | null; is_flagged: boolean }
        | null
        | undefined;
      return {
        id: c.id as string,
        channel: c.channel as string,
        status: c.status as string,
        lastMessageAt: (c.last_message_at as string | null) ?? null,
        preview: await safeDecrypt(
          decryptForUser,
          user.id,
          c.last_message_preview_enc as string | null,
        ),
        contactName: contact?.display_name ?? fallbackContactName(c.channel as string, c.thread_key as string),
        isFlagged: Boolean(contact?.is_flagged),
      };
    }),
  );

  return <ConversationListClient items={items} />;
}
