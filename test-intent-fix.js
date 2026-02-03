// Quick test to verify the intent classification fix
const testMessage = `an emerging pattern we're seeing with PitCrew, is that after our initial pilot customers wants to expand to 10-20 stores before committing to a large scale rollout across all their stores, and to use that 10-20 store expansion to evaluate the ROI of PitCrew. They want to have clear, objective metrics to look at to see whether PitCrew has a measurable impact. Based on PitCrew's value props, help me think through how we can approach this.`;

// Test the regex pattern that should catch this
const productKnowledgeSignals = /\b(based\s+on\s+pitcrew|pitcrew['']?s?\s+value|our\s+value\s+prop|how\s+(should\s+we|can\s+we|do\s+we)\s+(approach|help|handle)|help\s+me\s+think\s+through|think\s+through\s+how)\b/i;

console.log('Test message:', testMessage.substring(0, 100) + '...');
console.log('Regex matches:', productKnowledgeSignals.test(testMessage));

if (productKnowledgeSignals.test(testMessage)) {
    console.log('✅ PRODUCT_KNOWLEDGE signal detected correctly');
    console.log('Expected intent: PRODUCT_KNOWLEDGE');
} else {
    console.log('❌ PRODUCT_KNOWLEDGE signal NOT detected');
}

// Test what specific part matches
const matches = testMessage.match(productKnowledgeSignals);
if (matches) {
    console.log('Matched text:', matches[0]);
}