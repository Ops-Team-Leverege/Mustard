/**
 * Test script to verify product knowledge caching is working correctly
 */

import { db } from './server/db.ts';
import { getProductKnowledgePrompt } from './server/airtable/productData.ts';

async function testProductCache() {
    console.log('=== Product Knowledge Caching Test ===\n');

    try {
        // Test 1: Check if snapshot exists
        console.log('1. Checking if product snapshot exists...');
        const snapshotQuery = `SELECT id, record_count, last_synced_at, LENGTH(prompt_text) as prompt_length FROM pitcrew_product_snapshot WHERE id = 'singleton'`;
        const snapshotResult = await db.execute(snapshotQuery);

        if (snapshotResult.rows.length === 0) {
            console.log('❌ NO SNAPSHOT FOUND - This explains the slow performance!');
            console.log('   The system is falling back to the slow path (5 queries instead of 1)');
            return;
        }

        const snapshot = snapshotResult.rows[0];
        console.log('✅ Snapshot found:');
        console.log(`   - Record count: ${snapshot.record_count}`);
        console.log(`   - Prompt length: ${snapshot.prompt_length} chars`);
        console.log(`   - Last synced: ${snapshot.last_synced_at}`);

        // Test 2: Time the getProductKnowledgePrompt function
        console.log('\n2. Testing getProductKnowledgePrompt performance...');
        const startTime = Date.now();
        const result = await getProductKnowledgePrompt();
        const endTime = Date.now();

        console.log(`✅ Function completed in ${endTime - startTime}ms`);
        console.log(`   - Source: ${result.source}`);
        console.log(`   - Record count: ${result.recordCount}`);
        console.log(`   - Prompt length: ${result.promptText.length} chars`);

        if (result.source === 'snapshot') {
            console.log('✅ Using fast path (snapshot)');
        } else {
            console.log('❌ Using slow path (computed) - snapshot may be missing or corrupted');
        }

        // Test 3: Check Airtable data exists
        console.log('\n3. Checking Airtable data availability...');
        const tables = [
            'pitcrew_airtable_features',
            'pitcrew_airtable_value_propositions',
            'pitcrew_airtable_value_themes',
            'pitcrew_airtable_feature_themes',
            'pitcrew_airtable_customer_segments'
        ];

        for (const table of tables) {
            const countQuery = `SELECT COUNT(*) as count FROM ${table}`;
            const countResult = await db.execute(countQuery);
            const count = countResult.rows[0].count;
            console.log(`   - ${table}: ${count} records`);
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

testProductCache().then(() => {
    console.log('\n=== Test Complete ===');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});