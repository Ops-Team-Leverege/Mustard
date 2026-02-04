# Context Flow Test Scenarios

## Purpose
Systematic test cases to verify context flows correctly through all systems.
Each scenario tests a specific context handoff or edge case.

## Test Categories

### 1. New Thread Scenarios
- [ ] **T1.1**: New thread, no context, company mentioned
  - Input: "what did Les Schwab say about pricing?"
  - Expected: Extract company → SINGLE_MEETING
  - Context Sources: None → Company extraction only

- [ ] **T1.2**: New thread, no context, no company mentioned
  - Input: "what was discussed in the last call?"
  - Expected: Ask for company clarification
  - Context Sources: None → CLARIFY

### 2. Thread Continuation Scenarios
- [ ] **T2.1**: Reply in thread with prior company context
  - Setup: Previous interaction had companyId="123"
  - Input: "what about pricing?"
  - Expected: Use thread company context → SINGLE_MEETING
  - Context Sources: Thread resolver → Company from database

- [ ] **T2.2**: Reply in thread with prior meeting context
  - Setup: Previous interaction had meetingId="456", companyId="123"
  - Input: "what were the next steps?"
  - Expected: Use thread meeting context → SINGLE_MEETING
  - Context Sources: Thread resolver → Meeting + Company from database

### 3. Clarification Response Scenarios
- [ ] **T3.1**: Time range clarification response
  - Setup: Bot asked "What time range?"
  - Input: "last month is fine"
  - Expected: Continue with MULTI_MEETING (not CLARIFY)
  - Context Sources: Thread resolver → Awaiting clarification state

- [ ] **T3.2**: Scope clarification response
  - Setup: Bot asked "Which customers?"
  - Input: "all customers"
  - Expected: Continue with MULTI_MEETING (not CLARIFY)
  - Context Sources: Thread resolver → Awaiting clarification state

- [ ] **T3.3**: Scope clarification with "pilots" language
  - Setup: Bot asked "Which customers?"
  - Input: "across all pilots"
  - Expected: Recognize as "all customers" → MULTI_MEETING
  - Context Sources: LLM interpretation → Scope detection

### 4. Mid-Conversation Bot Mention
- [ ] **T4.1**: Bot mentioned mid-conversation, no prior context
  - Setup: Thread exists but bot never participated
  - Input: "@bot what did we discuss about cameras?"
  - Expected: Scan thread history for company mentions
  - Context Sources: Slack thread history → Company extraction

- [ ] **T4.2**: Bot mentioned mid-conversation, company in thread
  - Setup: Thread mentions "Les Schwab" in earlier messages
  - Input: "@bot what were their concerns?"
  - Expected: Extract company from thread history → SINGLE_MEETING
  - Context Sources: Slack thread history → Company extraction

### 5. Context Override Scenarios
- [ ] **T5.1**: User switches companies mid-thread
  - Setup: Thread context has companyId="123" (Les Schwab)
  - Input: "what about ACE Hardware's pricing?"
  - Expected: Override thread context with new company
  - Context Sources: Current message → Company extraction overrides thread

- [ ] **T5.2**: User explicitly requests different meeting
  - Setup: Thread context has meetingId="456"
  - Input: "show me a different meeting with them"
  - Expected: Override thread meeting context
  - Context Sources: Current message → Meeting resolution overrides thread

### 6. Multi-Round Clarification
- [ ] **T6.1**: Multiple clarification rounds
  - Round 1: "analyze customer feedback" → "Which customers?"
  - Round 2: "all customers" → "What time range?"
  - Round 3: "last quarter" → Execute analysis
  - Expected: Each round builds context, final round executes
  - Context Sources: Thread resolver → Accumulate clarification state

### 7. Mixed Intent Scenarios
- [ ] **T7.1**: Thread with different intent types
  - Setup: Thread had SINGLE_MEETING, now user asks PRODUCT_KNOWLEDGE
  - Input: "how does PitCrew pricing work?"
  - Expected: Switch to PRODUCT_KNOWLEDGE (don't force meeting context)
  - Context Sources: Intent classification overrides thread context

### 8. Edge Cases
- [ ] **T8.1**: Very short clarification responses
  - Setup: Bot asked for clarification
  - Input: "yes"
  - Expected: Use proposed interpretation from thread context
  - Context Sources: Thread resolver → Stored proposed interpretation

- [ ] **T8.2**: Ambiguous company references
  - Setup: Thread mentions multiple companies
  - Input: "what did they say about pricing?"
  - Expected: Ask for company clarification
  - Context Sources: Multiple sources conflict → CLARIFY

- [ ] **T8.3**: Thread context corruption
  - Setup: Database has invalid meetingId/companyId
  - Input: "what were the next steps?"
  - Expected: Graceful fallback, ask for clarification
  - Context Sources: Thread resolver fails → Fallback to message extraction

## Context Source Priority Rules

1. **Explicit Override** (highest priority)
   - User mentions different company/meeting in current message
   - User says "different meeting", "another call", etc.

2. **Thread Database Context**
   - Previous bot interaction stored company/meeting
   - Awaiting clarification state
   - Proposed interpretation for "yes" responses

3. **Slack Thread History**
   - Company mentions in thread messages
   - Bot joining mid-conversation
   - Topic continuity

4. **Current Message Extraction**
   - Company/contact names in current message
   - Intent classification from current message

5. **Fallback** (lowest priority)
   - Ask for clarification
   - Default to GENERAL_HELP

## Logging Checkpoints to Verify

For each test scenario, verify these logs appear:

1. **Thread Resolution**: What context was found in database?
2. **Slack History**: How many messages? Company mentions?
3. **Decision Layer Input**: What context was passed to LLM?
4. **Intent Classification**: How was intent determined?
5. **Final Merge**: What was the final context used?

## Success Criteria

- [ ] All 20+ test scenarios pass
- [ ] Context logging shows clear decision trail
- [ ] No more "last month is fine" → CLARIFY loops
- [ ] "across pilots" recognized as valid scope
- [ ] Bot joining mid-conversation works
- [ ] Context overrides work correctly
- [ ] Graceful fallbacks for edge cases

## Implementation Plan

1. **Phase 1**: Manual testing of critical scenarios (T3.1, T3.3, T4.1)
2. **Phase 2**: Automated test suite for all scenarios
3. **Phase 3**: Load testing with real conversation patterns
4. **Phase 4**: Unified context architecture design