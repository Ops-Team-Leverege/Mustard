#!/usr/bin/env node
/**
 * Functional Regression Test
 * 
 * Tests that the server can start and key functionality works.
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

console.log('🚀 Starting Functional Regression Test');
console.log('Testing server startup and key endpoints...\n');

let serverProcess;
let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, testFn) {
    try {
        console.log(`🧪 Testing: ${name}`);
        await testFn();
        console.log(`✅ PASS: ${name}`);
        testsPassed++;
    } catch (error) {
        console.log(`❌ FAIL: ${name} - ${error.message}`);
        testsFailed++;
    }
}

async function makeRequest(path, options = {}) {
    const url = `http://localhost:3000${path}`;
    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    return {
        status: response.status,
        data: await response.json().catch(() => ({}))
    };
}

async function startServer() {
    return new Promise((resolve, reject) => {
        console.log('🔄 Starting server...');

        serverProcess = spawn('npm', ['run', 'dev'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        let output = '';

        serverProcess.stdout.on('data', (data) => {
            output += data.toString();
            if (output.includes('Server running on') || output.includes('listening on')) {
                console.log('✅ Server started successfully');
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            const error = data.toString();
            if (error.includes('Error') || error.includes('EADDRINUSE')) {
                reject(new Error(`Server startup failed: ${error}`));
            }
        });

        serverProcess.on('error', (error) => {
            reject(new Error(`Failed to start server: ${error.message}`));
        });

        // Timeout after 30 seconds
        setTimeout(() => {
            reject(new Error('Server startup timeout'));
        }, 30000);
    });
}

async function stopServer() {
    if (serverProcess) {
        console.log('🔄 Stopping server...');
        serverProcess.kill('SIGTERM');
        await setTimeout(2000); // Wait for graceful shutdown
        console.log('✅ Server stopped');
    }
}

async function runFunctionalTests() {
    try {
        // Start the server
        await startServer();

        // Wait a bit for server to fully initialize
        await setTimeout(3000);

        // Test 1: Health check
        await runTest('Health Check', async () => {
            const response = await makeRequest('/');
            if (response.status !== 200) {
                throw new Error(`Expected 200, got ${response.status}`);
            }
        });

        // Test 2: API endpoint exists
        await runTest('API Endpoints Accessible', async () => {
            const response = await makeRequest('/api/transcripts');
            // Should return 401 (unauthorized) or 200, not 404
            if (response.status === 404) {
                throw new Error('API endpoints not found');
            }
        });

        // Test 3: Airtable endpoints exist
        await runTest('Airtable Endpoints Exist', async () => {
            const response = await makeRequest('/api/airtable/features');
            // Should return 401 (unauthorized) or 200, not 404
            if (response.status === 404) {
                throw new Error('Airtable endpoints not found');
            }
        });

        // Test 4: Error handling works
        await runTest('Error Handling', async () => {
            const response = await makeRequest('/api/nonexistent');
            if (response.status !== 404) {
                throw new Error(`Expected 404 for nonexistent endpoint, got ${response.status}`);
            }
        });

        console.log('\n' + '='.repeat(50));
        console.log('📊 FUNCTIONAL TEST SUMMARY');
        console.log('='.repeat(50));
        console.log(`Total Tests: ${testsPassed + testsFailed}`);
        console.log(`✅ Passed: ${testsPassed}`);
        console.log(`❌ Failed: ${testsFailed}`);
        console.log(`Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);
        console.log('='.repeat(50));

        return testsFailed === 0;

    } catch (error) {
        console.error('💥 Functional test setup failed:', error.message);
        return false;
    } finally {
        await stopServer();
    }
}

// Check if server is already running
async function checkServerRunning() {
    try {
        const response = await fetch('http://localhost:3000/', {
            signal: AbortSignal.timeout(2000)
        });
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const isRunning = await checkServerRunning();

    if (isRunning) {
        console.log('⚠️  Server already running on port 3000');
        console.log('Please stop the existing server and run this test again.');
        process.exit(1);
    }

    const success = await runFunctionalTests();

    if (success) {
        console.log('\n🎉 ALL FUNCTIONAL TESTS PASSED!');
        console.log('Server starts correctly and key endpoints are accessible.');
    } else {
        console.log('\n🚨 FUNCTIONAL TESTS FAILED!');
        console.log('There may be issues with server startup or endpoint configuration.');
    }

    process.exit(success ? 0 : 1);
}

main().catch(error => {
    console.error('💥 Test runner crashed:', error);
    process.exit(1);
});