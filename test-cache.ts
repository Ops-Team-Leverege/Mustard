import { db } from './server/db';
import { getProductKnowledgePrompt } from './server/airtable/productData';
import { pitcrewProductSnapshot } from '@shared/schema';
import { eq } from 'drizzle-orm';

async function testCache() {
    console.log('=== Product Knowledge Caching Investigation ===\n');

    try {
        // Check if snapshot exists
        console.log('1. Checking snapshot table...');
        const snapshots = await db.select().from(pitcrewProductSnapshot).where(eq(pitcrewProductSnapshot.id, 'singleton'));

        if (snapshots.length === 0) {
            console.log('❌ NO SNAPSHOT FOUND!');
            console.log('   This explains the performance regression - system is using slow path');
            console.log('   Need to rebuild the snapshot');
            return;
        }

        const snapshot = snapshots[0];
        console.log('✅ Snapshot exists:');
        console.log(`   - Records: ${snapshot.recordCount}`);
        console.log(`   - Prompt length: ${snapshot.promptText.length} chars`);
        console.log(`   - Last synced: ${snapshot.lastSyncedAt}`);
        console.log(`   - Tables: ${snapshot.tablesIncluded.join(', ')}`);

        // Test performance
        console.log('\n2. Testing performance...');
        const start = Date.now();
        const result = await getProductKnowledgePrompt();
        const duration = Date.now() - start;

        console.log(`✅ Query completed in ${duration}ms`);
        console.log(`   - Source: ${result.source}`);
        console.log(`   - Records: ${result.recordCount}`);

        if (duration > 1000) {
            console.log('⚠️  Still slow despite snapshot - investigating...');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    }

    process.exit(0);
}

testCache();