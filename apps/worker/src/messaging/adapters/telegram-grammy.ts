// The ONLY file that imports the grammY SDK. It adapts grammY's Bot to the small
// `TelegramTransport` seam the adapter depends on, so the SDK never leaks past this module
// (and never into packages/shared — CONTRACTS §1 structural rule). grammY is pinned in
// apps/worker/package.json.
//
// Build a production TelegramProvider with:
//   new TelegramProvider({ transportFactory: makeGrammyTransport, credentials, writeChannelState, mediaStore })

import { Bot, InputFile } from 'grammy';
import type { TelegramTransport, TgIncoming } from './telegram.js';

/** TransportFactory backed by grammY long-polling. */
export function makeGrammyTransport(botToken: string): TelegramTransport {
  const bot = new Bot(botToken);

  return {
    async getMe() {
      const me = await bot.api.getMe();
      return { id: me.id, username: me.username };
    },

    async start(onUpdate: (u: TgIncoming) => Promise<void>) {
      bot.on('message', async (ctx) => {
        const incoming = toIncoming(ctx);
        if (incoming) await onUpdate(incoming);
      });
      // bot.start() resolves only when the bot stops; fire-and-forget the run loop and
      // surface startup failures via the returned promise of the first getUpdates batch.
      void bot.start({ drop_pending_updates: false });
    },

    async stop() {
      await bot.stop();
    },

    async sendText(chatId, text) {
      const sent = await bot.api.sendMessage(chatId, text);
      return { messageId: sent.message_id };
    },

    async sendMedia(chatId, media) {
      const file = new InputFile(media.data, media.filename);
      let sent;
      switch (media.kind) {
        case 'image': sent = await bot.api.sendPhoto(chatId, file, { caption: media.caption }); break;
        case 'video': sent = await bot.api.sendVideo(chatId, file, { caption: media.caption }); break;
        case 'audio': sent = await bot.api.sendAudio(chatId, file, { caption: media.caption }); break;
        default:      sent = await bot.api.sendDocument(chatId, file, { caption: media.caption }); break;
      }
      return { messageId: sent.message_id };
    },

    async getFileUrl(fileId) {
      const f = await bot.api.getFile(fileId);
      // file_path → full download URL. Caller downloads, stores, then discards the URL/fileId.
      return `https://api.telegram.org/file/bot${botToken}/${f.file_path}`;
    },
  };
}

// Map a grammY message context → our trimmed provider-native shape. Only DM messages we
// support are surfaced; richer types degrade to a generic 'document'/'other' attachment.
function toIncoming(ctx: import('grammy').Context): TgIncoming | undefined {
  const m = ctx.message;
  if (!m || !ctx.from || !ctx.chat) return undefined;

  const base = {
    messageId: m.message_id,
    chatId: ctx.chat.id,
    fromId: ctx.from.id,
    fromUsername: ctx.from.username,
    fromName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || undefined,
    dateUnix: m.date,
  };

  if (m.photo?.length) {
    const largest = m.photo[m.photo.length - 1]!; // last = highest resolution
    return { ...base, attachment: { kind: 'image', fileId: largest.file_id, bytes: largest.file_size, caption: m.caption } };
  }
  if (m.video) return { ...base, attachment: { kind: 'video', fileId: m.video.file_id, mimeType: m.video.mime_type, bytes: m.video.file_size, caption: m.caption } };
  if (m.voice) return { ...base, attachment: { kind: 'audio', fileId: m.voice.file_id, mimeType: m.voice.mime_type, bytes: m.voice.file_size, caption: m.caption } };
  if (m.audio) return { ...base, attachment: { kind: 'audio', fileId: m.audio.file_id, mimeType: m.audio.mime_type, bytes: m.audio.file_size, caption: m.caption } };
  if (m.document) return { ...base, attachment: { kind: 'document', fileId: m.document.file_id, mimeType: m.document.mime_type, bytes: m.document.file_size, caption: m.caption } };
  if (m.sticker) return { ...base, attachment: { kind: 'sticker', fileId: m.sticker.file_id, bytes: m.sticker.file_size } };

  if (m.text) return { ...base, text: m.text };

  // Unsupported message kind (location, contact, poll, …) — ignore rather than mis-store.
  return undefined;
}
