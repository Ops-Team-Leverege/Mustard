/**
 * Test script to verify the customer context fix
 * 
 * This simulates the scenario where:
 * 1. User mentions a customer name in their message
 * 2. The bot should extract and use that customer information
 * 3. Instead of asking generic clarification questions
 */

const { extractCompanyFromMessage } = require('./server/slack/context/meetingResolver');

async function testCustomerContextFix() {
    console.log('Testing customer context extraction...');

    // Test the scenario from the screenshot
    const testMessage = "I believe we talked with Ivy Lane about cameras. I can't remember which call it was on and what the answer was. Search all recent calls and let me know the answer";

    try {
        const companyInfo = await extractCompanyFromMessage(testMessage);

        if (companyInfo) {
            console.log('✅ SUCCESS: Company extracted from message');
            console.log(`   Company ID: ${companyInfo.companyId}`);
            console.log(`   Company Name: ${companyInfo.companyName}`);
        } else {
            console.log('❌ FAILED: No company extracted from message');
            console.log('   This means the bot will ask generic clarification questions');
        }

        // Test conversation context format
        const conversationContext = `Company: ${companyInfo?.companyName || 'unknown'}`;
        console.log(`\nConversation context that will be passed: "${conversationContext}"`);

        // Test context parsing
        const companyMatch = conversationContext.match(/Company:\s*(.+)/);
        if (companyMatch) {
            console.log(`✅ Context parsing works: "${companyMatch[1].trim()}"`);
        } else {
            console.log('❌ Context parsing failed');
        }

    } catch (error) {
        console.error('Error testing customer context:', error);
    }
}

// Run the test
testCustomerContextFix().catch(console.error);