import Link from 'next/link';
import { AlertTriangle, Star, ShieldCheck, BadgeCheck, FileCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

export default async function ContactsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('contacts')
    .select(
      'id, display_name, is_flagged, star_rating, deposit_paid, id_verified, references_provided, acquisition_source:acquisition_sources(label)',
    )
    .order('display_name', { ascending: true });

  const contacts = (data ?? []).map((c) => {
    const src = (Array.isArray(c.acquisition_source) ? c.acquisition_source[0] : c.acquisition_source) as
      | { label: string | null }
      | null
      | undefined;
    return {
      id: c.id as string,
      name: (c.display_name as string | null) ?? 'Unknown contact',
      flagged: Boolean(c.is_flagged),
      rating: (c.star_rating as number | null) ?? null,
      depositPaid: Boolean(c.deposit_paid),
      idVerified: Boolean(c.id_verified),
      refs: Boolean(c.references_provided),
      source: src?.label ?? null,
    };
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="font-semibold">Contacts</h1>
        <span className="text-xs text-muted-foreground">{contacts.length}</span>
      </header>
      {contacts.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No contacts yet.</p>
      ) : (
        <ul className="divide-y divide-border overflow-y-auto">
          {contacts.map((c) => (
            <li key={c.id}>
              <Link href={`/contacts/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
                <span className="flex min-w-0 items-center gap-2">
                  {c.flagged && <AlertTriangle size={14} className="shrink-0 text-amber-500" />}
                  <span className="truncate font-medium">{c.name}</span>
                  {c.rating && (
                    <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                      <Star size={11} className="fill-current" />
                      {c.rating}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {c.depositPaid && <ShieldCheck size={14} aria-label="Deposit paid" />}
                  {c.idVerified && <BadgeCheck size={14} aria-label="ID verified" />}
                  {c.refs && <FileCheck size={14} aria-label="References" />}
                  {c.source && <span className="text-xs">{c.source}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
