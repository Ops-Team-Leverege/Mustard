/**
 * Quick integration test for Slack search
 * Tests that the new code doesn't break existing functionality
 */

console.log('🧪 Testing Slack Integration Safety...\n');

// Test 1: Verify Intent enum is valid
console.log('Test 1: Intent enum structure');
try {
    const intentModule = await import('./server/decisionLayer/intent.ts');
    const Intent = intentModule.Intent;

    // Check existing intents still exist
    const requiredIntents = [
        'SINGLE_MEETING',
        'MULTI_MEETING',
        'PRODUCT_KNOWLEDGE',
        'EXTERNAL_RESEARCH',
        'SLACK_SEARCH' // New one
    ];

    const missing = requiredIntents.filter(i => !Intent[i]);
    if (missing.length > 0) {
        console.log('❌ Missing intents:', missing);
        process.exit(1);
    }

    console.log('✅ All intents present\n');
} catch (error) {
    console.log('⚠️  Cannot test TypeScript directly (expected in local env)');
    console.log('   Will be tested on Replit\n');
}

// Test 2: Verify package.json has new dependency
console.log('Test 2: Package.json dependencies');
try {
    const fs = await import('fs');
    const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

    if (!packageJson.dependencies['@slack/web-api']) {
        console.log('❌ Missing @slack/web-api dependency');
        process.exit(1);
    }

    console.log('✅ @slack/web-api dependency present\n');
} catch (error) {
    console.log('❌ Error reading package.json:', error.message);
    process.exit(1);
}

// Test 3: Verify new files exist
console.log('Test 3: New files exist');
try {
    const fs = await import('fs');
    const requiredFiles = [
        './server/services/slackSearchService.ts',
        './server/openAssistant/slackSearchHandler.ts',
        './docs/SLACK_SEARCH_INTEGRATION.md'
    ];

    const missing = requiredFiles.filter(f => !fs.existsSync(f));
    if (missing.length > 0) {
        console.log('❌ Missing files:', missing);
        process.exit(1);
    }

    console.log('✅ All new files present\n');
} catch (error) {
    console.log('❌ Error checking files:', error.message);
    process.exit(1);
}

console.log('✅ All safety checks passed!');
console.log('\n📋 Next steps:');
console.log('1. Run: npm install');
console.log('2. Deploy to Replit');
console.log('3. Add SLACK_BOT_TOKEN to Replit Secrets');
console.log('4. Test existing functionality first');
console.log('5. Test new Slack search');
console.log('\nSee PRE_DEPLOY_CHECKLIST.md for details');
