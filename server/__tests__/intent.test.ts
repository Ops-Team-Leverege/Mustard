/**
 * Unit Tests: Decision Layer - Intent Classification (LLM-First Architecture)
 * 
 * These tests verify the Intent Router (server/decisionLayer/intent.ts):
 * - Minimal fast-paths (no LLM cost): REFUSE, simple greetings, multi-intent
 * - Entity detection for known companies/contacts
 * - LLM-based semantic classification for all other queries
 * 
 * NOTE: Since we use LLM-first classification, most tests verify that queries
 * fall through to LLM interpretation rather than being matched by patterns.
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

describe('Intent Classification - LLM-First Architecture', () => {
  beforeEach(() => {
    vi.resetModules();
    mockOpenAICreate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Minimal Fast-Paths (No LLM Cost)', () => {
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

    describe('Simple greetings as GENERAL_HELP', () => {
      it('detects "hello" as GENERAL_HELP', async () => {
        const { classifyIntent, Intent } = await import('../decisionLayer/intent');
        
        // Note: Must match exactly (no punctuation) for fast-path detection
        const result = await classifyIntent('hello');
        
        expect(result.intent).toBe(Intent.GENERAL_HELP);
      });

      it('detects "thanks!" as GENERAL_HELP', async () => {
        const { classifyIntent, Intent } = await import('../decisionLayer/intent');
        
        // "thanks!" is in SIMPLE_GREETINGS list
        const result = await classifyIntent('thanks!');
        
        expect(result.intent).toBe(Intent.GENERAL_HELP);
      });

      it('detects "hi" as GENERAL_HELP', async () => {
        const { classifyIntent, Intent } = await import('../decisionLayer/intent');
        
        const result = await classifyIntent('hi');
        
        expect(result.intent).toBe(Intent.GENERAL_HELP);
      });
    });

    describe('Multi-intent detection returns CLARIFY', () => {
      it('returns CLARIFY when multi-intent pattern is detected', async () => {
        const { classifyIntent, Intent } = await import('../decisionLayer/intent');
        
        const result = await classifyIntent('Summarize the meeting and then email the pricing');
        
        expect(result.intent).toBe(Intent.CLARIFY);
        expect(result.needsSplit).toBe(true);
      });

      it('returns high confidence for CLARIFY with multi-intent pattern', async () => {
        const { classifyIntent, Intent } = await import('../decisionLayer/intent');
        
        const result = await classifyIntent('Summarize the meeting and then email the pricing');
        
        expect(result.intent).toBe(Intent.CLARIFY);
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
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

  describe('LLM-Based Classification (Semantic Understanding)', () => {
    it('falls through to LLM interpretation for meeting queries', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What did we discuss in the last meeting?');
      
      // With LLM mocked to return GENERAL_HELP, verifies it goes to LLM path
      // 'default' or 'llm_interpretation' both indicate LLM-based classification
      expect(['llm_interpretation', 'default']).toContain(result.intentDetectionMethod);
      // Should NOT use keyword/pattern matching
      expect(result.intentDetectionMethod).not.toBe('keyword');
      expect(result.intentDetectionMethod).not.toBe('pattern');
    });

    it('uses LLM for product knowledge questions', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What is PitCrew?');
      
      // LLM handles this - 'default' or 'llm_interpretation' both mean LLM path
      expect(['llm_interpretation', 'default']).toContain(result.intentDetectionMethod);
    });

    it('uses LLM for external research questions', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Do research on that customer');
      
      // LLM handles this - 'default' or 'llm_interpretation' both mean LLM path
      expect(['llm_interpretation', 'default']).toContain(result.intentDetectionMethod);
    });

    it('uses LLM for document search questions', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Find all mentions of safety concerns');
      
      // LLM handles this - 'default' or 'llm_interpretation' both mean LLM path
      expect(['llm_interpretation', 'default']).toContain(result.intentDetectionMethod);
    });
  });

  describe('Entity Detection (Company/Contact Names)', () => {
    it('detects known company name and routes appropriately', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Tell me about ACE Hardware');
      
      // Entity detection provides meeting intent fast-path for known companies
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
      expect(result.intentDetectionMethod).toBe('entity');
    });

    it('detects another known company name', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What did Les Schwab say?');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
      expect(result.intentDetectionMethod).toBe('entity');
    });
  });

  describe('LLM-First Architecture Verification', () => {
    it('does not use keyword matching for semantic queries', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      // This query should go to LLM, not keyword matching
      const result = await classifyIntent('What are the action items?');
      
      // With LLM mocked, it falls through to interpretation
      // The method should be 'llm_interpretation', not 'keyword' or 'pattern'
      expect(result.intentDetectionMethod).not.toBe('keyword');
      expect(result.intentDetectionMethod).not.toBe('pattern');
    });

    it('avoids pattern conflicts by using LLM', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      // This query could match multiple patterns in the old system
      // Now it goes to LLM for proper semantic understanding
      const result = await classifyIntent('What does PitCrew do?');
      
      // Should use LLM interpretation or default (which triggers LLM), not conflicting patterns
      expect(['llm_interpretation', 'default']).toContain(result.intentDetectionMethod);
    });
  });

  // ============================================================================
  // REGRESSION TESTS: Specific failing queries from stress tests
  // ============================================================================
  describe('Regression: Singular vs Plural Meeting Detection', () => {
    it('classifies "last Pomp\'s call" as SINGLE_MEETING (singular)', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What warranty terms were discussed in the last Pomp\'s call?');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
      // Can be pattern or entity detection - both are valid fast-paths
      expect(['pattern', 'entity']).toContain(result.intentDetectionMethod);
    });

    it('classifies "last Les Schwab check-in" as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('List all the open items from our last Les Schwab check-in.');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
      // Can be pattern or entity detection - both are valid fast-paths
      expect(['pattern', 'entity']).toContain(result.intentDetectionMethod);
    });

    it('does NOT match plural "last 3 meetings" as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What are the key takeaways from our last 3 meetings?');
      
      // Should NOT be SINGLE_MEETING - should go to LLM or MULTI_MEETING
      expect(result.intent).not.toBe(Intent.SINGLE_MEETING);
    });
  });

  describe('Regression: Our Approach vs External Research', () => {
    it('classifies "our recommended approach" as PRODUCT_KNOWLEDGE', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What\'s our recommended approach for a 10-20 store expansion pilot?');
      
      expect(result.intent).toBe(Intent.PRODUCT_KNOWLEDGE);
    });

    it('classifies "our messaging for" as PRODUCT_KNOWLEDGE', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What\'s our messaging for multi-location benchmarking?');
      
      expect(result.intent).toBe(Intent.PRODUCT_KNOWLEDGE);
    });

    it('classifies "based on PitCrew value props" as PRODUCT_KNOWLEDGE', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('Based on PitCrew\'s value props, help me think through how we can approach this.');
      
      expect(result.intent).toBe(Intent.PRODUCT_KNOWLEDGE);
    });

    it('classifies "based on PitCrew value props" with business context as PRODUCT_KNOWLEDGE', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      // This has "across all their stores" which should NOT trigger multi-meeting context
      const result = await classifyIntent('pilot customers wants to expand to 10-20 stores before committing to a large scale rollout across all their stores. Based on PitCrew\'s value props, help me think through how we can approach this.');
      
      expect(result.intent).toBe(Intent.PRODUCT_KNOWLEDGE);
    });

    it('classifies "how should I describe" as PRODUCT_KNOWLEDGE', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('How should I describe our mobile app capabilities?');
      
      expect(result.intent).toBe(Intent.PRODUCT_KNOWLEDGE);
    });
  });

  describe('Regression: False Positive Prevention', () => {
    it('does NOT match "our strategy across all customers" as PRODUCT_KNOWLEDGE (aggregate context)', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What is our strategy based on what we heard across all customers?');
      
      // Should NOT be PRODUCT_KNOWLEDGE due to multi-meeting context
      expect(result.intent).not.toBe(Intent.PRODUCT_KNOWLEDGE);
    });

    it('does NOT match "last quarter meetings" as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What trends did we see in last quarter\'s meetings?');
      
      // Should NOT be SINGLE_MEETING due to aggregate phrase
      expect(result.intent).not.toBe(Intent.SINGLE_MEETING);
    });

    it('does NOT match "recent calls" as SINGLE_MEETING', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      const result = await classifyIntent('What patterns emerged from recent calls?');
      
      // Should NOT be SINGLE_MEETING due to aggregate phrase
      expect(result.intent).not.toBe(Intent.SINGLE_MEETING);
    });

    it('prioritizes SINGLE_MEETING over PRODUCT_KNOWLEDGE for "our messaging in last call"', async () => {
      const { classifyIntent, Intent } = await import('../decisionLayer/intent');
      
      // This tests the conflict: "our messaging" could match PRODUCT_KNOWLEDGE
      // but "last Les Schwab call" should win and route to SINGLE_MEETING
      const result = await classifyIntent('What was our messaging in the last Les Schwab call?');
      
      expect(result.intent).toBe(Intent.SINGLE_MEETING);
    });
  });
});
