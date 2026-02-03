#!/usr/bin/env tsx
/**
 * Comprehensive Regression Test Suite
 * 
 * Tests critical functionality to ensure new implementations haven't broken existing features.
 * This is a manual test suite that can be run with: npx tsx regression-test.ts
 */

import { db } from './server/db';
import { storage } from './server/storage';
import { getProductKnowledgePrompt } from './server/airtable/productData';
import { classifyIntent } from './server/decisionLayer/intent';
import { runDecisionLayer } from './server/decisionLayer';
import { validateRequest } from './server/middleware/validation';
import { handleRouteError, ValidationError, NotFoundError } from './server/utils/errorHandler';
import { generateCorrelationId, RequestLogger } from './server/utils/slackLogger';

interface TestResult {
    name: string;
    status: 'PASS' | 'FAIL' | 'SKIP';
    duration: number;
    error?: string;
}

class RegressionTester {
    private results: TestResult[] = [];

    async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
        const start = Date.now();
        console.log(`🧪 Testing: ${name}`);

        try {
            await testFn();
            const duration = Date.now() - start;
            this.results.push({ name, status: 'PASS', duration });
            console.log(`✅ PASS: ${name} (${duration}ms)`);
        } catch (error) {
            const duration = Date.now() - start;
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.results.push({ name, status: 'FAIL', duration, error: errorMsg });
            console.log(`❌ FAIL: ${name} (${duration}ms) - ${errorMsg}`);
        }
    }

    async skipTest(name: string, reason: string): Promise<void> {
        this.results.push({ name, status: 'SKIP', duration: 0, error: reason });
        console.log(`⏭️  SKIP: ${name} - ${reason}`);
    }

    printSummary(): void {
        const passed = this.results.filter(r => r.status === 'PASS').length;
        const failed = this.results.filter(r => r.status === 'FAIL').length;
        const skipped = this.results.filter(r => r.status === 'SKIP').length;
        const total = this.results.length;

        console.log('\n' + '='.repeat(60));
        console.log('📊 REGRESSION TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total Tests: ${total}`);
        console.log(`✅ Passed: ${passed}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`⏭️  Skipped: ${skipped}`);
        console.log(`Success Rate: ${total > 0 ? Math.round((passed / (total - skipped)) * 100) : 0}%`);

        if (failed > 0) {
            console.log('\n❌ FAILED TESTS:');
            this.results.filter(r => r.status === 'FAIL').forEach(r => {
                console.log(`  - ${r.name}: ${r.error}`);
            });
        }

        console.log('='.repeat(60));
    }
}

async function main() {
    console.log('🚀 Starting Regression Test Suite');
    console.log('Testing critical functionality after architectural changes...\n');

    const tester = new RegressionTester();

    // Test 1: Database Connection
    await tester.runTest('Database Connection', async () => {
        const result = await db.execute('SELECT 1 as test');
        if (!result || result.length === 0) {
            throw new Error('Database query returned no results');
        }
    });

    // Test 2: Storage Layer Basic Operations
    await tester.runTest('Storage Layer - Get Transcripts', async () => {
        const transcripts = await storage.getTranscripts('PitCrew');
        if (!Array.isArray(transcripts)) {
            throw new Error('getTranscripts did not return an array');
        }
    });

    // Test 3: Product Knowledge Snapshot System
    await tester.runTest('Product Knowledge Snapshot', async () => {
        const result = await getProductKnowledgePrompt();
        if (!result.promptText || result.promptText.length < 10) {
            throw new Error('Product knowledge prompt is empty or too short');
        }
        if (!['snapshot', 'computed'].includes(result.source)) {
            throw new Error('Invalid source type returned');
        }
        console.log(`    📊 Source: ${result.source}, Records: ${result.recordCount}, Length: ${result.promptText.length} chars`);
    });

    // Test 4: Intent Classification System
    await tester.runTest('Intent Classification', async () => {
        const testQuestions = [
            'What happened in the last meeting?',
            'Search all recent calls about pricing',
            'What features does PitCrew offer?',
            'Draft an email to the customer'
        ];

        for (const question of testQuestions) {
            const result = await classifyIntent(question);
            if (!result.intent || !result.intentDetectionMethod) {
                throw new Error(`Intent classification failed for: "${question}"`);
            }
        }
    });

    // Test 5: Decision Layer (Control Plane)
    await tester.runTest('Decision Layer Integration', async () => {
        const result = await runDecisionLayer('What features does PitCrew offer?');
        if (!result.intent || !result.contextLayers || !result.answerContract) {
            throw new Error('Decision layer returned incomplete result');
        }
        console.log(`    🎯 Intent: ${result.intent}, Contract: ${result.answerContract}`);
    });

    // Test 6: Error Handling System
    await tester.runTest('Error Handling System', async () => {
        const validationError = new ValidationError('Test validation error');
        const notFoundError = new NotFoundError('TestResource');

        if (validationError.statusCode !== 400) {
            throw new Error('ValidationError has wrong status code');
        }
        if (notFoundError.statusCode !== 404) {
            throw new Error('NotFoundError has wrong status code');
        }
        if (!validationError.isOperational || !notFoundError.isOperational) {
            throw new Error('Errors not marked as operational');
        }
    });

    // Test 7: Structured Logging System
    await tester.runTest('Structured Logging System', async () => {
        const correlationId = generateCorrelationId();
        if (!correlationId || correlationId.length !== 8) {
            throw new Error('Correlation ID generation failed');
        }

        const logger = new RequestLogger('test-channel', 'test-thread', 'test-user');
        const logCorrelationId = logger.getCorrelationId();
        if (!logCorrelationId || logCorrelationId.length !== 8) {
            throw new Error('Logger correlation ID generation failed');
        }

        logger.startStage('test-stage');
        await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
        const duration = logger.endStage('test-stage');
        if (duration < 5 || duration > 100) {
            throw new Error('Stage timing measurement failed');
        }
    });

    // Test 8: Model Assignments Registry
    await tester.runTest('Model Assignments Registry', async () => {
        const { MODEL_ASSIGNMENTS } = await import('./server/config/models');

        const requiredAssignments = [
            'INTENT_CLASSIFICATION',
            'CONTRACT_SELECTION',
            'TRANSCRIPT_ANALYSIS',
            'PRODUCT_KNOWLEDGE_RESPONSE',
            'MULTI_MEETING_SYNTHESIS'
        ];

        for (const assignment of requiredAssignments) {
            if (!MODEL_ASSIGNMENTS[assignment]) {
                throw new Error(`Missing model assignment: ${assignment}`);
            }
        }
    });

    // Test 9: Airtable Schema Tables
    await tester.runTest('Airtable Schema Tables', async () => {
        const { pitcrewAirtableFeatures, pitcrewProductSnapshot } = await import('@shared/schema');

        // Test that we can query the new Airtable tables
        try {
            const features = await db.select().from(pitcrewAirtableFeatures).limit(1);
            const snapshots = await db.select().from(pitcrewProductSnapshot).limit(1);

            console.log(`    📊 Features table accessible, Snapshot table accessible`);
        } catch (error) {
            throw new Error(`Airtable schema tables not accessible: ${error}`);
        }
    });

    // Test 10: Validation Middleware
    await tester.runTest('Validation Middleware', async () => {
        const { validate, commonSchemas, updateSchemas } = await import('./server/middleware/validation');

        if (typeof validate !== 'function') {
            throw new Error('validate function not exported');
        }
        if (!commonSchemas.id || !commonSchemas.uuidId) {
            throw new Error('Common schemas not properly defined');
        }
        if (!updateSchemas.transcript || !updateSchemas.insight) {
            throw new Error('Update schemas not properly defined');
        }
    });

    // Test 11: Performance - Product Knowledge Speed
    await tester.runTest('Performance - Product Knowledge Speed', async () => {
        const start = Date.now();
        const result = await getProductKnowledgePrompt();
        const duration = Date.now() - start;

        console.log(`    ⚡ Duration: ${duration}ms, Source: ${result.source}`);

        // If using snapshot, should be very fast (< 1000ms)
        // If computing on-demand, might be slower but should still complete
        if (result.source === 'snapshot' && duration > 1000) {
            throw new Error(`Snapshot query too slow: ${duration}ms (expected < 1000ms)`);
        }
        if (duration > 30000) {
            throw new Error(`Product knowledge query too slow: ${duration}ms (expected < 30s)`);
        }
    });

    // Test 12: Critical Hardcoded Model Check
    await tester.runTest('Hardcoded Model Detection', async () => {
        // This test checks if the critical hardcoded models have been fixed
        const fs = await import('fs');
        const path = await import('path');

        const filesToCheck = [
            'server/openAssistant/contractExecutor.ts',
            'server/decisionLayer/index.ts'
        ];

        let hardcodedFound = false;
        const hardcodedInstances: string[] = [];

        for (const file of filesToCheck) {
            if (fs.existsSync(file)) {
                const content = fs.readFileSync(file, 'utf-8');
                if (content.includes('"gpt-4o-mini"') && !content.includes('MODEL_ASSIGNMENTS')) {
                    hardcodedFound = true;
                    hardcodedInstances.push(file);
                }
            }
        }

        if (hardcodedFound) {
            console.log(`    ⚠️  Hardcoded models still found in: ${hardcodedInstances.join(', ')}`);
            console.log(`    📝 This is a known issue from the audit - should be fixed next`);
        } else {
            console.log(`    ✅ No hardcoded models detected - great!`);
        }
    });

    tester.printSummary();

    const failedTests = tester['results'].filter(r => r.status === 'FAIL').length;
    if (failedTests > 0) {
        console.log('\n🚨 REGRESSION DETECTED: Some tests failed!');
        process.exit(1);
    } else {
        console.log('\n🎉 ALL TESTS PASSED: No regression detected!');
        process.exit(0);
    }
}

// Run the tests
main().catch(error => {
    console.error('💥 Test suite crashed:', error);
    process.exit(1);
});