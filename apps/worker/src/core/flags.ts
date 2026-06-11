// Feature flags. The unofficial WhatsApp (Baileys) channel is OFF by default and stays off
// until the kill-test returns a GO verdict (docs/killtest/results.md) AND an operator flips
// this env flag deliberately. Two locks (verdict + flag) so it can't be enabled by accident.
export function isUnofficialWhatsAppEnabled(): boolean {
  return process.env.ENABLE_WHATSAPP_UNOFFICIAL === 'true';
}
