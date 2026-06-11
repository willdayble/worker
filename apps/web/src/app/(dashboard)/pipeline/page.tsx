import { createClient } from '@/lib/supabase/server';
import { ensureDefaultPipeline } from './actions';
import { DealCard, type DealCardData, type StageOption } from '@/components/pipeline/deal-card';
import { NewDeal } from '@/components/pipeline/new-deal';
import { ClosedSummary, type ClosedDeal } from '@/components/pipeline/closed-summary';

function contactName(row: { contact: unknown }): string {
  const c = (Array.isArray(row.contact) ? row.contact[0] : row.contact) as
    | { display_name: string | null }
    | null
    | undefined;
  return c?.display_name ?? 'Unknown contact';
}

export default async function PipelinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const pipelineRes = await supabase
    .from('pipelines')
    .select('id')
    .eq('user_id', user.id)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();

  // First run — no pipeline yet. Offer to provision the default board.
  if (!pipelineRes.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">No pipeline yet.</p>
        <form
          action={async () => {
            'use server';
            await ensureDefaultPipeline();
          }}
        >
          <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            Create default pipeline
          </button>
        </form>
      </div>
    );
  }
  const pipelineId = pipelineRes.data.id as string;

  const [stagesRes, openRes, closedRes, contactsRes] = await Promise.all([
    supabase
      .from('pipeline_stages')
      .select('id, name, position')
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: true }),
    supabase
      .from('deals')
      .select('id, stage_id, service_label, fee_amount, scheduled_date, contact:contacts(display_name)')
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false }),
    supabase
      .from('deals')
      .select('id, status, lost_reason, fee_amount, tip_amount, scheduled_date, service_label, contact:contacts(display_name)')
      .eq('user_id', user.id)
      .in('status', ['won', 'lost'])
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase.from('contacts').select('id, display_name').eq('user_id', user.id).order('display_name'),
  ]);

  const stages = (stagesRes.data ?? []) as StageOption[];
  const stageOptions: StageOption[] = stages.map((s) => ({ id: s.id, name: s.name }));

  const openDeals: DealCardData[] = (openRes.data ?? []).map((d) => ({
    id: d.id as string,
    stageId: d.stage_id as string,
    contactName: contactName(d),
    serviceLabel: (d.service_label as string | null) ?? null,
    feeAmount: Number(d.fee_amount ?? 0),
    scheduledDate: (d.scheduled_date as string | null) ?? null,
  }));

  const closed: ClosedDeal[] = (closedRes.data ?? []).map((d) => ({
    id: d.id as string,
    status: d.status as 'won' | 'lost',
    lostReason: (d.lost_reason as string | null) ?? null,
    feeAmount: Number(d.fee_amount ?? 0),
    tipAmount: Number(d.tip_amount ?? 0),
    serviceLabel: (d.service_label as string | null) ?? null,
    scheduledDate: (d.scheduled_date as string | null) ?? null,
    contactName: contactName(d),
  }));

  const contacts = (contactsRes.data ?? []).map((c) => ({
    id: c.id as string,
    name: (c.display_name as string | null) ?? 'Unknown contact',
  }));

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="font-semibold">Pipeline</h1>
        <NewDeal stages={stageOptions} contacts={contacts} />
      </header>

      <div className="flex flex-1 gap-3 overflow-x-auto p-4">
        {stages.length === 0 && (
          <p className="text-sm text-muted-foreground">This pipeline has no stages.</p>
        )}
        {stages.map((stage) => {
          const cards = openDeals.filter((d) => d.stageId === stage.id);
          return (
            <div key={stage.id} className="flex w-72 shrink-0 flex-col">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium">{stage.name}</span>
                <span className="text-xs text-muted-foreground">{cards.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 rounded-lg bg-muted/40 p-2">
                {cards.map((d) => (
                  <DealCard key={d.id} deal={d} stages={stageOptions} />
                ))}
                {cards.length === 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">No deals.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ClosedSummary deals={closed} />
    </div>
  );
}
