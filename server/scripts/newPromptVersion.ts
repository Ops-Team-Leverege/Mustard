/**
 * New Prompt Version Helper
 * 
 * Generates the next version number for a prompt and provides a template
 * for updating the version files.
 * 
 * Usage: tsx server/scripts/newPromptVersion.ts INTENT_CLASSIFICATION_PROMPT "Improved company extraction"
 */

import { PROMPT_VERSIONS, PROMPT_CHANGE_LOG, getNextVersion, type PromptVersions } from "../config/prompts/versions";

const args = process.argv.slice(2);

if (args.length < 2) {
    console.error("Usage: tsx server/scripts/newPromptVersion.ts <PROMPT_NAME> <CHANGE_REASON>");
    console.error("\nExample:");
    console.error('  tsx server/scripts/newPromptVersion.ts INTENT_CLASSIFICATION_PROMPT "Improved company extraction"');
    console.error("\nAvailable prompts:");
    Object.keys(PROMPT_VERSIONS).forEach(name => {
        console.error(`  - ${name}`);
    });
    process.exit(1);
}

const promptName = args[0] as keyof PromptVersions;
const changeReason = args.slice(1).join(" ");

if (!(promptName in PROMPT_VERSIONS)) {
    console.error(`Error: Unknown prompt name "${promptName}"`);
    console.error("\nAvailable prompts:");
    Object.keys(PROMPT_VERSIONS).forEach(name => {
        console.error(`  - ${name}`);
    });
    process.exit(1);
}

const currentVersion = PROMPT_VERSIONS[promptName];
const nextVersion = getNextVersion(promptName);
const today = new Date().toISOString().split('T')[0];

console.log("\n📝 New Prompt Version");
console.log("=".repeat(50));
console.log(`Prompt: ${promptName}`);
console.log(`Current Version: ${currentVersion}`);
console.log(`Next Version: ${nextVersion}`);
console.log(`Change Reason: ${changeReason}`);
console.log("=".repeat(50));

console.log("\n✅ Steps to update:");
console.log("\n1. Update the prompt in its source file");
console.log("   (e.g., server/config/prompts/decisionLayer.ts)");

console.log("\n2. Update PROMPT_VERSIONS in server/config/prompts/versions.ts:");
console.log(`   ${promptName}: "${nextVersion}",`);

console.log("\n3. Add to PROMPT_CHANGE_LOG in server/config/prompts/versions.ts:");
console.log(`   ${promptName}: [`);
console.log(`     { version: "${nextVersion}", reason: "${changeReason}", date: "${today}" },`);
console.log(`     { version: "${currentVersion}", reason: "...", date: "..." },`);
console.log(`     // ... existing entries`);
console.log(`   ],`);

console.log("\n4. (Optional) Log to database:");
console.log(`   await storage.insertPromptVersion({`);
console.log(`     promptName: "${promptName}",`);
console.log(`     version: "${nextVersion}",`);
console.log(`     promptText: ${promptName},`);
console.log(`     changeReason: "${changeReason}",`);
console.log(`     changedBy: "your_user_id",`);
console.log(`   });`);

console.log("\n5. Deploy and monitor feedback!");
console.log("");
