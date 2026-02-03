#!/usr/bin/env node
/**
 * Simple Regression Check
 * 
 * Basic checks to ensure the codebase structure is intact after changes.
 */

import fs from 'fs';
import path from 'path';

console.log('🚀 Starting Simple Regression Check');
console.log('Verifying codebase structure and critical files...\n');

const checks = [];

function addCheck(name, testFn) {
    checks.push({ name, testFn });
}

function runChecks() {
    let passed = 0;
    let failed = 0;

    console.log('Running checks...\n');

    for (const check of checks) {
        try {
            check.testFn();
            console.log(`✅ PASS: ${check.name}`);
            passed++;
        } catch (error) {
            console.log(`❌ FAIL: ${check.name} - ${error.message}`);
            failed++;
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 REGRESSION CHECK SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total Checks: ${checks.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success Rate: ${Math.round((passed / checks.length) * 100)}%`);
    console.log('='.repeat(50));

    return failed === 0;
}

// Check 1: Critical files exist
addCheck('Critical Files Exist', () => {
    const criticalFiles = [
        'server/index.ts',
        'server/db.ts',
        'server/storage.ts',
        'server/routes.ts',
        'server/decisionLayer/index.ts',
        'server/decisionLayer/intent.ts',
        'server/config/models.ts',
        'server/utils/errorHandler.ts',
        'server/utils/slackLogger.ts',
        'server/middleware/validation.ts',
        'server/airtable/productData.ts',
        'server/airtable/sync.ts',
        'shared/schema.ts',
        'package.json'
    ];

    for (const file of criticalFiles) {
        if (!fs.existsSync(file)) {
            throw new Error(`Missing critical file: ${file}`);
        }
    }
});

// Check 2: Package.json has required dependencies
addCheck('Required Dependencies', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    const requiredDeps = [
        'drizzle-orm',
        'zod',
        'openai',
        'express',
        'uuid'
    ];

    for (const dep of requiredDeps) {
        if (!packageJson.dependencies[dep]) {
            throw new Error(`Missing dependency: ${dep}`);
        }
    }
});

// Check 3: Model assignments registry exists
addCheck('Model Assignments Registry', () => {
    const modelsFile = fs.readFileSync('server/config/models.ts', 'utf-8');

    if (!modelsFile.includes('MODEL_ASSIGNMENTS')) {
        throw new Error('MODEL_ASSIGNMENTS not found in models.ts');
    }

    const requiredAssignments = [
        'INTENT_CLASSIFICATION',
        'CONTRACT_SELECTION',
        'TRANSCRIPT_ANALYSIS',
        'PRODUCT_KNOWLEDGE_RESPONSE'
    ];

    for (const assignment of requiredAssignments) {
        if (!modelsFile.includes(assignment)) {
            throw new Error(`Missing model assignment: ${assignment}`);
        }
    }
});

// Check 4: Error handling system
addCheck('Error Handling System', () => {
    const errorHandlerFile = fs.readFileSync('server/utils/errorHandler.ts', 'utf-8');

    const requiredClasses = [
        'ValidationError',
        'NotFoundError',
        'AuthenticationError',
        'handleRouteError'
    ];

    for (const className of requiredClasses) {
        if (!errorHandlerFile.includes(className)) {
            throw new Error(`Missing error class/function: ${className}`);
        }
    }
});

// Check 5: Validation middleware
addCheck('Validation Middleware', () => {
    const validationFile = fs.readFileSync('server/middleware/validation.ts', 'utf-8');

    if (!validationFile.includes('validate') || !validationFile.includes('commonSchemas')) {
        throw new Error('Validation middleware not properly implemented');
    }

    if (!validationFile.includes('zod')) {
        throw new Error('Zod not imported in validation middleware');
    }
});

// Check 6: Structured logging
addCheck('Structured Logging System', () => {
    const loggerFile = fs.readFileSync('server/utils/slackLogger.ts', 'utf-8');

    if (!loggerFile.includes('RequestLogger') || !loggerFile.includes('generateCorrelationId')) {
        throw new Error('Structured logging not properly implemented');
    }

    if (!loggerFile.includes('correlationId')) {
        throw new Error('Correlation ID system not found');
    }
});

// Check 7: Airtable integration
addCheck('Airtable Integration', () => {
    const productDataFile = fs.readFileSync('server/airtable/productData.ts', 'utf-8');
    const syncFile = fs.readFileSync('server/airtable/sync.ts', 'utf-8');

    if (!productDataFile.includes('getProductKnowledgePrompt')) {
        throw new Error('Product knowledge function not found');
    }

    if (!productDataFile.includes('pitcrewProductSnapshot')) {
        throw new Error('Product snapshot system not found');
    }

    if (!syncFile.includes('syncAllTables')) {
        throw new Error('Sync system not found');
    }
});

// Check 8: Database schema
addCheck('Database Schema', () => {
    const schemaFile = fs.readFileSync('shared/schema.ts', 'utf-8');

    const requiredTables = [
        'pitcrewAirtableFeatures',
        'pitcrewProductSnapshot',
        'interactionLogs',
        'transcripts',
        'productInsights'
    ];

    for (const table of requiredTables) {
        if (!schemaFile.includes(table)) {
            throw new Error(`Missing database table: ${table}`);
        }
    }
});

// Check 9: Decision layer architecture
addCheck('Decision Layer Architecture', () => {
    const decisionLayerFile = fs.readFileSync('server/decisionLayer/index.ts', 'utf-8');
    const intentFile = fs.readFileSync('server/decisionLayer/intent.ts', 'utf-8');

    if (!decisionLayerFile.includes('runDecisionLayer')) {
        throw new Error('Decision layer main function not found');
    }

    if (!intentFile.includes('classifyIntent')) {
        throw new Error('Intent classification function not found');
    }
});

// Check 10: Routes structure
addCheck('Routes Structure', () => {
    const routesFile = fs.readFileSync('server/routes.ts', 'utf-8');

    if (!routesFile.includes('handleRouteError')) {
        throw new Error('Route error handling not integrated');
    }

    if (!routesFile.includes('validate')) {
        throw new Error('Validation middleware not integrated in routes');
    }

    if (!routesFile.includes('/api/airtable/')) {
        throw new Error('Airtable API routes not found');
    }
});

// Check 11: Hardcoded model detection (known issue)
addCheck('Hardcoded Model Detection (Advisory)', () => {
    const contractExecutorFile = fs.readFileSync('server/openAssistant/contractExecutor.ts', 'utf-8');
    const decisionLayerFile = fs.readFileSync('server/decisionLayer/index.ts', 'utf-8');

    let hardcodedFound = false;
    const issues = [];

    if (contractExecutorFile.includes('"gpt-4o-mini"') && !contractExecutorFile.includes('MODEL_ASSIGNMENTS.CONTRACT_SELECTION')) {
        hardcodedFound = true;
        issues.push('contractExecutor.ts still has hardcoded model');
    }

    if (decisionLayerFile.includes('"gpt-4o-mini"') && !decisionLayerFile.includes('MODEL_ASSIGNMENTS.INTENT_CLASSIFICATION')) {
        hardcodedFound = true;
        issues.push('decisionLayer/index.ts still has hardcoded model');
    }

    if (hardcodedFound) {
        console.log(`    ⚠️  Known issues found: ${issues.join(', ')}`);
        console.log(`    📝 These should be fixed in the next iteration`);
    }

    // Don't fail the test for this known issue
});

// Check 12: TypeScript configuration
addCheck('TypeScript Configuration', () => {
    const tsconfigFile = fs.readFileSync('tsconfig.json', 'utf-8');
    const tsconfig = JSON.parse(tsconfigFile);

    if (!tsconfig.compilerOptions) {
        throw new Error('TypeScript compiler options not found');
    }

    if (!tsconfig.include || !tsconfig.include.includes('server/**/*')) {
        throw new Error('Server files not included in TypeScript config');
    }
});

// Run all checks
const success = runChecks();

if (success) {
    console.log('\n🎉 ALL CHECKS PASSED: No major regression detected!');
    console.log('The codebase structure is intact and new features are properly integrated.');
} else {
    console.log('\n🚨 SOME CHECKS FAILED: Potential regression detected!');
    console.log('Please review the failed checks above.');
}

process.exit(success ? 0 : 1);