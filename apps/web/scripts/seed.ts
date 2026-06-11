/**
 * Dev seed — gives the inbox realistic data once migrations 0001/0002 are applied.
 *
 * Run:  doppler run -- pnpm --filter @workerchat/web seed
 * Needs: SUPABASE_URL + SUPABASE_SECRET_KEY (service role) + WORKER_MASTER_KEY
 *        (same key the CRM decrypts with, so seeded ciphertext round-trips).
 *
 * Idempotent-ish: skips if the demo conversation already exists. Sensitive bodies
 * are encrypted with the shared crypto before insert (CONTRACTS §5) — never plaintext.
 */
import { createClient } from '@supabase/supabase-js';
import { encryptForUser } from '@workerchat/shared';

const SEED_EMAIL = process.env.SEED_EMAIL ?? 'demo@workerchat.local';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'workerapp-demo-pw';
const CHANNEL = 'telegram';
const CHANNEL_USER_ID = '610000001';
const THREAD_KEY = `${CHANNEL}:${CHANNEL_USER_ID}`;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`seed: missing ${name}`);
  return v;
}

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL ?? env('NEXT_PUBLIC_SUPABASE_URL'),
    env('SUPABASE_SECRET_KEY'),
    { auth: { persistSession: false } },
  );
  env('WORKER_MASTER_KEY'); // fail early if absent (crypto needs it)

  // 1. demo auth user (create or reuse)
  let userId: string | undefined;
  const created = await supabase.auth.admin.createUser({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (created.data.user) {
    userId = created.data.user.id;
  } else {
    const { data } = await supabase.auth.admin.listUsers();
    userId = data.users.find((u) => u.email === SEED_EMAIL)?.id;
  }
  if (!userId) throw new Error('seed: could not create/find demo user');
  const uid = userId;
  console.log(`seed: user ${SEED_EMAIL} → ${uid}`);

  // 2. skip if already seeded
  const existing = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', uid)
    .eq('thread_key', THREAD_KEY)
    .maybeSingle();
  if (existing.data) {
    console.log('seed: conversation already exists — nothing to do.');
    return;
  }

  // 3. acquisition source (write-once first-touch)
  const acq = await supabase
    .from('acquisition_sources')
    .insert({ user_id: uid, label: 'Website enquiry form', utm: { source: 'site', medium: 'form' } })
    .select('id')
    .single();

  // 4. contact + per-channel identity
  const contact = await supabase
    .from('contacts')
    .insert({ user_id: uid, display_name: 'Alex Rivers', acquisition_source_id: acq.data?.id })
    .select('id')
    .single();
  const contactId = contact.data!.id as string;

  await supabase.from('contact_channels').insert({
    contact_id: contactId,
    user_id: uid,
    channel: CHANNEL,
    channel_user_id: CHANNEL_USER_ID,
    display_name: 'Alex Rivers',
  });

  // 5. messages (encrypted), oldest → newest
  const base = Date.UTC(2026, 5, 11, 9, 0, 0);
  const script: Array<{ dir: 'in' | 'out'; text: string; min: number }> = [
    { dir: 'in', text: 'Hi! Saw your site — are you free this Friday evening?', min: 0 },
    { dir: 'out', text: 'Hi Alex, thanks for reaching out! Friday 7pm works. Where are you based?', min: 4 },
    { dir: 'in', text: 'Downtown. What are your rates for an hour?', min: 9 },
    { dir: 'out', text: 'I’ll send the details through now. A deposit confirms the booking.', min: 12 },
    { dir: 'in', text: 'Perfect, sending the deposit shortly.', min: 20 },
  ];

  const lastText = script[script.length - 1]!.text;
  const conv = await supabase
    .from('conversations')
    .insert({
      user_id: uid,
      contact_id: contactId,
      channel: CHANNEL,
      thread_key: THREAD_KEY,
      status: 'open',
      last_message_at: new Date(base + 20 * 60_000).toISOString(),
      last_message_preview_enc: await encryptForUser(uid, lastText),
    })
    .select('id')
    .single();
  const conversationId = conv.data!.id as string;

  for (const [i, m] of script.entries()) {
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: m.dir,
      provider_message_id: `seed-${i}`,
      content_type: 'text',
      body_enc: await encryptForUser(uid, m.text),
      status: m.dir === 'out' ? 'delivered' : 'read',
      sent_at: new Date(base + m.min * 60_000).toISOString(),
    });
  }

  console.log(`seed: created conversation ${conversationId} with ${script.length} messages.`);

  // 6. a default pipeline + stages + one open deal, so the kanban has data.
  const pipeline = await supabase
    .from('pipelines')
    .insert({ user_id: uid, name: 'Bookings', is_default: true })
    .select('id')
    .single();
  const stageRows = ['Enquiry', 'Screening', 'Confirmed', 'Completed'].map((name, i) => ({
    pipeline_id: pipeline.data!.id,
    user_id: uid,
    name,
    position: i,
  }));
  const stages = await supabase.from('pipeline_stages').insert(stageRows).select('id, name');
  const screening = stages.data?.find((s) => s.name === 'Screening');
  await supabase.from('deals').insert({
    user_id: uid,
    contact_id: contactId,
    conversation_id: conversationId,
    pipeline_id: pipeline.data!.id,
    stage_id: screening?.id,
    service_label: 'Friday evening — 1hr',
    fee_amount: 350,
    status: 'open',
    scheduled_date: '2026-06-13',
  });
  console.log('seed: created pipeline + 1 open deal.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
