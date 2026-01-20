#!/usr/bin/env node

/**
 * PitCrew Sauce Bot - Automated Test Runner (Node.js)
 * 
 *   node pitcrew_test_runner.js --file=PitCrew_Test_Scenarios_v3_CONCRETE.xlsx
 *  
 */

require('dotenv').config();
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = {};
process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    args[key] = value;
  }
});

const CONFIG = {
  signingSecret: args.secret || process.env.SLACK_SIGNING_SECRET,
  webhookUrl: args.url || process.env.WEBHOOK_URL,
  excelFile: args.file || 'PitCrew_Sauce_Bot_Test_Scenarios_v2.xlsx',
  delay: parseInt(args.delay) || 1000,
  filter: args.filter || 'all',
};

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

// Check for required dependencies
let XLSX;
try {
  XLSX = require('xlsx');
} catch (e) {
  console.error(colorize('Error: xlsx package not found. Please install it:', 'red'));
  console.error(colorize('  npm install xlsx', 'yellow'));
  process.exit(1);
}

// Validate config
if (!CONFIG.signingSecret) {
  console.error(colorize('Error: Signing secret required. Use --secret=YOUR_SECRET or set SLACK_SIGNING_SECRET env var', 'red'));
  process.exit(1);
}
if (!CONFIG.webhookUrl) {
  console.error(colorize('Error: Webhook URL required. Use --url=YOUR_URL or set WEBHOOK_URL env var', 'red'));
  process.exit(1);
}
if (!fs.existsSync(CONFIG.excelFile)) {
  console.error(colorize(`Error: Excel file not found: ${CONFIG.excelFile}`, 'red'));
  process.exit(1);
}

// Generate Slack signature
function generateSignature(secret, timestamp, body) {
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(baseString);
  return `v0=${hmac.digest('hex')}`;
}

// Parse Excel file
function parseExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const testCases = [];

  const sheets = {
    'Single Meeting Questions': { idPrefix: 'sm', hasCategory: true },
    'Non-Answerable Questions': { idPrefix: 'na', expectRefusal: true },
    'Follow-up Thread Tests': { idPrefix: 'ft' },
    'Edge Cases': { idPrefix: 'ec' },
    'BD Prep Scenarios': { idPrefix: 'bd' }
  };

  for (const [sheetName, config] of Object.entries(sheets)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    let currentCategory = '';

    rows.slice(1).forEach((row, idx) => {
      // Skip empty rows
      if (!row || row.length === 0) return;
      
      // Check if this is a category header (merged cell with just first column)
      if (config.hasCategory && row[0] && !row[1] && !row[2] && !row[3]) {
        currentCategory = row[0];
        return;
      }
      
      // Parse question row - new structure: Question | What to Find | Expected Response | Expected Path
      const question = row[0];
      if (!question || question === 'Question') return; // Skip header row
      
      testCases.push({
        id: `${config.idPrefix}-${idx}`,
        sheet: sheetName.replace(' Questions', '').replace(' Tests', '').replace(' Scenarios', ''),
        category: config.hasCategory ? currentCategory : (row[1] || ''),
        question: question,
        expectedResponse: row[2] || '',
        expectedPath: row[3] || 'Semantic',
        expectRefusal: config.expectRefusal || false,
      });
    });
  }

  return testCases;
}

// Make HTTP request
function makeRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const req = protocol.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Run single test
async function runTest(testCase) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const ts = (Date.now() / 1000).toFixed(6);

  const payload = {
    type: 'event_callback',
    event: {
      type: 'app_mention',
      channel: 'C0123456789',
      user: 'U0123456789',
      text: testCase.question,
      ts: ts,
    },
    event_time: Math.floor(Date.now() / 1000),
  };

  const body = JSON.stringify(payload);
  const signature = generateSignature(CONFIG.signingSecret, timestamp, body);

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature,
      'X-Pitcrew-Test-Run': 'true',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const startTime = Date.now();

  try {
    const response = await makeRequest(CONFIG.webhookUrl, options, body);
    const responseTime = (Date.now() - startTime) / 1000;

    const pathThresholds = { 'Tier-1': 2, 'Semantic': 5, 'Clarification': 1 };
    const expectedTime = pathThresholds[testCase.expectedPath] || 5;
    const timePass = responseTime <= expectedTime;
    const statusPass = response.status === 200;

    return {
      ...testCase,
      responseTime,
      responseData: response.data,
      status: response.status,
      timePass,
      statusPass,
      passed: timePass && statusPass,
      error: null,
    };
  } catch (error) {
    return {
      ...testCase,
      responseTime: null,
      responseData: null,
      status: null,
      timePass: false,
      statusPass: false,
      passed: false,
      error: error.message,
    };
  }
}

// Format time with color
function formatTime(time, expectedPath) {
  if (time === null) return colorize('ERR', 'red');
  
  const thresholds = { 'Tier-1': 2, 'Semantic': 5, 'Clarification': 1 };
  const expected = thresholds[expectedPath] || 5;
  
  let color = 'green';
  if (time > 10) color = 'red';
  else if (time > expected) color = 'yellow';
  
  return colorize(`${time.toFixed(2)}s`, color);
}

