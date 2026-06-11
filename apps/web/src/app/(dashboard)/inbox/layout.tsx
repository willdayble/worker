import { ConversationList } from '@/components/inbox/conversation-list';

// Two-pane inbox: the conversation list persists while the thread (children)
// swaps per route.
export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-border">
        <div className="border-b border-border px-4 py-3 font-semibold">Inbox</div>
        <ConversationList />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">{children}</section>
    </div>
  );
}
