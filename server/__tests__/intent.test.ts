/**
 * Unit Tests: Decision Layer - Intent Classification
 * 
 * These tests verify the Intent Router (server/decisionLayer/intent.ts):
 * - Keyword-based fast path classification
 * - Pattern-based classification
 * - Multi-intent detection (should return CLARIFY)
 * - REFUSE pattern detection
 * - Entity detection (companies, contacts)
 * - LLM fallback behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockOpenAICreate = vi.fn();

vi.mock('openai', () => {
  return {
    OpenAI: class MockOpenAI {
      chat = {
        completions: {
          create: mockOpenAICreate
        }
      };
    }
  };
});

vi.mock('../storage', () => ({
  storage: {
    rawQuery: vi.fn().mockResolvedValue([]),
    getCompanies: vi.fn().mockResolvedValue([
      { id: 'company-1', name: 'ACE Hardware' },
      { id: 'company-2', name: 'Les Schwab' },
      { id: 'company-3', name: 'Discount Tire' },
    ])
  }
}));

vi.mock('../decisionLayer/llmInterpretation', () => ({
  interpretAmbiguousQuery: vi.fn().mockResolvedValue({
    proposedInterpretation: {
      intent: 'GENERAL_HELP',
      contract: 'general_help',
      summary: 'Mock interpretation'
    },
    alternatives: [],
    clarifyMessage: 'Please clarify your request.',
  }),
  validateLowConfidenceIntent: vi.fn().mockResolvedValue({
    confirmed: true,
    suggestedIntent: null,
    reason: 'Mock validation confirmed',
  }),
}));

describe('Intent Classification', () => {
  beforeEach(() => {
    vi.resetModules();
    mockOpenAICreate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SINGLE_MEETING keyword detection', () => {
    it('detects "last meeting" as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What did we discuss in the last meeting?');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
      expect(result.intentDetectionMethod).toMatch(/keyword|pattern/);
    });

    it('detects "action items" as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What are the action items?');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
    });

    it('detects "next steps" as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What were the next steps from the call?');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
    });

    it('detects "customer questions" as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What customer questions were asked?');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
    });

    it('detects "summarize the meeting" as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Summarize the meeting');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
    });

    it('detects "yesterday" temporal reference as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What happened yesterday?');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
    });
  });

  describe('MULTI_MEETING keyword detection', () => {
    it('detects "across all meetings" as MULTI_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Which calls mention pricing across all meetings?');
      
      expect(result.intent).toBe(Intent.MULTI_MEETING);
    });

    it('detects "trend" as MULTI_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What is the trend over time?');
      
      expect(result.intent).toBe(Intent.MULTI_MEETING);
    });

    it('detects "which meetings mention" as MULTI_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Which meetings mention pricing?');
      
      expect(result.intent).toBe(Intent.MULTI_MEETING);
    });

    it('detects "recent calls" as MULTI_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What did we hear in recent calls about integration?');
      
      expect(result.intent).toBe(Intent.MULTI_MEETING);
    });

    it('detects "find all" as MULTI_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Find all mentions of safety concerns');
      
      expect(result.intent).toBe(Intent.MULTI_MEETING);
    });
  });

  describe('PRODUCT_KNOWLEDGE keyword detection', () => {
    it('detects "what is pitcrew" as PRODUCT_KNOWLEDGE', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What is PitCrew?');
      
      expect(result.intent).toBe(Intent.PRODUCT_KNOWLEDGE);
    });

    it('detects "pitcrew pricing" as PRODUCT_KNOWLEDGE', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What is the PitCrew pricing?');
      
      expect(result.intent).toBe(Intent.PRODUCT_KNOWLEDGE);
    });

    it('detects "does pitcrew support" as PRODUCT_KNOWLEDGE', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Does PitCrew support camera integration?');
      
      expect(result.intent).toBe(Intent.PRODUCT_KNOWLEDGE);
    });

    it('detects "pro tier" as PRODUCT_KNOWLEDGE', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What features are in the Pro tier?');
      
      expect(result.intent).toBe(Intent.PRODUCT_KNOWLEDGE);
    });

    it('detects "FAQ" as PRODUCT_KNOWLEDGE', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Update the FAQ with the new pricing');
      
      expect(result.intent).toBe(Intent.PRODUCT_KNOWLEDGE);
    });
  });

  describe('EXTERNAL_RESEARCH keyword detection', () => {
    it('detects "do research on" as EXTERNAL_RESEARCH', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Do research on that customer');
      
      expect(result.intent).toBe(Intent.EXTERNAL_RESEARCH);
    });

    it('detects "recent earnings" as EXTERNAL_RESEARCH', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What were their recent earnings?');
      
      expect(result.intent).toBe(Intent.EXTERNAL_RESEARCH);
    });

    it('detects "slide deck for" as EXTERNAL_RESEARCH', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Create a slide deck for the presentation');
      
      expect(result.intent).toBe(Intent.EXTERNAL_RESEARCH);
    });

    it('detects "competitor research" as EXTERNAL_RESEARCH', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('I need competitor research on their main rivals');
      
      expect(result.intent).toBe(Intent.EXTERNAL_RESEARCH);
    });

    it('detects "industry practices" as EXTERNAL_RESEARCH', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What are the industry practices for tire shops?');
      
      expect(result.intent).toBe(Intent.EXTERNAL_RESEARCH);
    });
  });

  describe('REFUSE pattern detection', () => {
    it('refuses weather questions', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What is the weather in Seattle?');
      
      expect(result.intent).toBe(Intent.REFUSE);
      expect(result.intentDetectionMethod).toBe('pattern');
    });

    it('refuses stock price questions', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What is the stock price of Apple?');
      
      expect(result.intent).toBe(Intent.REFUSE);
    });

    it('refuses joke requests', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Tell me a joke');
      
      expect(result.intent).toBe(Intent.REFUSE);
    });

    it('refuses poem writing requests', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Write me a poem about cars');
      
      expect(result.intent).toBe(Intent.REFUSE);
    });
  });

  describe('GENERAL_HELP keyword detection', () => {
    it('detects "what can you do" as GENERAL_HELP', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What can you do?');
      
      expect(result.intent).toBe(Intent.GENERAL_HELP);
    });

    it('detects "hello" as GENERAL_HELP', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Hello!');
      
      expect(result.intent).toBe(Intent.GENERAL_HELP);
    });

    it('detects "draft an email" as GENERAL_HELP', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Help me draft an email to the client');
      
      expect(result.intent).toBe(Intent.GENERAL_HELP);
    });
  });

  describe('Single-intent invariant enforcement', () => {
    it('returns CLARIFY when multi-intent pattern is detected', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Summarize the meeting and then email the pricing');
      
      expect(result.intent).toBe(Intent.CLARIFY);
      expect(result.needsSplit).toBe(true);
    });
  });

  describe('Pattern-based classification', () => {
    it('detects "what did X say" pattern as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What did John say about the timeline?');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
      expect(result.intentDetectionMethod).toMatch(/pattern|keyword/);
    });

    it('detects "who was on the call" pattern as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Who was on the call with ACE?');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
    });

    it('detects "find all questions" pattern as MULTI_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Find all the questions about integration');
      
      expect(result.intent).toBe(Intent.MULTI_MEETING);
    });

    it('detects "everyone who asked" pattern as MULTI_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Everyone who asked about pricing');
      
      expect(result.intent).toBe(Intent.MULTI_MEETING);
    });
  });

  describe('Confidence levels', () => {
    it('returns high confidence for clear keyword matches', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What are the action items from the last meeting?');
      
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('returns high confidence for CLARIFY with multi-intent pattern', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Summarize the meeting and then email the pricing');
      
      expect(result.intent).toBe(Intent.CLARIFY);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('Decision metadata for observability', () => {
    it('includes matched signals in metadata', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Find all mentions of safety');
      
      expect(result.decisionMetadata?.matchedSignals).toBeDefined();
      expect(Array.isArray(result.decisionMetadata?.matchedSignals)).toBe(true);
    });

    it('includes splitOptions when multi-intent pattern detected', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Summarize the meeting and then email the pricing');
      
      expect(result.intent).toBe(Intent.CLARIFY);
      expect(result.splitOptions).toBeDefined();
      expect(Array.isArray(result.splitOptions)).toBe(true);
    });
  });
});

describe('EXTERNAL_RESEARCH + PRODUCT_KNOWLEDGE resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    mockOpenAICreate.mockReset();
  });

  it('resolves to EXTERNAL_RESEARCH when both match (chains product knowledge)', async () => {
    const { classifyIntent, Intent } = await import('../decisionLayer/intent');
    
    const result = await classifyIntent('Research their company website and compare to our PitCrew features');
    
    expect(result.intent).toBe(Intent.EXTERNAL_RESEARCH);
    expect(result.reason).toContain('chain');
  });
});