// Format path badge
function formatPath(path) {
  const colors = { 'Tier-1': 'green', 'Semantic': 'yellow', 'Clarification': 'blue' };
  return colorize(path.padEnd(12), colors[path] || 'gray');
}

// Export results to Excel
function exportResults(results, filename) {
  const wsData = [
    ['ID', 'Sheet', 'Category', 'Question', 'Expected Path', 'Expected Response', 'Response Time (s)', 'Time Pass', 'Status', 'Status Pass', 'Overall Pass', 'Error', 'Response Preview'],
    ...results.map(r => [
      r.id,
      r.sheet,
      r.category,
      r.question,
      r.expectedPath,
      r.expectedResponse || '',
      r.responseTime?.toFixed(2) || 'N/A',
      r.timePass ? 'PASS' : 'FAIL',
      r.status || 'N/A',
      r.statusPass ? 'PASS' : 'FAIL',
      r.passed ? 'PASS' : 'FAIL',
      r.error || '',
      JSON.stringify(r.responseData)?.slice(0, 500) || '',
    ])
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'Test Results');
  XLSX.writeFile(wb, filename);
}

// Main execution
async function main() {
  console.log(colorize('\n🧪 PitCrew Sauce Bot - Automated Test Runner\n', 'bright'));
  console.log(colorize(`Webhook: ${CONFIG.webhookUrl}`, 'gray'));
  console.log(colorize(`Excel:   ${CONFIG.excelFile}`, 'gray'));
  console.log(colorize(`Delay:   ${CONFIG.delay}ms`, 'gray'));
  console.log();

  // Parse Excel
  console.log(colorize('Loading test scenarios...', 'cyan'));
  const allTests = parseExcelFile(CONFIG.excelFile);
  
  const testCases = CONFIG.filter === 'all' 
    ? allTests 
    : allTests.filter(t => t.sheet.toLowerCase().includes(CONFIG.filter.toLowerCase()));

  console.log(colorize(`Loaded ${testCases.length} test cases\n`, 'green'));

  // Run tests
  const results = [];
  let passed = 0;
  let failed = 0;

  console.log(colorize('─'.repeat(120), 'gray'));
  console.log(
    colorize('Status', 'bright').padEnd(18) +
    colorize('Sheet', 'bright').padEnd(22) +
    colorize('Expected', 'bright').padEnd(20) +
    colorize('Time', 'bright').padEnd(14) +
    colorize('Question', 'bright')
  );
  console.log(colorize('─'.repeat(120), 'gray'));

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const result = await runTest(testCase);
    results.push(result);

    if (result.passed) {
      passed++;
    } else {
      failed++;
    }

    // Print result row
    const status = result.passed 
      ? colorize('  ✓ PASS', 'green') 
      : colorize('  ✗ FAIL', 'red');
    
    const sheet = result.sheet.substring(0, 18).padEnd(18);
    const expectedPath = formatPath(result.expectedPath);
    const time = formatTime(result.responseTime, result.expectedPath).padEnd(14);
    const question = result.question.substring(0, 50);

    console.log(`${status}  ${colorize(sheet, 'gray')}  ${expectedPath}  ${time}  ${question}`);

    // Print error if any
    if (result.error) {
      console.log(colorize(`           Error: ${result.error}`, 'red'));
    }

    // Delay between tests
    if (i < testCases.length - 1) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.delay));
    }
  }

  // Summary
  console.log(colorize('\n─'.repeat(120), 'gray'));
  console.log(colorize('\n📊 Summary\n', 'bright'));

  const avgTime = results.filter(r => r.responseTime).reduce((sum, r) => sum + r.responseTime, 0) / results.filter(r => r.responseTime).length || 0;
  const regressions = results.filter(r => r.responseTime > 10).length;

  console.log(`   Total:       ${colorize(results.length.toString(), 'bright')}`);
  console.log(`   Passed:      ${colorize(passed.toString(), 'green')}`);
  console.log(`   Failed:      ${colorize(failed.toString(), failed > 0 ? 'red' : 'green')}`);
  console.log(`   Avg Time:    ${formatTime(avgTime, 'Semantic')}`);
  console.log(`   Regressions: ${colorize(regressions.toString(), regressions > 0 ? 'red' : 'green')} (>10s)`);
  console.log(`   Pass Rate:   ${colorize(((passed / results.length) * 100).toFixed(1) + '%', passed === results.length ? 'green' : 'yellow')}`);

  // Export results
  const outputFile = `pitcrew_test_results_${new Date().toISOString().slice(0, 10)}.xlsx`;
  exportResults(results, outputFile);
  console.log(colorize(`\n📁 Results exported to: ${outputFile}\n`, 'cyan'));
}

main().catch(err => {
  console.error(colorize(`\nFatal error: ${err.message}`, 'red'));
  process.exit(1);
});
