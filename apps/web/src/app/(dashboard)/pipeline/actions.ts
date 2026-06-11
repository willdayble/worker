'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { DealLostReason } from '@workerchat/shared';

const DEFAULT_STAGES = ['Enquiry', 'Screening', 'Confirmed', 'Completed'];

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// Create a default pipeline + stages the first time (Enquiry→Screening→Confirmed→
// Completed, per the brief). Idempotent: no-op if the user already has a pipeline.
export async function ensureDefaultPipeline(): Promise<ActionResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const existing = await supabase.from('pipelines').select('id').eq('user_id', user.id).limit(1);
  if (existing.data && existing.data.length > 0) return { ok: true };

  const pipeline = await supabase
    .from('pipelines')
    .insert({ user_id: user.id, name: 'Bookings', is_default: true })
    .select('id')
    .single();
  if (pipeline.error || !pipeline.data) return { ok: false, error: pipeline.error?.message };

  const stages = DEFAULT_STAGES.map((name, i) => ({
    pipeline_id: pipeline.data.id,
    user_id: user.id,
    name,
    position: i,
  }));
  const { error } = await supabase.from('pipeline_stages').insert(stages);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/pipeline');
  return { ok: true };
}

export async function createDeal(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const contactId = String(formData.get('contact_id') ?? '');
  const stageId = String(formData.get('stage_id') ?? '');
  const serviceLabel = String(formData.get('service_label') ?? '').trim();
  const fee = Number(formData.get('fee_amount') ?? 0);
  if (!contactId || !stageId) return { ok: false, error: 'Contact and stage are required.' };

  const { error } = await supabase.from('deals').insert({
    user_id: user.id,
    contact_id: contactId,
    stage_id: stageId,
    service_label: serviceLabel || null,
    fee_amount: Number.isFinite(fee) ? fee : 0,
    status: 'open',
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/pipeline');
  return { ok: true };
}

// Move a deal between stages (the "drag" — done via a select for now). RLS makes
// the user_id filter belt-and-suspenders.
export async function moveDeal(dealId: string, stageId: string): Promise<ActionResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const { error } = await supabase
    .from('deals')
    .update({ stage_id: stageId })
    .eq('id', dealId)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/pipeline');
  return { ok: true };
}

// The booking close-loop (SCOPE §5): won / lost — with lost_reason covering
// time-waster and dangerous-client — plus service/fee/tip/date/rating logged.
// NB: marking a client dangerous here records the deal outcome; the append-only
// dangerous-client FLAG on the contact is a separate, human-driven action (M14).
export async function closeDeal(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const dealId = String(formData.get('deal_id') ?? '');
  const outcome = String(formData.get('outcome') ?? '');
  if (!dealId || (outcome !== 'won' && outcome !== 'lost')) {
    return { ok: false, error: 'Pick won or lost.' };
  }

  const rating = Number(formData.get('rating') ?? 0);
  const lostReason = String(formData.get('lost_reason') ?? '') as DealLostReason | '';

  const patch: Record<string, unknown> = {
    status: outcome,
    fee_amount: Number(formData.get('fee_amount') ?? 0) || 0,
    tip_amount: Number(formData.get('tip_amount') ?? 0) || 0,
    service_label: String(formData.get('service_label') ?? '').trim() || null,
    scheduled_date: String(formData.get('scheduled_date') ?? '') || null,
    rating: outcome === 'won' && rating >= 1 && rating <= 5 ? rating : null,
    lost_reason: outcome === 'lost' && lostReason ? lostReason : null,
  };

  const { error } = await supabase
    .from('deals')
    .update(patch)
    .eq('id', dealId)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/pipeline');
  return { ok: true };
}
