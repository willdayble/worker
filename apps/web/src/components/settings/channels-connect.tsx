'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'react-qr-code';
import { createClient } from '@/lib/supabase/client';

export interface ChannelRow {
  channel: string;
  state: string;
  qr: string | null;
  channelUserId: string | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp_unofficial: 'WhatsApp',
  whatsapp_official: 'WhatsApp (official)',
  telegram: 'Telegram',
};

// Live channel-connection panel. Subscribes to the channels row (Realtime + poll backstop) so the
// QR — which Baileys rotates ~every 20s — and the connection state update without a manual
// refresh. qr/state are operational columns (no decryption involved).
export function ChannelsConnect({ channels }: { channels: ChannelRow[] }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let ch: ReturnType<typeof supabase.channel> | undefined;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      ch = supabase
        .channel('channels-connect')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => router.refresh())
        .subscribe();
    });

    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      if (ch) void supabase.removeChannel(ch);
    };
  }, [router]);

  const wa = channels.find((c) => c.channel === 'whatsapp_unofficial');
  const others = channels.filter((c) => c.channel !== 'whatsapp_unofficial' && c.state === 'connected');

  return (
    <div className="max-w-md space-y-4">
      <WhatsAppCard wa={wa} />
      {others.map((c) => (
        <div key={c.channel} className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
            <span className="text-xs text-green-500">● Connected</span>
          </div>
          {c.channelUserId && <p className="mt-1 text-xs text-muted-foreground">{c.channelUserId}</p>}
        </div>
      ))}
    </div>
  );
}

function WhatsAppCard({ wa }: { wa?: ChannelRow }) {
  const state = wa?.state ?? 'disconnected';

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">WhatsApp</span>
        <StatusBadge state={state} />
      </div>

      {state === 'connected' ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Connected{wa?.channelUserId ? ` as +${wa.channelUserId}` : ''}. Messages now flow into your inbox.
        </p>
      ) : state === 'pairing' && wa?.qr ? (
        <div className="mt-3">
          <div className="inline-block rounded-lg bg-white p-3">
            <QRCode value={wa.qr} size={200} />
          </div>
          <ol className="mt-3 list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
            <li>
              Open <span className="text-foreground">WhatsApp</span> on your phone.
            </li>
            <li>
              Go to <span className="text-foreground">Settings → Linked Devices → Link a Device</span>.
            </li>
            <li>Scan this code. It refreshes every few seconds — that&rsquo;s normal.</li>
          </ol>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {state === 'logged_out' || state === 'banned'
            ? 'Disconnected — re-link to reconnect.'
            : 'Starting a session… the QR code will appear here shortly.'}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    connected: { label: '● Connected', cls: 'text-green-500' },
    pairing: { label: '● Scan to link', cls: 'text-amber-500' },
    connecting: { label: '● Connecting…', cls: 'text-amber-500' },
    reconnecting: { label: '● Reconnecting…', cls: 'text-amber-500' },
    logged_out: { label: '● Disconnected', cls: 'text-muted-foreground' },
    banned: { label: '● Banned', cls: 'text-red-500' },
    error: { label: '● Error', cls: 'text-red-500' },
    disconnected: { label: '● Not connected', cls: 'text-muted-foreground' },
  };
  const s = map[state] ?? { label: '● Not connected', cls: 'text-muted-foreground' };
  return <span className={`text-xs ${s.cls}`}>{s.label}</span>;
}
