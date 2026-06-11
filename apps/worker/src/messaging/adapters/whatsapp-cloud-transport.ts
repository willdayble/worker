// The ONLY file that talks to the WhatsApp Cloud (Graph) API. Adapts it to the
// `WhatsAppCloudTransport` seam so the adapter stays SDK-free and unit-testable. Uses global
// `fetch` (Node 18+) — no provider SDK, so nothing leaks toward packages/shared (CONTRACTS §1).
//
// Build a production provider with:
//   new WhatsAppOfficialProvider({ transportFactory: makeCloudTransport, credentials, writeChannelState, mediaStore })

import type {
  WhatsAppCloudTransport, WhatsAppConfig, WaSendResult,
} from './whatsapp-official.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** WaTransportFactory backed by the real Graph API. */
export function makeCloudTransport(config: WhatsAppConfig): WhatsAppCloudTransport {
  const { phoneNumberId, accessToken } = config;
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  /** Graph fetch with Meta error mapping. Throws Error{code:'http_<status>', metaCode:<n>}. */
  async function graph(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${GRAPH}/${path}`, init);
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
    if (!res.ok) {
      // metaCode drives window-closed handling upstream; message is NOT logged (id-only logs).
      throw Object.assign(new Error('graph_error'), { code: `http_${res.status}`, metaCode: json.error?.code });
    }
    return json;
  }

  function messagesPost(payload: Record<string, unknown>): Promise<WaSendResult> {
    return graph(`${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    }).then((j) => ({ messageId: firstMessageId(j) }));
  }

  return {
    async getPhoneNumber() {
      const j = (await graph(`${phoneNumberId}?fields=display_phone_number,verified_name`, { headers: authHeader })) as {
        id?: string; display_phone_number?: string; verified_name?: string;
      };
      return { id: j.id ?? phoneNumberId, displayPhoneNumber: j.display_phone_number, verifiedName: j.verified_name };
    },

    sendText(toE164, text) {
      return messagesPost({ to: toE164, type: 'text', text: { body: text, preview_url: false } });
    },

    sendTemplate(toE164, template) {
      return messagesPost({
        to: toE164, type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          components: template.variables.length
            ? [{ type: 'body', parameters: template.variables.map((t) => ({ type: 'text', text: t })) }]
            : undefined,
        },
      });
    },

    async sendMedia(toE164, media) {
      // Two-step: upload the bytes → media_id, then send by id (CONTRACTS §4 media upload, C4).
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', media.mimeType);
      form.append('file', new Blob([media.data], { type: media.mimeType }), media.filename ?? 'file');
      const up = (await graph(`${phoneNumberId}/media`, { method: 'POST', headers: authHeader, body: form })) as { id?: string };
      const mediaId = up.id;
      return messagesPost({
        to: toE164, type: media.kind,
        [media.kind]: { id: mediaId, caption: media.caption, filename: media.kind === 'document' ? media.filename : undefined },
      });
    },

    async getMediaUrl(mediaId) {
      const j = (await graph(`${mediaId}`, { headers: authHeader })) as { url?: string; mime_type?: string; file_size?: number };
      return { url: j.url ?? '', mimeType: j.mime_type, bytes: j.file_size };
    },

    async downloadMedia(url) {
      // The media CDN url still requires the bearer token.
      const res = await fetch(url, { headers: authHeader });
      if (!res.ok) throw Object.assign(new Error('media_download'), { code: `http_${res.status}` });
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

function firstMessageId(j: unknown): string {
  const id = (j as { messages?: Array<{ id?: string }> }).messages?.[0]?.id;
  if (!id) throw Object.assign(new Error('no_message_id'), { code: 'graph_no_id' });
  return id;
}
