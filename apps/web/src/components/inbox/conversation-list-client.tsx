'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

export interface ConversationListItem {
  id: string;
  channel: string;
  status: string;
  lastMessageAt: string | null;
  preview: string;
  contactName: string;
  isFlagged: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp_official: 'WhatsApp',
  whatsapp_unofficial: 'WhatsApp',
  telegram: 'Telegram',
};

// Renders the list + active highlight, and subscribes to Realtime so new inbound
// messages / conversation bumps re-fetch the server component (CONTRACTS §4).
export function ConversationListClient({ items }: { items: ConversationListItem[] }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('inbox-conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () =>
        router.refresh(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () =>
        router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  if (items.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No conversations yet. Connect a channel or run the seed script.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((c) => {
        const active = pathname === `/inbox/${c.id}`;
        return (
          <li key={c.id}>
            <Link
              href={`/inbox/${c.id}`}
              className={cn(
                'block px-4 py-3 hover:bg-muted',
                active && 'bg-muted',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  {c.isFlagged && (
                    <AlertTriangle size={13} className="shrink-0 text-amber-500" aria-label="Flagged" />
                  )}
                  <span className="truncate">{c.contactName}</span>
                </span>
                {c.lastMessageAt && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistanceToNowStrict(new Date(c.lastMessageAt), { addSuffix: false })}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="truncate text-sm text-muted-foreground">{c.preview || '—'}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {CHANNEL_LABEL[c.channel] ?? c.channel}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
