/**
 * Feature Flags
 * 
 * Runtime feature toggles to safely enable/disable features based on environment state.
 */

import { storage } from "../storage";

const PG_TABLE_NOT_FOUND = "42P01";

let feedbackSystemEnabled: boolean | null = null;

/**
 * Check if the feedback system is enabled.
 * 
 * This checks if the required database tables exist before enabling the feature.
 * Prevents crashes if the migration hasn't been run yet.
 */
export async function isFeedbackSystemEnabled(): Promise<boolean> {
    // Cache the result to avoid repeated database checks
    if (feedbackSystemEnabled !== null) {
        return feedbackSystemEnabled;
    }

    try {
        // Try to query the new tables to see if they exist
        await storage.rawQuery(
            "SELECT 1 FROM prompt_versions LIMIT 1",
            []
        );
        await storage.rawQuery(
            "SELECT 1 FROM interaction_feedback LIMIT 1",
            []
        );

        // Also check if the new column exists
        await storage.rawQuery(
            "SELECT prompt_versions FROM interaction_logs LIMIT 1",
            []
        );

        console.log("[FeatureFlags] Feedback system enabled - database schema is ready");
        feedbackSystemEnabled = true;
        return true;
    } catch (error: any) {
        // If tables don't exist, disable the feature
        if (error.message?.includes("does not exist") || error.code === PG_TABLE_NOT_FOUND) {
            console.log("[FeatureFlags] Feedback system disabled - database migration not yet applied");
            console.log("[FeatureFlags] Run 'npm run db:push' and 'tsx server/migrations/backfillPromptVersions.ts' to enable");
            feedbackSystemEnabled = false;
            return false;
        }

        // For other errors, log but don't crash
        console.error("[FeatureFlags] Error checking feedback system status:", error);
        feedbackSystemEnabled = false;
        return false;
    }
}

/**
 * Reset the cached feature flag state.
 * Useful for testing or after running migrations.
 */
export function resetFeatureFlags(): void {
    feedbackSystemEnabled = null;
}
