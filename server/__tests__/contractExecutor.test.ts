/**
 * Unit Tests: Execution Layer - Contract Executor
 * 
 * These tests verify the Contract Executor (server/openAssistant/contractExecutor.ts):
 * - Contract selection based on user message keywords
 * - Contract header generation
 * - Coverage qualification logic
 * - Orchestrator intent to contract mapping
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
    getCompanies: vi.fn().mockResolvedValue([]),
    getCustomerQuestionsByTranscript: vi.fn().mockResolvedValue([]),
    getTranscript: vi.fn().mockResolvedValue(null),
  }
}));

vi.mock('./meetingResolver', () => ({
  searchAcrossMeetings: vi.fn().mockResolvedValue('Mock search results'),
}));

describe('Contract Selection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('selectMultiMeetingContract', () => {
    it('selects PATTERN_ANALYSIS for pattern-related queries', async () => {
      const { selectMultiMeetingContract } = await import('../openAssistant/contractExecutor');
      const { AnswerContract } = await import('../decisionLayer/answerContracts');
      
      expect(selectMultiMeetingContract('What are the common themes?'))
        .toBe(AnswerContract.PATTERN_ANALYSIS);
      expect(selectMultiMeetingContract('What patterns do you see?'))
        .toBe(AnswerContract.PATTERN_ANALYSIS);
      expect(selectMultiMeetingContract('What comes up frequently?'))
        .toBe(AnswerContract.PATTERN_ANALYSIS);
      expect(selectMultiMeetingContract('What do they always ask about?'))
        .toBe(AnswerContract.PATTERN_ANALYSIS);
    });

    it('selects COMPARISON for comparison queries', async () => {
      const { selectMultiMeetingContract } = await import('../openAssistant/contractExecutor');
      const { AnswerContract } = await import('../decisionLayer/answerContracts');
      
      expect(selectMultiMeetingContract('Compare ACE and Discount Tire'))
        .toBe(AnswerContract.COMPARISON);
      expect(selectMultiMeetingContract('What is the difference between these meetings?'))
        .toBe(AnswerContract.COMPARISON);
      expect(selectMultiMeetingContract('Show me the contrast between them'))
        .toBe(AnswerContract.COMPARISON);
      expect(selectMultiMeetingContract('Company A vs Company B'))
        .toBe(AnswerContract.COMPARISON);
    });

    it('selects TREND_SUMMARY for trend-related queries', async () => {
      const { selectMultiMeetingContract } = await import('../openAssistant/contractExecutor');
      const { AnswerContract } = await import('../decisionLayer/answerContracts');
      
      expect(selectMultiMeetingContract('What is the trend over time?'))
        .toBe(AnswerContract.TREND_SUMMARY);
      expect(selectMultiMeetingContract('How has this changed?'))
        .toBe(AnswerContract.TREND_SUMMARY);
      expect(selectMultiMeetingContract('Is interest growing or declining?'))
        .toBe(AnswerContract.TREND_SUMMARY);
      expect(selectMultiMeetingContract('Show me the progression'))
        .toBe(AnswerContract.TREND_SUMMARY);
    });

    it('selects CROSS_MEETING_QUESTIONS for question-related queries', async () => {
      const { selectMultiMeetingContract } = await import('../openAssistant/contractExecutor');
      const { AnswerContract } = await import('../decisionLayer/answerContracts');
      
      expect(selectMultiMeetingContract('What questions did customers ask?'))
        .toBe(AnswerContract.CROSS_MEETING_QUESTIONS);
      expect(selectMultiMeetingContract('Show me concerns from meetings'))
        .toBe(AnswerContract.CROSS_MEETING_QUESTIONS);
      expect(selectMultiMeetingContract('What issues came up?'))
        .toBe(AnswerContract.CROSS_MEETING_QUESTIONS);
      expect(selectMultiMeetingContract('List the objections'))
        .toBe(AnswerContract.CROSS_MEETING_QUESTIONS);
    });

    it('defaults to PATTERN_ANALYSIS for unmatched queries', async () => {
      const { selectMultiMeetingContract } = await import('../openAssistant/contractExecutor');
      const { AnswerContract } = await import('../decisionLayer/answerContracts');
      
      expect(selectMultiMeetingContract('Tell me about the meetings'))
        .toBe(AnswerContract.PATTERN_ANALYSIS);
      expect(selectMultiMeetingContract('What happened?'))
        .toBe(AnswerContract.PATTERN_ANALYSIS);
    });
  });
});

describe('Contract Header Generation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns human-readable header for CROSS_MEETING_QUESTIONS', async () => {
    const { getContractHeader } = await import('../openAssistant/contractExecutor');
    const { AnswerContract } = await import('../decisionLayer/answerContracts');
    
    expect(getContractHeader(AnswerContract.CROSS_MEETING_QUESTIONS))
      .toBe('Customer Questions Across Meetings');
  });

  it('returns human-readable header for PATTERN_ANALYSIS', async () => {
    const { getContractHeader } = await import('../openAssistant/contractExecutor');
    const { AnswerContract } = await import('../decisionLayer/answerContracts');
    
    expect(getContractHeader(AnswerContract.PATTERN_ANALYSIS))
      .toBe('Pattern Analysis');
  });

  it('returns human-readable header for COMPARISON', async () => {
    const { getContractHeader } = await import('../openAssistant/contractExecutor');
    const { AnswerContract } = await import('../decisionLayer/answerContracts');
    
    expect(getContractHeader(AnswerContract.COMPARISON))
      .toBe('Comparison');
  });

  it('returns human-readable header for TREND_SUMMARY', async () => {
    const { getContractHeader } = await import('../openAssistant/contractExecutor');
    const { AnswerContract } = await import('../decisionLayer/answerContracts');
    
    expect(getContractHeader(AnswerContract.TREND_SUMMARY))
      .toBe('Trend Summary');
  });

  it('returns contract name as fallback for unmapped contracts', async () => {
    const { getContractHeader } = await import('../openAssistant/contractExecutor');
    const { AnswerContract } = await import('../decisionLayer/answerContracts');
    
    expect(getContractHeader(AnswerContract.MEETING_SUMMARY))
      .toBe(AnswerContract.MEETING_SUMMARY);
  });
});

describe('Coverage Qualification', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns LIMITED COVERAGE warning for very small samples', async () => {
    const { getCoverageQualification } = await import('../openAssistant/contractExecutor');
    
    const qualification = getCoverageQualification({ totalMeetings: 1, uniqueCompanies: 1 });
    
    expect(qualification).toContain('LIMITED COVERAGE');
    expect(qualification).toContain('1 meeting(s)');
    expect(qualification).toContain('hedged language');
    expect(qualification).toContain('MUST');
  });

  it('returns LIMITED COVERAGE warning for 2 meetings, 1 company', async () => {
    const { getCoverageQualification } = await import('../openAssistant/contractExecutor');
    
    const qualification = getCoverageQualification({ totalMeetings: 2, uniqueCompanies: 1 });
    
    expect(qualification).toContain('LIMITED COVERAGE');
    expect(qualification).toContain('2 meeting(s)');
  });

  it('returns moderate COVERAGE NOTE for medium samples', async () => {
    const { getCoverageQualification } = await import('../openAssistant/contractExecutor');
    
    const qualification = getCoverageQualification({ totalMeetings: 4, uniqueCompanies: 2 });
    
    expect(qualification).toContain('COVERAGE NOTE');
    expect(qualification).toContain('4 meeting(s)');
    expect(qualification).not.toContain('LIMITED COVERAGE');
  });

  it('returns simpler COVERAGE message for larger samples', async () => {
    const { getCoverageQualification } = await import('../openAssistant/contractExecutor');
    
    const qualification = getCoverageQualification({ totalMeetings: 10, uniqueCompanies: 5 });
    
    expect(qualification).toContain('COVERAGE:');
    expect(qualification).toContain('10 meeting(s)');
    expect(qualification).not.toContain('LIMITED COVERAGE');
    expect(qualification).not.toContain('MUST');
  });
});

describe('Orchestrator Intent to Contract Mapping', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps extractive intent to EXTRACTIVE_FACT', async () => {
    const { mapOrchestratorIntentToContract } = await import('../openAssistant/contractExecutor');
    const { AnswerContract } = await import('../decisionLayer/answerContracts');
    
    expect(mapOrchestratorIntentToContract('extractive', AnswerContract.PATTERN_ANALYSIS))
      .toBe(AnswerContract.EXTRACTIVE_FACT);
  });

  it('maps aggregative intent to AGGREGATIVE_LIST', async () => {
    const { mapOrchestratorIntentToContract } = await import('../openAssistant/contractExecutor');
    const { AnswerContract } = await import('../decisionLayer/answerContracts');
    
    expect(mapOrchestratorIntentToContract('aggregative', AnswerContract.PATTERN_ANALYSIS))
      .toBe(AnswerContract.AGGREGATIVE_LIST);
  });

  it('maps summary intent to MEETING_SUMMARY', async () => {
    const { mapOrchestratorIntentToContract } = await import('../openAssistant/contractExecutor');
    const { AnswerContract } = await import('../decisionLayer/answerContracts');
    
    expect(mapOrchestratorIntentToContract('summary', AnswerContract.PATTERN_ANALYSIS))
      .toBe(AnswerContract.MEETING_SUMMARY);
  });

  it('returns chain primary contract for unknown intent', async () => {
    const { mapOrchestratorIntentToContract } = await import('../openAssistant/contractExecutor');
    const { AnswerContract } = await import('../decisionLayer/answerContracts');
    
    expect(mapOrchestratorIntentToContract('unknown' as any, AnswerContract.TREND_SUMMARY))
      .toBe(AnswerContract.TREND_SUMMARY);
  });
});
