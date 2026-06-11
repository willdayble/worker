'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { encryptForUser } from '@/lib/crypto';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const AGE_GROUPS = ['18-24', '25-35', '36-50', '50s-60s', '70+'];

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const contactId = String(formData.get('contact_id') ?? '');
  const displayName = String(formData.get('display_name') ?? '').trim();
  const ageGroup = String(formData.get('age_group') ?? '');
  const rating = Number(formData.get('star_rating') ?? 0);

  const { error } = await supabase
    .from('contacts')
    .update({
      display_name: displayName || null,
      age_group: AGE_GROUPS.includes(ageGroup) ? ageGroup : null,
      star_rating: rating >= 1 && rating <= 5 ? rating : null,
    })
    .eq('id', contactId)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

export async function updateScreening(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const contactId = String(formData.get('contact_id') ?? '');
  const depositAmount = Number(formData.get('deposit_amount') ?? 0);
  const notes = String(formData.get('screening_notes') ?? '').trim();

  const { error } = await supabase
    .from('contacts')
    .update({
      deposit_paid: formData.get('deposit_paid') === 'on',
      deposit_amount: Number.isFinite(depositAmount) && depositAmount > 0 ? depositAmount : null,
      id_verified: formData.get('id_verified') === 'on',
      references_provided: formData.get('references_provided') === 'on',
      screening_notes_enc: notes ? await encryptForUser(user.id, notes) : null,
    })
    .eq('id', contactId)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

// Flag a client as dangerous — ADVISORY only (CONTRACTS §6: never an automated
// decision). Sets the flag on the contact AND appends an immutable audit event.
export async function flagContact(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const contactId = String(formData.get('contact_id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!reason) return { ok: false, error: 'A reason is required to flag.' };
  const reasonEnc = await encryptForUser(user.id, reason);

  const upd = await supabase
    .from('contacts')
    .update({
      is_flagged: true,
      flag_reason_enc: reasonEnc,
      flag_set_by: user.id,
      flag_locked_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .eq('user_id', user.id);
  if (upd.error) return { ok: false, error: upd.error.message };

  await supabase
    .from('contact_flag_events')
    .insert({ user_id: user.id, contact_id: contactId, action: 'flag', reason_enc: reasonEnc });

  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

// False-positive recovery: clear the flag, keeping the reason in the audit trail
// so the history is never silently erased (M14).
export async function unflagContact(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const contactId = String(formData.get('contact_id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  const upd = await supabase
    .from('contacts')
    .update({ is_flagged: false, flag_reason_enc: null, flag_set_by: null, flag_locked_at: null })
    .eq('id', contactId)
    .eq('user_id', user.id);
  if (upd.error) return { ok: false, error: upd.error.message };

  await supabase.from('contact_flag_events').insert({
    user_id: user.id,
    contact_id: contactId,
    action: 'unflag',
    reason_enc: reason ? await encryptForUser(user.id, reason) : null,
  });

  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

export async function addContactNote(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const contactId = String(formData.get('contact_id') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return { ok: false, error: 'Note is empty.' };

  const { error } = await supabase.from('contact_notes').insert({
    user_id: user.id,
    contact_id: contactId,
    body_enc: await encryptForUser(user.id, body),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}
