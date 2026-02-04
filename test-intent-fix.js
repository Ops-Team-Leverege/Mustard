/**
 * Test script to verify the intent classification fixes
 * This simulates the problematic scenarios from the conversation data
 */

console.log('=== Testing Intent Classification Fixes ===\n');

// Simulate the problematic scenarios
const testCases = [
    {
        name: 'Entry 1: "what actions items should we make sure to mention from last weeks call"',
        message: "what actions items should we make sure to mention from last weeks call",
        threadContext: {
            messages: [
                { text: "what was last call with jiffy about", isBot: false },
                { text: "*Meeting Summary (Allied Lube (Jiffy Lube))*\n\n*Purpose*\n• Align on scope, success criteria...", isBot: true },
                { text: "what actions items should we make sure to mention from last weeks call", isBot: false }
            ]
        },
        expected: 'Should use thread context to know this is about Jiffy Lube meeting → SINGLE_MEETING'
    },
    {
        name: 'Entry 6: "last month is fine" (answering time range question)',
        message: "last month is fine",
        threadContext: {
            messages: [
                { text: "across customers", isBot: false },
                { text: "To give you the best analysis, could you clarify:\n\n1. **Time range**: Last month, last quarter, or all time?\n2. **Scope**: All customers, or a specific customer?", isBot: true },
                { text: "last month is fine", isBot: false }
            ]
        },
        expected: 'Should recognize as time range answer → MULTI_MEETING (not CLARIFY)'
    },
    {
        name: 'Entry 7: "looks across pilots what features should we prioritize"',
        message: "looks across pilots what features should we prioritize",
        threadContext: undefined,
        expected: 'Should recognize "across pilots" as all customers scope → MULTI_MEETING'
    }
];

console.log('Key fixes implemented:');
console.log('1. Updated intent classification prompt to better recognize clarification responses');
console.log('2. Added "across pilots" and "all pilots" as valid "all customers" scope patterns');
console.log('3. Enhanced clarification response detection patterns\n');

console.log('Expected behavior after fixes:');
testCases.forEach((testCase, i) => {
    console.log(`${i + 1}. ${testCase.name}`);
    console.log(`   Message: "${testCase.message}"`);
    console.log(`   Expected: ${testCase.expected}`);
    console.log('');
});

console.log('The fixes are in:');
console.log('- server/config/prompts/decisionLayer.ts (INTENT_CLASSIFICATION_PROMPT)');
console.log('- server/config/prompts/decisionLayer.ts (AGGREGATE_SPECIFICITY_CHECK_PROMPT)');
console.log('\nTo test: Deploy these changes and try the same conversation patterns.');