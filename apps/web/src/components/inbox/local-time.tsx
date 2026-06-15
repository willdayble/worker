'use client';

import { useEffect, useState } from 'react';

// Renders a timestamp in the BROWSER's timezone. The thread is server-rendered (Vercel runs in
// UTC), so formatting there shows UTC — wrong for the user. We format on the client instead. SSR /
// first paint renders empty (matches the server, so no hydration mismatch); the local time fills in
// on mount and persists across the inbox's soft refreshes.
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    setText(
      new Date(iso).toLocaleString([], {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  }, [iso]);
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
