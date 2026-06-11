import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { Star, MessageSquare } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { decryptForUser, safeDecrypt } from '@/lib/crypto';
import { ProfileForm } from '@/components/contacts/profile-form';
import { ScreeningForm } from '@/components/contacts/screening-form';
import { FlagControl } from '@/components/contacts/flag-control';
import { AddNote } from '@/components/contacts/add-note';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-3">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default async function ContactDetail({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const uid = user.id;

  const { data: c } = await supabase
    .from('contacts')
    .select(
      'id, display_name, age_group, star_rating, deposit_paid, deposit_amount, id_verified, references_provided, screening_notes_enc, is_flagged, flag_reason_enc, acquisition_source:acquisition_sources(label)',
    )
    .eq('id', contactId)
    .single();
  if (!c) notFound();

  const [notesRes, dealsRes, convsRes, eventsRes] = await Promise.all([
    supabase.from('contact_notes').select('id, body_enc, created_at').eq('contact_id', contactId).order('created_at', { ascending: false }),
    supabase.from('deals').select('id, status, service_label, fee_amount, scheduled_date').eq('contact_id', contactId).order('created_at', { ascending: false }),
    supabase.from('conversations').select('id, channel, last_message_at').eq('contact_id', contactId).order('last_message_at', { ascending: false }),
    supabase.from('contact_flag_events').select('id, action, reason_enc, created_at').eq('contact_id', contactId).order('created_at', { ascending: false }),
  ]);

  const src = (Array.isArray(c.acquisition_source) ? c.acquisition_source[0] : c.acquisition_source) as
    | { label: string | null }
    | null
    | undefined;
  const name = (c.display_name as string | null) ?? 'Unknown contact';
  const screeningNotes = await safeDecrypt(decryptForUser, uid, c.screening_notes_enc as string | null);
  const flagReason = await safeDecrypt(decryptForUser, uid, c.flag_reason_enc as string | null);

  const notes = await Promise.all(
    (notesRes.data ?? []).map(async (n) => ({
      id: n.id as string,
      created_at: n.created_at as string,
      body: await safeDecrypt(decryptForUser, uid, n.body_enc as string | null),
    })),
  );
  const events = await Promise.all(
    (eventsRes.data ?? []).map(async (e) => ({
      id: e.id as string,
      action: e.action as string,
      created_at: e.created_at as string,
      reason: await safeDecrypt(decryptForUser, uid, e.reason_enc as string | null),
    })),
  );

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href="/contacts" className="text-sm text-muted-foreground hover:underline">
          ← Contacts
        </Link>
        <span className="font-semibold">{name}</span>
        {Boolean(c.star_rating) && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Star size={11} className="fill-current" /> {c.star_rating as number}
          </span>
        )}
        {src?.label && <span className="text-xs text-muted-foreground">· via {src.label}</span>}
      </header>

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Section title="Profile">
            <ProfileForm
              contactId={contactId}
              displayName={(c.display_name as string | null) ?? ''}
              ageGroup={(c.age_group as string | null) ?? null}
              rating={(c.star_rating as number | null) ?? null}
            />
          </Section>
          <Section title="Screening">
            <ScreeningForm
              contactId={contactId}
              depositPaid={Boolean(c.deposit_paid)}
              depositAmount={(c.deposit_amount as number | null) ?? null}
              idVerified={Boolean(c.id_verified)}
              references={Boolean(c.references_provided)}
              notes={screeningNotes}
            />
          </Section>
          <Section title="Safety flag">
            <FlagControl contactId={contactId} flagged={Boolean(c.is_flagged)} reason={flagReason} />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Notes">
            <AddNote contactId={contactId} />
            <ul className="mt-3 space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded border border-border p-2 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {format(new Date(n.created_at), 'd MMM yyyy, HH:mm')}
                  </p>
                </li>
              ))}
              {notes.length === 0 && <li className="text-xs text-muted-foreground">No notes.</li>}
            </ul>
          </Section>

          <Section title="Bookings">
            <ul className="space-y-1">
              {(dealsRes.data ?? []).map((d) => (
                <li key={d.id as string} className="flex items-center justify-between text-sm">
                  <span className="truncate">{(d.service_label as string | null) ?? 'Deal'}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {d.status as string}
                    {d.scheduled_date ? ` · ${d.scheduled_date as string}` : ''}
                    {Number(d.fee_amount) > 0 ? ` · $${Number(d.fee_amount).toFixed(0)}` : ''}
                  </span>
                </li>
              ))}
              {(dealsRes.data ?? []).length === 0 && (
                <li className="text-xs text-muted-foreground">No bookings.</li>
              )}
            </ul>
          </Section>

          <Section title="Conversations">
            <ul className="space-y-1">
              {(convsRes.data ?? []).map((cv) => (
                <li key={cv.id as string}>
                  <Link
                    href={`/inbox/${cv.id as string}`}
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <MessageSquare size={13} /> {cv.channel as string}
                  </Link>
                </li>
              ))}
              {(convsRes.data ?? []).length === 0 && (
                <li className="text-xs text-muted-foreground">No conversations.</li>
              )}
            </ul>
          </Section>

          {events.length > 0 && (
            <Section title="Flag audit (append-only)">
              <ul className="space-y-1">
                {events.map((e) => (
                  <li key={e.id} className="text-xs text-muted-foreground">
                    <span className={e.action === 'flag' ? 'text-amber-700' : 'text-emerald-700'}>
                      {e.action}
                    </span>{' '}
                    · {format(new Date(e.created_at), 'd MMM yyyy, HH:mm')}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
