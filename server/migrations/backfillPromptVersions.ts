/**
 * Backfill Prompt Versions Migration
 * 
 * This script:
 * 1. Creates initial prompt version records for all prompts
 * 2. Backfills existing interaction_logs with default prompt versions
 * 
 * Run with: tsx server/migrations/backfillPromptVersions.ts
 */

import { storage } from "../storage";
import { PROMPT_VERSIONS, PROMPT_CHANGE_LOG, type PromptVersions } from "../config/prompts/versions";
import * as decisionLayerPrompts from "../config/prompts/decisionLayer";
import * as transcriptPrompts from "../config/prompts/transcript";
import * as singleMeetingPrompts from "../config/prompts/singleMeeting";
import * as externalPrompts from "../config/prompts/external";
import * as extractionPrompts from "../config/prompts/extraction";

// Map prompt names to their actual text
const PROMPT_TEXT_MAP: Record<keyof PromptVersions, string> = {
    INTENT_CLASSIFICATION_PROMPT: decisionLayerPrompts.INTENT_CLASSIFICATION_PROMPT,
    CONTRACT_SELECTION_PROMPT: decisionLayerPrompts.CONTRACT_SELECTION_PROMPT,
    AMBIGUOUS_QUERY_INTERPRETATION_PROMPT: decisionLayerPrompts.AMBIGUOUS_QUERY_INTERPRETATION_PROMPT,
    AGGREGATE_SPECIFICITY_CHECK_PROMPT: decisionLayerPrompts.AGGREGATE_SPECIFICITY_CHECK_PROMPT,
    SEMANTIC_ANSWER_PROMPT: "buildSemanticAnswerPrompt(shape)", // Dynamic prompt
    RAG_MEETING_SUMMARY_SYSTEM_PROMPT: transcriptPrompts.RAG_MEETING_SUMMARY_SYSTEM_PROMPT,
    RAG_QUOTE_SELECTION_SYSTEM_PROMPT: transcriptPrompts.RAG_QUOTE_SELECTION_SYSTEM_PROMPT,
    RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT: transcriptPrompts.RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT,
    RAG_ACTION_ITEMS_SYSTEM_PROMPT: transcriptPrompts.RAG_ACTION_ITEMS_SYSTEM_PROMPT,
    TRANSCRIPT_ANALYZER_SYSTEM_PROMPT: transcriptPrompts.TRANSCRIPT_ANALYZER_SYSTEM_PROMPT,
    MCP_ROUTING_PROMPT: externalPrompts.MCP_ROUTING_PROMPT,
    CUSTOMER_QUESTIONS_EXTRACTION_PROMPT: extractionPrompts.CUSTOMER_QUESTIONS_EXTRACTION_PROMPT,
};

async function main() {
    console.log("Starting prompt versions backfill migration...\n");

    // Step 1: Insert initial prompt versions
    console.log("Step 1: Creating initial prompt version records...");
    let insertedCount = 0;

    for (const [promptName, version] of Object.entries(PROMPT_VERSIONS)) {
        const changeLog = PROMPT_CHANGE_LOG[promptName]?.[0];
        const promptText = PROMPT_TEXT_MAP[promptName as keyof PromptVersions];

        try {
            await storage.insertPromptVersion({
                promptName,
                version,
                promptText,
                changeReason: changeLog?.reason || "Initial version",
                changedBy: "system",
            });
            console.log(`  ✓ Created ${promptName} v${version}`);
            insertedCount++;
        } catch (error: any) {
            // Ignore duplicate key errors (already exists)
            if (error.code === "23505" || error.message?.includes("duplicate")) {
                console.log(`  - ${promptName} v${version} already exists`);
            } else {
                console.error(`  ✗ Failed to create ${promptName}:`, error.message);
            }
        }
    }

    console.log(`\nInserted ${insertedCount} new prompt version records.\n`);

    // Step 2: Backfill existing interaction_logs
    console.log("Step 2: Backfilling existing interaction_logs...");

    // Default prompt versions for backfill (all interactions before this migration)
    const defaultPromptVersions = {
        intent_classification: "2026-02-17-001",
        contract_selection: "2026-02-17-001",
        answer_generation: "2026-02-17-001",
    };

    try {
        // Update all rows where prompt_versions is null
        const result = await storage.rawQuery(
            `UPDATE interaction_logs 
       SET prompt_versions = $1 
       WHERE prompt_versions IS NULL`,
            [JSON.stringify(defaultPromptVersions)]
        );

        console.log(`  ✓ Backfilled ${result.length || 0} interaction records with default prompt versions`);
    } catch (error: any) {
        console.error(`  ✗ Failed to backfill interactions:`, error.message);
    }

    console.log("\n✅ Migration complete!");
    console.log("\nNext steps:");
    console.log("1. Run 'npm run db:push' to apply schema changes to the database");
    console.log("2. Verify the changes in your database");
    console.log("3. Update Slack app settings to subscribe to 'reaction_added' and 'reaction_removed' events");
    console.log("4. Test by reacting to a bot message with 👍 or ❌");
}

main().catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
});
