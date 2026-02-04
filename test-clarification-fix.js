/**
 * Test script to verify clarification response handling
 */

import { runDecisionLayer } from './server/decisionLayer/index.ts';

async function testClarificationResponses() {
    console.log('Testing clarification response handling...\n');

    // Test case 1: "last month is fine" after bot asked for time range
    const threadContext1 = {
        messages: [
            { text: "across customers", isBot: false },
            { text: "To give you the best analysis, could you clarify:\n\n1. **Time range**: Last month, last quarter, or all time?\n2. **Scope**: All customers, or a specific customer?", isBot: true },
            { text: "last month is fine", isBot: false }
        ]
    };

    console.log('Test 1: "last month is fine" after clarification request');
    const result1 = await runDecisionLayer("last month is fine", threadContext1);
    console.log(`Intent: ${result1.intent}, Method: ${result1.intentDetectionMethod}`);
    console.log(`Expected: MULTI_MEETING, Actual: ${result1.intent === 'MULTI_MEETING' ? 'PASS' : 'FAIL'}\n`);

    // Test case 2: "looks across pilots what features should we prioritize"
    const result2 = await runDecisionLayer("looks across pilots what features should we prioritize");
    console.log('Test 2: "looks across pilots what features should we prioritize"');
    console.log(`Intent: ${result2.intent}, Method: ${result2.intentDetectionMethod}`);
    console.log(`Scope: ${JSON.stringify(result2.scope)}`);
    console.log(`Expected: MULTI_MEETING with allCustomers=true, Actual: ${result2.intent === 'MULTI_MEETING' && result2.scope?.allCustomers ? 'PASS' : 'FAIL'}\n`);

    // Test case 3: "across all pilots" as scope answer
    const threadContext3 = {
        messages: [
            { text: "what features should we prioritize", isBot: false },
            { text: "Would you like me to look at:\n\n- **All customers** - patterns across everyone\n- **A specific customer** - just mention their name", isBot: true },
            { text: "across all pilots", isBot: false }
        ]
    };

    console.log('Test 3: "across all pilots" after scope clarification');
    const result3 = await runDecisionLayer("across all pilots", threadContext3);
    console.log(`Intent: ${result3.intent}, Method: ${result3.intentDetectionMethod}`);
    console.log(`Expected: MULTI_MEETING, Actual: ${result3.intent === 'MULTI_MEETING' ? 'PASS' : 'FAIL'}\n`);
}

testClarificationResponses().catch(console.error);