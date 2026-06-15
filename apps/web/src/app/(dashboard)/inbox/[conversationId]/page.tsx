import { notFound } from 'next/navigation';
import { AlertTriangle, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { decryptForUser, safeDecrypt } from '@/lib/crypto';
import { ThreadAssist } from '@/components/inbox/thread-assist';
import { LocalTime } from '@/components/inbox/local-time';
import { cn } from '@/lib/utils';

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp_official: 'WhatsApp (official)',
  whatsapp_unofficial: 'WhatsApp',
  telegram: 'Telegram',
};

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: conv } = await supabase
    .from('conversations')
    .select(
      'id, channel, thread_key, window_expires_at, contact:contacts(display_name, is_flagged)',
    )
    .eq('id', conversationId)
    .single();
  if (!conv) notFound();

  const contact = (Array.isArray(conv.contact) ? conv.contact[0] : conv.contact) as
    | { display_name: string | null; is_flagged: boolean }
    | null
    | undefined;

  const { data: rows } = await supabase
    .from('messages')
    .select('id, direction, content_type, body_enc, attachment_url, is_historical, status, sent_at, seq')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })
    .order('seq', { ascending: true })
    .limit(500);

  // Private media: sign a short-lived URL per image (service-role; rows are already RLS-scoped to
  // this user). Re-signed on every refresh, so the TTL only needs to outlive a render.
  const service = createServiceClient();
  const messages = await Promise.all(
    (rows ?? []).map(async (m) => {
      const attachmentPath = m.attachment_url as string | null;
      let imageUrl: string | null = null;
      if (m.content_type === 'image' && attachmentPath) {
        const { data: signed } = await service.storage
          .from('inbound-media')
          .createSignedUrl(attachmentPath, 300);
        imageUrl = signed?.signedUrl ?? null;
      }
      return {
        id: m.id as string,
        direction: m.direction as 'in' | 'out',
        isHistorical: Boolean(m.is_historical),
        status: m.status as string,
        sentAt: m.sent_at as string,
        body: await safeDecrypt(decryptForUser, user.id, m.body_enc as string | null),
        imageUrl,
      };
    }),
  );

  // Capability-driven banner (CONTRACTS §2/§4): WA-official replies need an open
  // 24h window; once it lapses only templates may be sent.
  const windowExpiresAt = conv.window_expires_at as string | null;
  const windowClosed =
    conv.channel === 'whatsapp_official' &&
    (!windowExpiresAt || new Date(windowExpiresAt).getTime() < Date.now());

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {contact?.is_flagged && <AlertTriangle size={15} className="text-amber-500" />}
          <span className="font-medium">{contact?.display_name ?? 'Unknown contact'}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {CHANNEL_LABEL[conv.channel as string] ?? (conv.channel as string)}
        </span>
      </header>

      {windowClosed && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <Clock size={13} />
          24-hour window closed — only approved templates can be sent until the client replies.
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="m-auto text-sm text-muted-foreground">No messages yet.</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[70%] rounded-2xl px-3 py-2 text-sm',
                m.direction === 'out'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground',
              )}
            >
              {m.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.imageUrl} alt="attachment" className="mb-1 max-h-72 rounded-lg" />
              )}
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              {!m.imageUrl && !m.body && <p>—</p>}
              <div
                className={cn(
                  'mt-1 flex items-center gap-1.5 text-[10px]',
                  m.direction === 'out' ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                <LocalTime iso={m.sentAt} />
                {m.isHistorical && <span>· history</span>}
                {m.direction === 'out' && <span>· {m.status}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <ThreadAssist conversationId={conversationId} />
    </div>
  );
}
