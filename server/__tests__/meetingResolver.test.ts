/**
 * Unit Tests: Meeting Resolver - hasTemporalMeetingReference
 * 
 * These tests verify the regex/LLM handshake for meeting reference detection:
 * - Regex-first fast path (returns immediately without LLM)
 * - LLM fallback when regex misses
 * - Proper result structure { hasMeetingRef, regexResult, llmResult }
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

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
    rawQuery: vi.fn().mockResolvedValue([
      { id: 'company-1', name: 'ACE Hardware' },
      { id: 'company-2', name: 'Ivy Lane (Valvoline)' },
      { id: 'company-3', name: 'Discount Tire' },
    ])
  }
}));

describe('hasTemporalMeetingReference', () => {
  beforeEach(() => {
    vi.resetModules();
    mockOpenAICreate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Regex-only detection (fast path)', () => {
    it('detects "last meeting" pattern without calling LLM', async () => {
      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What was discussed in the last meeting with ACE?');
      
      expect(result.hasMeetingRef).toBe(true);
      expect(result.regexResult).toBe(true);
      expect(result.llmCalled).toBe(false);
      expect(result.llmResult).toBeNull();
      expect(result.llmLatencyMs).toBeNull();
      expect(mockOpenAICreate).not.toHaveBeenCalled();
    });

    it('detects "latest call" pattern without calling LLM', async () => {
      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What happened in the latest call?');
      
      expect(result.hasMeetingRef).toBe(true);
      expect(result.regexResult).toBe(true);
      expect(result.llmResult).toBeNull();
      expect(mockOpenAICreate).not.toHaveBeenCalled();
    });

    it('detects "most recent sync" pattern without calling LLM', async () => {
      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What was promised in our most recent sync with Discount Tire?');
      
      expect(result.hasMeetingRef).toBe(true);
      expect(result.regexResult).toBe(true);
      expect(result.llmResult).toBeNull();
      expect(mockOpenAICreate).not.toHaveBeenCalled();
    });

    it('detects "meeting last week" trailing temporal pattern', async () => {
      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What did they say in the meeting last week?');
      
      expect(result.hasMeetingRef).toBe(true);
      expect(result.regexResult).toBe(true);
      expect(result.llmResult).toBeNull();
      expect(mockOpenAICreate).not.toHaveBeenCalled();
    });

    it('detects "in the last meeting" prepositional pattern', async () => {
      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What did we promise in the last meeting?');
      
      expect(result.hasMeetingRef).toBe(true);
      expect(result.regexResult).toBe(true);
      expect(result.llmResult).toBeNull();
      expect(mockOpenAICreate).not.toHaveBeenCalled();
    });
  });

  describe('LLM fallback (slow path)', () => {
    it('calls LLM when regex misses but LLM detects meeting reference', async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'YES' } }]
      });

      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What happened in our face-to-face with Ivy Lane?');
      
      expect(result.hasMeetingRef).toBe(true);
      expect(result.regexResult).toBe(false);
      expect(result.llmCalled).toBe(true);
      expect(result.llmResult).toBe(true);
      expect(result.llmLatencyMs).toBeTypeOf('number');
      expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    });

    it('calls LLM when regex misses and LLM says NO', async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'NO' } }]
      });

      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('How many meetings have we had with ACE?');
      
      expect(result.hasMeetingRef).toBe(false);
      expect(result.regexResult).toBe(false);
      expect(result.llmResult).toBe(false);
      expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    });

    it('LLM detects "sat down with" as meeting reference', async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'YES' } }]
      });

      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What was discussed when we sat down with ACE?');
      
      expect(result.hasMeetingRef).toBe(true);
      expect(result.regexResult).toBe(false);
      expect(result.llmResult).toBe(true);
    });

    it('LLM detects "during the presentation" as meeting reference', async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'YES' } }]
      });

      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What questions came up during the presentation?');
      
      expect(result.hasMeetingRef).toBe(true);
      expect(result.regexResult).toBe(false);
      expect(result.llmResult).toBe(true);
    });
  });

  describe('Pronoun-only questions (should NOT be meeting references)', () => {
    it('rejects pure pronoun question without meeting context', async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'NO' } }]
      });

      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What is their current POS system?');
      
      expect(result.hasMeetingRef).toBe(false);
      expect(result.regexResult).toBe(false);
      expect(result.llmResult).toBe(false);
    });

    it('rejects general account question', async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'NO' } }]
      });

      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What POS does ACE Hardware use?');
      
      expect(result.hasMeetingRef).toBe(false);
      expect(result.regexResult).toBe(false);
      expect(result.llmResult).toBe(false);
    });
  });

  describe('LLM error handling', () => {
    it('returns false when LLM call fails but still marks llmCalled=true', async () => {
      mockOpenAICreate.mockRejectedValueOnce(new Error('API timeout'));

      const { hasTemporalMeetingReference } = await import('../slack/meetingResolver');
      
      const result = await hasTemporalMeetingReference('What happened in our face-to-face?');
      
      expect(result.hasMeetingRef).toBe(false);
      expect(result.regexResult).toBe(false);
      expect(result.llmCalled).toBe(true);
      expect(result.llmResult).toBe(false);
      expect(result.llmLatencyMs).toBeTypeOf('number');
    });
  });
});

describe('hasTemporalMeetingReferenceSync', () => {
  it('returns true for regex-matched patterns', async () => {
    const { hasTemporalMeetingReferenceSync } = await import('../slack/meetingResolver');
    
    expect(hasTemporalMeetingReferenceSync('What was discussed in the last meeting?')).toBe(true);
    expect(hasTemporalMeetingReferenceSync('What happened in the latest call?')).toBe(true);
    expect(hasTemporalMeetingReferenceSync('During the meeting last week')).toBe(true);
  });

  it('returns false for non-temporal patterns (no LLM fallback)', async () => {
    const { hasTemporalMeetingReferenceSync } = await import('../slack/meetingResolver');
    
    expect(hasTemporalMeetingReferenceSync('What happened in our face-to-face?')).toBe(false);
    expect(hasTemporalMeetingReferenceSync('What is their POS system?')).toBe(false);
  });
});

describe('extractCompanyFromMessage', () => {
  it('matches exact company name', async () => {
    const { extractCompanyFromMessage } = await import('../slack/meetingResolver');
    
    const result = await extractCompanyFromMessage('What happened in the last ACE Hardware meeting?');
    
    expect(result).not.toBeNull();
    expect(result?.companyName).toBe('ACE Hardware');
  });

  it('matches partial name from parenthetical company', async () => {
    const { extractCompanyFromMessage } = await import('../slack/meetingResolver');
    
    const result = await extractCompanyFromMessage('What happened in our face-to-face with Ivy Lane?');
    
    expect(result).not.toBeNull();
    expect(result?.companyName).toBe('Ivy Lane (Valvoline)');
  });

  it('returns null when no company matches', async () => {
    const { extractCompanyFromMessage } = await import('../slack/meetingResolver');
    
    const result = await extractCompanyFromMessage('What happened in the last meeting?');
    
    expect(result).toBeNull();
  });
});
