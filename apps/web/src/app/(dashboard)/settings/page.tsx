import { createClient } from '@/lib/supabase/server';
import { ChannelsConnect, type ChannelRow } from '@/components/settings/channels-connect';

// Settings → Channels. Shows the user's connected channels and, for WhatsApp, the live QR to
// link a device (app-driven — no operator config). The worker writes qr/state onto the channels
// row (RLS-scoped to this user); the client component re-surfaces it live (Realtime + poll).
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('channels')
    .select('channel, state, qr, channel_user_id, connected_at')
    .order('channel', { ascending: true });

  const channels: ChannelRow[] = (data ?? []).map((c) => ({
    channel: c.channel as string,
    state: (c.state as string | null) ?? 'disconnected',
    qr: (c.qr as string | null) ?? null,
    channelUserId: (c.channel_user_id as string | null) ?? null,
  }));

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-4 py-3">
        <h1 className="font-semibold">Settings</h1>
      </header>
      <div className="overflow-y-auto p-4">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Channels</h2>
        <ChannelsConnect channels={channels} />
      </div>
    </div>
  );
}
