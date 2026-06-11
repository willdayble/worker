'use client';

import { useState } from 'react';
import { AiPanel } from './ai-panel';
import { Composer } from './composer';

// Owns the draft text so the AI panel's "Use as draft" can pre-fill the composer.
// The composer stays the only path to (human-approved) sending.
export function ThreadAssist({ conversationId }: { conversationId: string }) {
  const [draft, setDraft] = useState('');
  return (
    <>
      <AiPanel conversationId={conversationId} onUseDraft={setDraft} />
      <Composer conversationId={conversationId} value={draft} onChange={setDraft} />
    </>
  );
}
