import { MessageSquare } from 'lucide-react';

export default function InboxIndex() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <MessageSquare size={28} />
      <p className="text-sm">Select a conversation.</p>
    </div>
  );
}
