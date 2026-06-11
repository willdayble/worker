import { describe, it, expect } from 'vitest';
import { routeInbound, DEFAULT_CONFIDENCE_THRESHOLD, type InboundAnalysis } from '../dist/index.js';

function analysis(overrides: Partial<InboundAnalysis> = {}): InboundAnalysis {
  return {
    is_booking: false,
    intent_tags: [],
    service_tags: [],
    red_flags: [],
    suggested_reply: '',
    confidence: 0,
    ...overrides,
  };
}

describe('routeInbound — deterministic confidence routing (CONTRACTS §6)', () => {
  it('auto-tags and stages a draft at/above the threshold', () => {
    const r = routeInbound(analysis({ confidence: 0.9, suggested_reply: 'Sure, 7pm works.' }));
    expect(r.autoTag).toBe(true);
    expect(r.stageDraft).toBe(true);
    expect(r.escalate).toBe(false);
  });

  it('escalates below the threshold (no auto-tag, no draft)', () => {
    const r = routeInbound(analysis({ confidence: 0.4, suggested_reply: 'Hi there.' }));
    expect(r.autoTag).toBe(false);
    expect(r.stageDraft).toBe(false);
    expect(r.escalate).toBe(true);
  });

  it('does not stage a draft when the reply is empty even if confident', () => {
    const r = routeInbound(analysis({ confidence: 0.95, suggested_reply: '   ' }));
    expect(r.autoTag).toBe(true);
    expect(r.stageDraft).toBe(false);
  });

  it('treats the exact threshold as confident (≥)', () => {
    const r = routeInbound(
      analysis({ confidence: DEFAULT_CONFIDENCE_THRESHOLD, suggested_reply: 'ok' }),
    );
    expect(r.autoTag).toBe(true);
  });

  it('passes red flags through as advisory and never exposes send/block', () => {
    const r = routeInbound(analysis({ confidence: 0.9, red_flags: ['aggressive language'] }));
    expect(r.advisoryRedFlags).toEqual(['aggressive language']);
    // structural guarantee: routing can never express an automated send or block
    expect(Object.keys(r)).toEqual(['autoTag', 'stageDraft', 'escalate', 'advisoryRedFlags']);
    expect(Object.keys(r)).not.toContain('send');
    expect(Object.keys(r)).not.toContain('block');
  });

  it('honors a custom threshold', () => {
    expect(routeInbound(analysis({ confidence: 0.6 }), 0.5).escalate).toBe(false);
    expect(routeInbound(analysis({ confidence: 0.6 }), 0.8).escalate).toBe(true);
  });
});
