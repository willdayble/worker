'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { SendHorizontal, Paperclip, Mic, Square, X } from 'lucide-react';
import { stageOutbound, type OutboundAttachmentInput } from '@/app/(dashboard)/inbox/actions';
import { createClient } from '@/lib/supabase/client';

type Pending = OutboundAttachmentInput & { previewUrl?: string; label: string };

const kindFromMime = (mime: string): OutboundAttachmentInput['kind'] =>
  mime.startsWith('image/') ? 'image'
  : mime.startsWith('video/') ? 'video'
  : mime.startsWith('audio/') ? 'audio'
  : 'document';

const extFromMime = (mime: string): string => mime.split('/')[1]?.split(';')[0] || 'bin';

// Composer that STAGES a human-approved draft (CONTRACTS §6: never auto-send). Controlled text +
// optional media: attach an image/video, or record a voice note. Media is uploaded to the private
// outbound-media bucket; clicking send stages bridge_outbound and the worker delivers it.
export function Composer({
  conversationId,
  value,
  onChange,
}: {
  conversationId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sendKey, setSendKey] = useState('Ctrl');
  const [attachment, setAttachment] = useState<Pending | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    const p = navigator.platform || navigator.userAgent || '';
    if (/Mac|iPhone|iPad|iPod/i.test(p)) setSendKey('⌘');
  }, []);

  async function uploadBlob(blob: Blob, mime: string, filename: string | undefined, label: string) {
    setUploading(true);
    setStatus(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setStatus('Not signed in.');
        return;
      }
      const path = `${user.id}/${crypto.randomUUID()}.${extFromMime(mime)}`;
      const { error } = await supabase.storage
        .from('outbound-media')
        .upload(path, blob, { contentType: mime });
      if (error) {
        setStatus('Upload failed.');
        return;
      }
      const previewUrl =
        mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')
          ? URL.createObjectURL(blob)
          : undefined;
      setAttachment({
        bucket: 'outbound-media',
        path,
        kind: kindFromMime(mime),
        mimeType: mime,
        bytes: blob.size,
        filename,
        previewUrl,
        label,
      });
    } finally {
      setUploading(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await uploadBlob(file, file.type || 'application/octet-stream', file.name, file.name);
  }

  async function toggleRecord() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunks.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const mime = rec.mimeType || 'audio/webm';
        await uploadBlob(new Blob(chunks, { type: mime }), mime, undefined, '🎙️ Voice note');
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setStatus('Microphone unavailable.');
    }
  }

  const blocked = pending || uploading || recording;

  function send() {
    const body = value.trim();
    if ((!body && !attachment) || blocked) return;
    setStatus(null);
    const att = attachment;
    startTransition(async () => {
      const res = await stageOutbound(conversationId, body, att ?? undefined);
      if (res.ok) {
        onChange('');
        setAttachment(null);
        setStatus('Sent ✓');
      } else {
        setStatus(res.error ?? 'Failed to send.');
      }
    });
  }

  return (
    <div className="border-t border-border p-3">
      {attachment && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-border p-2">
          {attachment.kind === 'image' && attachment.previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attachment.previewUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
          )}
          {attachment.kind === 'video' && attachment.previewUrl && (
            <video src={attachment.previewUrl} className="h-12 w-12 shrink-0 rounded object-cover" />
          )}
          {/* Voice note: play it back before sending to check it recorded. */}
          {attachment.kind === 'audio' && attachment.previewUrl ? (
            <audio src={attachment.previewUrl} controls className="h-9 flex-1" />
          ) : (
            <span className="flex-1 truncate text-xs text-muted-foreground">{attachment.label}</span>
          )}
          <button
            onClick={() => setAttachment(null)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Remove attachment"
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          onChange={onFile}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={blocked}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label="Attach image or video"
        >
          <Paperclip size={16} />
        </button>
        <button
          onClick={toggleRecord}
          disabled={pending || uploading}
          className={`rounded-md p-2 hover:bg-muted disabled:opacity-50 ${
            recording ? 'text-red-500' : 'text-muted-foreground hover:text-foreground'
          }`}
          aria-label={recording ? 'Stop recording' : 'Record voice note'}
        >
          {recording ? <Square size={16} /> : <Mic size={16} />}
        </button>
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            recording
              ? 'Recording… tap ■ to stop'
              : uploading
                ? 'Uploading…'
                : `Write a reply…  (${sendKey}+Enter to send)`
          }
          className="min-h-[2.5rem] flex-1 resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={send}
          disabled={blocked || (!value.trim() && !attachment)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <SendHorizontal size={15} />
          {pending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {status && <p className="mt-1.5 text-xs text-muted-foreground">{status}</p>}
    </div>
  );
}
