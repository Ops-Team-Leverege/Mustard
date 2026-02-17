/**
 * Unit Tests: Execution Layer - Contract Executor
 * 
 * These tests verify the Contract Executor (server/openAssistant/contractExecutor.ts):
 * - Contract header generation
 * - Coverage qualification logic
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
    getQAPairsByTranscriptId: vi.fn().mockResolvedValue([]),
    getTranscript: vi.fn().mockResolvedValue(null),
  }
}));

vi.mock('./meetingResolver', () => ({
  searchAcrossMeetings: vi.fn().mockResolvedValue('Mock search results'),
}));

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

