/**
 * Slack Configuration Checker
 * 
 * Validates that the Slack app has the required scopes and event subscriptions
 * for the feedback system to work.
 */

/**
 * Check if Slack app is properly configured for feedback system.
 * 
 * This is a runtime check that logs warnings if configuration is missing.
 * It doesn't prevent the app from running, but alerts developers to configuration issues.
 */
export function checkSlackFeedbackConfiguration(): void {
    console.log("\n=== Slack Feedback System Configuration Check ===");

    // Check if SLACK_BOT_TOKEN exists
    if (!process.env.SLACK_BOT_TOKEN) {
        console.warn("⚠️  SLACK_BOT_TOKEN not found - Slack integration will not work");
        return;
    }

    console.log("✓ SLACK_BOT_TOKEN found");

    // Log instructions for manual verification
    console.log("\n📋 Manual verification required:");
    console.log("   1. Go to https://api.slack.com/apps");
    console.log("   2. Select your PitCrew app");
    console.log("   3. Check 'OAuth & Permissions' → 'Bot Token Scopes'");
    console.log("      Required: reactions:read");
    console.log("   4. Check 'Event Subscriptions' → 'Subscribe to bot events'");
    console.log("      Required: reaction_added, reaction_removed");
    console.log("\n   If missing, add them and reinstall the app to your workspace.");
    console.log("=".repeat(50) + "\n");
}
