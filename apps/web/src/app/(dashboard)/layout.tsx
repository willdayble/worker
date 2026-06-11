import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Inbox, Users, KanbanSquare } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

// Authenticated shell: a thin left nav + the active surface. Server component —
// resolves the user (RLS subject) and bounces to /login if the session is gone.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  async function signOut() {
    'use server';
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect('/login');
  }

  return (
    <div className="flex h-screen">
      <nav className="flex w-56 shrink-0 flex-col border-r border-border p-3">
        <div className="px-2 py-3 text-sm font-semibold">WorkerApp</div>
        <div className="flex flex-1 flex-col gap-1">
          <NavLink href="/inbox" icon={<Inbox size={16} />} label="Inbox" />
          <NavLink href="/contacts" icon={<Users size={16} />} label="Contacts" />
          <NavLink href="/pipeline" icon={<KanbanSquare size={16} />} label="Pipeline" />
        </div>
        <div className="border-t border-border pt-2">
          <p className="truncate px-2 pb-2 text-xs text-muted-foreground">{user.email}</p>
          <form action={signOut}>
            <button className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted">
              Sign out
            </button>
          </form>
        </div>
      </nav>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function NavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {icon}
      {label}
    </Link>
  );
}
