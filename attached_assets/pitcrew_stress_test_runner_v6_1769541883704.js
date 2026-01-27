#!/usr/bin/env node

/**
 * PitCrew Stress Test Runner (V6)
 * Updated for Intent-Based Routing Architecture + LLM Interpretation Module
 * 
 * Test Categories:
 * - Contract Chains: Sequential execution, phase ordering
 * - Failure Modes: Empty results, scope failures, missing evidence
 * - Authority Boundaries: SSOT mode enforcement, forbidden phrases
 * - Coverage Tests: MULTI_MEETING qualification requirements
 * - CLARIFY vs REFUSE: Outcome distinction
 * - Observability: Decision logging verification
 * - Happy Path Regression: Basic routing sanity checks
 * - LLM Interpretation: Confidence-based clarification, safety guarantees (NEW)
 * 
 * Usage:
 *   node pitcrew_stress_test_runner_v6.js --file=PitCrew_Test_Scenarios_V6_Stress.xlsx
 *   node pitcrew_stress_test_runner_v6.js --file=... --sheet="LLM Interpretation"
 *   node pitcrew_stress_test_runner_v6.js --file=... --verbose
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
    args[key] = value === undefined ? true : value;
  }
});

const CONFIG = {
  signingSecret: args.secret || process.env.SLACK_SIGNING_SECRET,
  webhookUrl: args.url || process.env.WEBHOOK_URL,
  excelFile: args.file || 'PitCrew_Test_Scenarios_V6_Stress.xlsx',
  delay: parseInt(args.delay) || 500,
  sheetFilter: args.sheet || null,
  verbose: args.verbose || args.v || false,
  stopOnFail: args['stop-on-fail'] || false,
};

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
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

// ============================================================================
// SHEET CONFIGURATIONS
// ============================================================================

const SHEET_CONFIGS = {
  'Contract Chains': {
    idPrefix: 'cc',
    columns: {
      question: 0,        // A
      expectedIntent: 1,  // B
      expectedChain: 2,   // C
      chainLength: 3,     // D
      phaseOrder: 4,      // E
      ssotModes: 5,       // F
      expectedBehavior: 6,// G
      validation: 7,      // H
      notes: 8            // I
    },
    timeThreshold: 10,
    validations: ['intent', 'contract', 'chainLength', 'ssotMode']
  },

  'Failure Modes': {
    idPrefix: 'fm',
    columns: {
      question: 0,            // A
      failureType: 1,         // B
      expectedIntent: 2,      // C
      expectedOutcome: 3,     // D
      emptyResultBehavior: 4, // E
      reason: 5,              // F
      mustInclude: 6,         // G
      mustNotInclude: 7,      // H
      notes: 8                // I
    },
    timeThreshold: 8,
    validations: ['intent', 'mustInclude', 'mustNotInclude']
  },

  'Authority Boundaries': {
    idPrefix: 'ab',
    columns: {
      question: 0,          // A
      expectedIntent: 1,    // B
      expectedContract: 2,  // C
      ssotMode: 3,          // D
      authorityTest: 4,     // E
      allowedPhrases: 5,    // F
      forbiddenPhrases: 6,  // G
      evidenceRequired: 7,  // H
      notes: 8              // I
    },
    timeThreshold: 8,
    validations: ['intent', 'contract', 'ssotMode', 'forbiddenPhrases']
  },

  'Coverage Tests': {
    idPrefix: 'cv',
    columns: {
      question: 0,                  // A
      expectedIntent: 1,            // B
      expectedCoverageMetadata: 2,  // C
      minThreshold: 3,              // D
      mustQualify: 4,               // E
      mustNotImply: 5,              // F
      validation: 6,                // G
      notes: 7                      // H
    },
    timeThreshold: 12,
    validations: ['intent', 'mustInclude', 'mustNotInclude', 'coverageMetadata']
  },

  'CLARIFY vs REFUSE': {
    idPrefix: 'cr',
    columns: {
      question: 0,         // A
      expectedOutcome: 1,  // B
      reasonCategory: 2,   // C
      recoveryPath: 3,     // D
      responseStyle: 4,    // E
      mustInclude: 5,      // F
      mustNotInclude: 6,   // G
      notes: 7             // H
    },
    timeThreshold: 5,
    validations: ['intent', 'mustInclude', 'mustNotInclude']
  },

  'Observability': {
    idPrefix: 'ob',
    columns: {
      question: 0,           // A
      expectedIntent: 1,     // B
      expectedLogFields: 2,  // C
      matchedSignals: 3,     // D
      rejectedIntents: 4,    // E
      contractRationale: 5,  // F
      validation: 6,         // G
      notes: 7               // H
    },
    timeThreshold: 8,
    validations: ['intent', 'logFields']
  },

  'Happy Path Regression': {
    idPrefix: 'hp',
    columns: {
      question: 0,          // A
      expectedIntent: 1,    // B
      expectedContract: 2,  // C
      ssotMode: 3,          // D
      expectedBehavior: 4,  // E
      notes: 5              // F
    },
    timeThreshold: 8,
    validations: ['intent', 'contract', 'ssotMode']
  },

  // NEW: LLM Interpretation sheet configuration
  'LLM Interpretation': {
    idPrefix: 'li',
    columns: {
      question: 0,                   // A - Question
      triggerCondition: 1,           // B - Trigger Condition
      expectedIntent: 2,             // C - Expected Intent
      expectedConfidence: 3,         // D - Expected Confidence
      proposedInterpretation: 4,     // E - proposedInterpretation
      alternatives: 5,               // F - alternatives
      clarifyMessagePattern: 6,      // G - clarifyMessage Pattern
      mustInclude: 7,                // H - Must Include
      mustNotInclude: 8,             // I - Must NOT Include
      safetyCheck: 9,                // J - Safety Check
      llmInterpretationLogged: 10,   // K - llmInterpretation Logged
      notes: 11                      // L - Notes
    },
    timeThreshold: 8,
    validations: [
      'intent',
      'mustInclude', 
      'mustNotInclude',
      'confidenceLevel',
      'llmInterpretationMetadata',
      'safetyNoExecution'
    ]
  }
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Check if response contains required phrases
 */
function validateMustInclude(response, phrases) {
  if (!phrases || phrases === '' || phrases === 'N/A') return { pass: true, missing: [], skipped: true };
  
  const phraseList = phrases.split(';').map(p => p.trim().toLowerCase()).filter(p => p);
  const responseLower = (response || '').toLowerCase();
  const missing = phraseList.filter(p => !responseLower.includes(p));
  
  return {
    pass: missing.length === 0,
    missing,
    checked: phraseList
  };
}

/**
 * Check if response avoids forbidden phrases
 */
function validateMustNotInclude(response, phrases) {
  if (!phrases || phrases === '' || phrases === 'N/A') return { pass: true, found: [], skipped: true };
  
  const phraseList = phrases.split(';').map(p => p.trim().toLowerCase()).filter(p => p);
  const responseLower = (response || '').toLowerCase();
  const found = phraseList.filter(p => responseLower.includes(p));
  
  return {
    pass: found.length === 0,
    found,
    checked: phraseList
  };
}

/**
 * Validate intent matches expected
 */
function validateIntent(actualIntent, expectedIntent) {
  if (!expectedIntent || expectedIntent === 'VARIES' || expectedIntent === 'N/A') {
    return { pass: true, skipped: true };
  }
  
  const actual = (actualIntent || '').toUpperCase();
  const expected = (expectedIntent || '').toUpperCase();
  
  return {
    pass: actual === expected || actual.includes(expected) || expected.includes(actual),
    actual,
    expected
  };
}

/**
 * Validate contract matches expected
 */
function validateContract(actualContract, expectedContract) {
  if (!expectedContract || expectedContract === 'N/A') return { pass: true, skipped: true };
  
  const actual = (actualContract || '').toUpperCase();
  const expected = (expectedContract || '').toUpperCase();
  
  // Handle chain notation (e.g., "CUSTOMER_QUESTIONS → DRAFT_RESPONSE")
  if (expected.includes('→')) {
    const expectedChain = expected.split('→').map(c => c.trim());
    const actualChain = actual.split('→').map(c => c.trim());
    return {
      pass: JSON.stringify(expectedChain) === JSON.stringify(actualChain),
      actual: actualChain,
      expected: expectedChain
    };
  }
  
  return {
    pass: actual === expected || actual.includes(expected),
    actual,
    expected
  };
}

/**
 * Validate chain length
 */
function validateChainLength(actualChain, expectedLength) {
  if (!expectedLength || expectedLength === 'N/A') return { pass: true, skipped: true };
  
  let actual;
  if (Array.isArray(actualChain)) {
    actual = actualChain.length;
  } else if (typeof actualChain === 'string' && actualChain.includes('→')) {
    actual = actualChain.split('→').length;
  } else {
    actual = actualChain ? 1 : 0;
  }
  
  const expected = parseInt(expectedLength);
  
  return {
    pass: actual === expected,
    actual,
    expected
  };
}

/**
 * Validate SSOT mode
 */
function validateSSOTMode(actualMode, expectedMode) {
  if (!expectedMode || expectedMode === 'N/A') return { pass: true, skipped: true };
  
  const actual = (actualMode || 'none').toLowerCase();
  const expected = (expectedMode || '').toLowerCase();
  
  // Handle chain notation (e.g., "none → descriptive")
  if (expected.includes('→')) {
    return {
      pass: actual.includes('→') || expected.split('→').some(m => actual.includes(m.trim())),
      actual,
      expected
    };
  }
  
  return {
    pass: actual === expected || actual.includes(expected),
    actual,
    expected
  };
}

/**
 * NEW: Validate confidence level matches expected range
 */
function validateConfidenceLevel(metadata, expectedConfidence) {
  if (!expectedConfidence || expectedConfidence === 'N/A' || expectedConfidence.includes('N/A')) {
    return { pass: true, skipped: true };
  }
  
  const actualConfidence = metadata?.llmInterpretation?.confidence;
  
  if (actualConfidence === undefined || actualConfidence === null) {
    // If no llmInterpretation, check if this is a direct match case
    if (expectedConfidence.includes('direct match')) {
      return { pass: true, note: 'Direct match - no LLM interpretation needed' };
    }
    return { pass: false, reason: 'No confidence value in metadata' };
  }
  
  const confidence = parseFloat(actualConfidence);
  
  // Parse expected range
  if (expectedConfidence.includes('high') || expectedConfidence.includes('90%+')) {
    return {
      pass: confidence >= 0.90,
      actual: confidence,
      expected: '>=0.90 (high)',
      range: 'high'
    };
  } else if (expectedConfidence.includes('medium') || expectedConfidence.includes('70-90%')) {
    return {
      pass: confidence >= 0.70 && confidence < 0.90,
      actual: confidence,
      expected: '0.70-0.89 (medium)',
      range: 'medium'
    };
  } else if (expectedConfidence.includes('low') || expectedConfidence.includes('<70%')) {
    return {
      pass: confidence < 0.70,
      actual: confidence,
      expected: '<0.70 (low)',
      range: 'low'
    };
  }
  
  return { pass: true, skipped: true, reason: 'Unknown confidence format' };
}

/**
 * NEW: Validate llmInterpretation metadata is logged
 */
function validateLLMInterpretationMetadata(metadata, shouldBeLogged) {
  if (!shouldBeLogged || shouldBeLogged === 'N/A') {
    return { pass: true, skipped: true };
  }
  
  const expectLogged = String(shouldBeLogged).toLowerCase() === 'true';
  const hasMetadata = metadata?.llmInterpretation !== undefined && 
                      metadata?.llmInterpretation !== null;
  
  if (expectLogged) {
    // Verify required fields are present
    const llmData = metadata?.llmInterpretation;
    const requiredFields = ['confidence', 'invocationReason'];
    const missingFields = requiredFields.filter(f => llmData?.[f] === undefined);
    
    return {
      pass: hasMetadata && missingFields.length === 0,
      hasMetadata,
      missingFields,
      expected: 'llmInterpretation with confidence, invocationReason'
    };
  } else {
    // Should NOT have LLM interpretation (direct match case)
    return {
      pass: !hasMetadata,
      hasMetadata,
      expected: 'No llmInterpretation metadata (direct routing)'
    };
  }
}

/**
 * NEW: Validate safety - no auto-execution
 */
function validateSafetyNoExecution(metadata, response, safetyCheck) {
  if (!safetyCheck || safetyCheck === 'N/A' || safetyCheck === 'Normal flow execution') {
    return { pass: true, skipped: true };
  }
  
  const results = {
    pass: true,
    checks: []
  };
  
  // Check 1: Intent should be CLARIFY (never auto-execute)
  if (safetyCheck.includes('No auto-execution')) {
    const intent = (metadata?.intent || '').toUpperCase();
    const isClarify = intent === 'CLARIFY';
    results.checks.push({
      name: 'intentIsClarify',
      pass: isClarify,
      actual: intent,
      expected: 'CLARIFY'
    });
    if (!isClarify) results.pass = false;
  }
  
  // Check 2: No pending contracts stored
  if (safetyCheck.includes('No pending state')) {
    const hasPendingContract = metadata?.pendingContract !== undefined;
    const hasPendingIntent = metadata?.pendingIntent !== undefined;
    results.checks.push({
      name: 'noPendingState',
      pass: !hasPendingContract && !hasPendingIntent,
      hasPendingContract,
      hasPendingIntent
    });
    if (hasPendingContract || hasPendingIntent) results.pass = false;
  }
  
  // Check 3: Response doesn't indicate execution happened
  const executionPhrases = [
    "here's the summary",
    "i've done",
    "completed",
    "here's what i found",
    "here are the results"
  ];
  const responseLower = (response || '').toLowerCase();
  const executionFound = executionPhrases.filter(p => responseLower.includes(p));
  if (executionFound.length > 0 && safetyCheck.includes('No auto-execution')) {
    results.checks.push({
      name: 'noExecutionLanguage',
      pass: false,
      found: executionFound
    });
    results.pass = false;
  }
  
  return results;
}

/**
 * Validate log fields are present
 */
function validateLogFields(metadata, expectedFields) {
  if (!expectedFields || expectedFields === 'N/A') return { pass: true, skipped: true };
  
  const fieldList = expectedFields.split(',').map(f => f.trim().toLowerCase());
  const missing = [];
  
  for (const field of fieldList) {
    // Check various possible paths in metadata
    const found = 
      metadata?.[field] !== undefined ||
      metadata?.decision?.[field] !== undefined ||
      metadata?.llmInterpretation?.[field] !== undefined;
    
    if (!found) missing.push(field);
  }
  
  return {
    pass: missing.length === 0,
    missing,
    checked: fieldList
  };
}

/**
 * Validate coverage metadata
 */
function validateCoverageMetadata(metadata, expectedFields) {
  if (!expectedFields || expectedFields === 'N/A') return { pass: true, skipped: true };
  
  const coverage = metadata?.coverage;
  if (!coverage) return { pass: false, reason: 'No coverage metadata' };
  
  const fieldList = expectedFields.split(',').map(f => f.trim());
  const missing = fieldList.filter(f => coverage[f] === undefined);
  
  return {
    pass: missing.length === 0,
    missing,
    checked: fieldList,
    coverage
  };
}

// ============================================================================
// SLACK API HELPERS
// ============================================================================

/**
 * Generate Slack signature
 */
function generateSignature(secret, timestamp, body) {
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(baseString);
  return `v0=${hmac.digest('hex')}`;
}

/**
 * Make HTTP request
 */
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

// ============================================================================
// TEST EXECUTION
// ============================================================================

/**
 * Load test cases from Excel file
 */
function loadTestCases(filePath, sheetFilter = null) {
  const workbook = XLSX.readFile(filePath);
  const testCases = [];
  
  for (const sheetName of workbook.SheetNames) {
    if (sheetFilter && sheetName !== sheetFilter) continue;
    if (!SHEET_CONFIGS[sheetName]) continue;
    
    const config = SHEET_CONFIGS[sheetName];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    // Skip header row
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[config.columns.question]) continue;
      
      const testCase = {
        id: `${config.idPrefix}-${String(i).padStart(3, '0')}`,
        sheet: sheetName,
        question: row[config.columns.question],
        config,
        raw: {}
      };
      
      // Extract all columns
      for (const [key, colIdx] of Object.entries(config.columns)) {
        testCase.raw[key] = row[colIdx];
      }
      
      testCases.push(testCase);
    }
  }
  
  return testCases;
}

/**
 * Execute a single test case via Slack webhook
 */
async function executeTest(testCase, verbose = false) {
  const result = {
    id: testCase.id,
    sheet: testCase.sheet,
    question: testCase.question,
    passed: false,
    validations: {},
    error: null,
    duration: 0
  };
  
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const ts = (Date.now() / 1000).toFixed(6);

    // Build Slack event payload
    const payload = {
      type: 'event_callback',
      event: {
        type: 'app_mention',
        channel: 'C0123456789',
        user: 'U0000000010',  // Test user
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
    const response = await makeRequest(CONFIG.webhookUrl, options, body);
    result.duration = (Date.now() - startTime) / 1000;
    
    if (response.status !== 200) {
      throw new Error(`API returned ${response.status}`);
    }
    
    // Extract response data
    const data = response.data;
    result.response = data.response || data.message || data.text || '';
    result.intent = data.metadata?.intent || data.intent;
    result.contract = data.metadata?.contract || data.contract;
    result.metadata = data.metadata || {};
    result.status = response.status;
    
    // Run validations based on sheet config
    const validations = testCase.config.validations || [];
    
    for (const valName of validations) {
      switch (valName) {
        case 'intent':
          result.validations.intent = validateIntent(
            result.intent,
            testCase.raw.expectedIntent || testCase.raw.expectedOutcome
          );
          break;
          
        case 'contract':
          result.validations.contract = validateContract(
            result.contract,
            testCase.raw.expectedContract || testCase.raw.expectedChain
          );
          break;
          
        case 'chainLength':
          result.validations.chainLength = validateChainLength(
            result.contract,
            testCase.raw.chainLength
          );
          break;
          
        case 'ssotMode':
          result.validations.ssotMode = validateSSOTMode(
            result.metadata?.ssotMode,
            testCase.raw.ssotMode || testCase.raw.ssotModes
          );
          break;
          
        case 'mustInclude':
          result.validations.mustInclude = validateMustInclude(
            result.response,
            testCase.raw.mustInclude || testCase.raw.mustQualify
          );
          break;
          
        case 'mustNotInclude':
          result.validations.mustNotInclude = validateMustNotInclude(
            result.response,
            testCase.raw.mustNotInclude || testCase.raw.mustNotImply || testCase.raw.forbiddenPhrases
          );
          break;
          
        case 'forbiddenPhrases':
          result.validations.forbiddenPhrases = validateMustNotInclude(
            result.response,
            testCase.raw.forbiddenPhrases
          );
          break;
          
        case 'logFields':
          result.validations.logFields = validateLogFields(
            result.metadata,
            testCase.raw.expectedLogFields
          );
          break;
          
        case 'coverageMetadata':
          result.validations.coverageMetadata = validateCoverageMetadata(
            result.metadata,
            testCase.raw.expectedCoverageMetadata
          );
          break;
          
        // NEW: LLM Interpretation validations
        case 'confidenceLevel':
          result.validations.confidenceLevel = validateConfidenceLevel(
            result.metadata,
            testCase.raw.expectedConfidence
          );
          break;
          
        case 'llmInterpretationMetadata':
          result.validations.llmInterpretationMetadata = validateLLMInterpretationMetadata(
            result.metadata,
            testCase.raw.llmInterpretationLogged
          );
          break;
          
        case 'safetyNoExecution':
          result.validations.safetyNoExecution = validateSafetyNoExecution(
            result.metadata,
            result.response,
            testCase.raw.safetyCheck
          );
          break;
      }
    }
    
    // Determine overall pass/fail
    result.passed = Object.values(result.validations).every(v => v.pass || v.skipped);
    
    if (verbose) {
      const status = result.passed ? colorize('✓ PASS', 'green') : colorize('✗ FAIL', 'red');
      console.log(`\n${status} ${result.id}: ${result.question.slice(0, 60)}...`);
      console.log(`   Intent: ${result.intent} (expected: ${testCase.raw.expectedIntent || testCase.raw.expectedOutcome || 'N/A'})`);
      console.log(`   Time: ${result.duration.toFixed(2)}s`);
      if (!result.passed) {
        const failed = Object.entries(result.validations)
          .filter(([_, v]) => !v.pass && !v.skipped);
        for (const [name, val] of failed) {
          console.log(colorize(`   ✗ ${name}: ${JSON.stringify(val).slice(0, 100)}`, 'red'));
        }
      }
    }
    
  } catch (error) {
    result.error = error.message;
    if (verbose) {
      console.log(colorize(`\n✗ ${result.id}: ERROR - ${error.message}`, 'red'));
    }
  }
  
  return result;
}

/**
 * Run all tests
 */
async function runTests(filePath, options) {
  console.log(colorize('\n🧪 PitCrew Stress Test Runner V6\n', 'bright'));
  console.log(colorize(`Webhook: ${CONFIG.webhookUrl}`, 'gray'));
  console.log(colorize(`Excel:   ${filePath}`, 'gray'));
  console.log(colorize(`Sheet:   ${options.sheetFilter || 'All sheets'}`, 'gray'));
  console.log(colorize(`Delay:   ${CONFIG.delay}ms`, 'gray'));
  console.log();
  
  const testCases = loadTestCases(filePath, options.sheetFilter);
  console.log(colorize(`Loaded ${testCases.length} test cases\n`, 'green'));
  
  // Show breakdown by sheet
  const sheetCounts = {};
  testCases.forEach(t => {
    sheetCounts[t.sheet] = (sheetCounts[t.sheet] || 0) + 1;
  });
  console.log(colorize('Test breakdown by sheet:', 'cyan'));
  Object.entries(sheetCounts).forEach(([sheet, count]) => {
    console.log(`  ${sheet.padEnd(25)} ${count} tests`);
  });
  console.log();
  
  const results = {
    timestamp: new Date().toISOString(),
    file: filePath,
    totalTests: testCases.length,
    passed: 0,
    failed: 0,
    errors: 0,
    bySheet: {},
    byValidation: {},
    tests: []
  };
  
  console.log(colorize('─'.repeat(100), 'gray'));
  console.log(
    colorize('Status', 'bright').padEnd(14) +
    colorize('Sheet', 'bright').padEnd(24) +
    colorize('Time', 'bright').padEnd(10) +
    colorize('Question', 'bright')
  );
  console.log(colorize('─'.repeat(100), 'gray'));
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const result = await executeTest(testCase, options.verbose);
    results.tests.push(result);
    
    // Update counters
    if (result.error) {
      results.errors++;
      results.failed++;
    } else if (result.passed) {
      results.passed++;
    } else {
      results.failed++;
    }
    
    // Update by-sheet stats
    if (!results.bySheet[testCase.sheet]) {
      results.bySheet[testCase.sheet] = { total: 0, passed: 0, failed: 0 };
    }
    results.bySheet[testCase.sheet].total++;
    if (result.passed) {
      results.bySheet[testCase.sheet].passed++;
    } else {
      results.bySheet[testCase.sheet].failed++;
    }
    
    // Update by-validation stats
    for (const [valName, valResult] of Object.entries(result.validations || {})) {
      if (!results.byValidation[valName]) {
        results.byValidation[valName] = { total: 0, passed: 0, failed: 0 };
      }
      if (!valResult.skipped) {
        results.byValidation[valName].total++;
        if (valResult.pass) {
          results.byValidation[valName].passed++;
        } else {
          results.byValidation[valName].failed++;
        }
      }
    }
    
    // Print progress row (unless verbose which prints more detail)
    if (!options.verbose) {
      const status = result.passed 
        ? colorize('✓ PASS', 'green') 
        : colorize('✗ FAIL', 'red');
      const time = result.duration 
        ? colorize(`${result.duration.toFixed(2)}s`, result.duration > 5 ? 'yellow' : 'green')
        : colorize('ERR', 'red');
      console.log(
        `${status}  ${testCase.sheet.slice(0, 20).padEnd(22)}  ${time.padEnd(10)}  ${testCase.question.slice(0, 50)}`
      );
    }
    
    // Stop on fail
    if (options.stopOnFail && !result.passed) {
      console.log(colorize('\n\nStopping on first failure.', 'yellow'));
      break;
    }
    
    // Delay between tests
    if (i < testCases.length - 1) {
      await new Promise(r => setTimeout(r, CONFIG.delay));
    }
  }
  
  // Print summary
  printSummary(results);
  
  // Save results
  saveResults(results);
  
  return results;
}

/**
 * Print test summary
 */
function printSummary(results) {
  console.log(colorize('\n' + '─'.repeat(100), 'gray'));
  console.log(colorize('\n📊 SUMMARY\n', 'bright'));
  
  const passRate = ((results.passed / results.totalTests) * 100).toFixed(1);
  console.log(`   Total:     ${colorize(results.totalTests.toString(), 'bright')}`);
  console.log(`   Passed:    ${colorize(results.passed.toString(), 'green')}`);
  console.log(`   Failed:    ${colorize(results.failed.toString(), results.failed > 0 ? 'red' : 'green')}`);
  console.log(`   Errors:    ${colorize(results.errors.toString(), results.errors > 0 ? 'red' : 'green')}`);
  console.log(`   Pass Rate: ${colorize(passRate + '%', results.failed === 0 ? 'green' : 'yellow')}`);
  console.log();
  
  console.log(colorize('📈 Results by Sheet:\n', 'bright'));
  for (const [sheet, stats] of Object.entries(results.bySheet)) {
    const pct = ((stats.passed / stats.total) * 100).toFixed(0);
    const status = stats.failed === 0 ? colorize('✓', 'green') : colorize('✗', 'red');
    console.log(`   ${status} ${sheet.padEnd(25)} ${stats.passed}/${stats.total} (${pct}%)`);
  }
  console.log();
  
  console.log(colorize('🔍 Results by Validation Type:\n', 'bright'));
  for (const [valName, stats] of Object.entries(results.byValidation)) {
    if (stats.total === 0) continue;
    const pct = ((stats.passed / stats.total) * 100).toFixed(0);
    const status = stats.failed === 0 ? colorize('✓', 'green') : colorize('✗', 'red');
    console.log(`   ${status} ${valName.padEnd(30)} ${stats.passed}/${stats.total} (${pct}%)`);
  }
  console.log();
  
  // Show failed tests
  const failedTests = results.tests.filter(t => !t.passed);
  if (failedTests.length > 0) {
    console.log(colorize('❌ Failed Tests:\n', 'red'));
    for (const test of failedTests.slice(0, 10)) {
      console.log(colorize(`   ${test.id}: ${test.question.slice(0, 60)}...`, 'red'));
      if (test.error) {
        console.log(colorize(`      Error: ${test.error}`, 'gray'));
      } else {
        const failedVals = Object.entries(test.validations)
          .filter(([_, v]) => !v.pass && !v.skipped)
          .map(([k, _]) => k);
        console.log(colorize(`      Failed: ${failedVals.join(', ')}`, 'gray'));
      }
    }
    if (failedTests.length > 10) {
      console.log(colorize(`   ... and ${failedTests.length - 10} more`, 'gray'));
    }
  }
}

/**
 * Save results to JSON and Excel
 */
function saveResults(results) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  
  // Save JSON
  const jsonPath = `stress_test_results_${timestamp}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(colorize(`\n📁 JSON saved to: ${jsonPath}`, 'cyan'));
  
  // Save Excel summary
  const xlsxPath = `stress_test_results_${timestamp}.xlsx`;
  const workbook = XLSX.utils.book_new();
  
  // Summary sheet
  const summaryData = [
    ['PitCrew Stress Test Results V6'],
    [''],
    ['Timestamp', results.timestamp],
    ['Total Tests', results.totalTests],
    ['Passed', results.passed],
    ['Failed', results.failed],
    ['Pass Rate', `${((results.passed / results.totalTests) * 100).toFixed(1)}%`],
    [''],
    ['Results by Sheet'],
    ['Sheet', 'Total', 'Passed', 'Failed', 'Pass Rate'],
    ...Object.entries(results.bySheet).map(([sheet, stats]) => [
      sheet, stats.total, stats.passed, stats.failed, 
      `${((stats.passed / stats.total) * 100).toFixed(0)}%`
    ]),
    [''],
    ['Results by Validation'],
    ['Validation', 'Total', 'Passed', 'Failed', 'Pass Rate'],
    ...Object.entries(results.byValidation).map(([val, stats]) => [
      val, stats.total, stats.passed, stats.failed,
      stats.total > 0 ? `${((stats.passed / stats.total) * 100).toFixed(0)}%` : 'N/A'
    ])
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  
  // All tests sheet
  const allTestsData = [
    ['ID', 'Sheet', 'Question', 'Expected Intent', 'Actual Intent', 'Duration', 'Passed', 'Failed Validations', 'Error'],
    ...results.tests.map(t => [
      t.id,
      t.sheet,
      t.question,
      t.validations?.intent?.expected || '',
      t.intent || '',
      t.duration?.toFixed(2) || 'N/A',
      t.passed ? 'PASS' : 'FAIL',
      Object.entries(t.validations || {})
        .filter(([_, v]) => !v.pass && !v.skipped)
        .map(([k, _]) => k).join(', '),
      t.error || ''
    ])
  ];
  const allTestsSheet = XLSX.utils.aoa_to_sheet(allTestsData);
  XLSX.utils.book_append_sheet(workbook, allTestsSheet, 'All Tests');
  
  // Failed tests sheet
  const failedData = [
    ['ID', 'Sheet', 'Question', 'Expected Intent', 'Actual Intent', 'Failed Validations', 'Error', 'Response Preview'],
    ...results.tests.filter(t => !t.passed).map(t => [
      t.id,
      t.sheet,
      t.question,
      t.validations?.intent?.expected || '',
      t.intent || '',
      Object.entries(t.validations || {})
        .filter(([_, v]) => !v.pass && !v.skipped)
        .map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 50)}`).join('; '),
      t.error || '',
      (t.response || '').slice(0, 200)
    ])
  ];
  const failedSheet = XLSX.utils.aoa_to_sheet(failedData);
  XLSX.utils.book_append_sheet(workbook, failedSheet, 'Failed Tests');
  
  XLSX.writeFile(workbook, xlsxPath);
  console.log(colorize(`📁 Excel saved to: ${xlsxPath}\n`, 'cyan'));
}

// ============================================================================
// CLI
// ============================================================================

function showHelp() {
  console.log(`
${colorize('PitCrew Stress Test Runner (V6)', 'bright')}

Usage:
  node pitcrew_stress_test_runner_v6.js [options]

Options:
  --file=<path>       Path to V6 test scenarios Excel file (default: ${CONFIG.excelFile})
  --sheet=<name>      Run only specific sheet (e.g., "LLM Interpretation")
  --url=<url>         Webhook URL (or set WEBHOOK_URL env var)
  --secret=<secret>   Slack signing secret (or set SLACK_SIGNING_SECRET env var)
  --delay=<ms>        Delay between tests in ms (default: 500)
  --verbose, -v       Show detailed output for each test
  --stop-on-fail      Stop execution on first failure
  --help, -h          Show this help message

Sheets:
  - Contract Chains
  - Failure Modes
  - Authority Boundaries
  - Coverage Tests
  - CLARIFY vs REFUSE
  - Observability
  - Happy Path Regression
  - LLM Interpretation (NEW)

Examples:
  node pitcrew_stress_test_runner_v6.js --file=PitCrew_Test_Scenarios_V6_Stress.xlsx
  node pitcrew_stress_test_runner_v6.js --sheet="LLM Interpretation" --verbose
  node pitcrew_stress_test_runner_v6.js --sheet="Failure Modes" --stop-on-fail
  `);
  process.exit(0);
}

// Main execution
if (args.help || args.h) {
  showHelp();
}

runTests(CONFIG.excelFile, {
  sheetFilter: CONFIG.sheetFilter,
  verbose: CONFIG.verbose,
  stopOnFail: CONFIG.stopOnFail
})
  .then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error(colorize(`\nFatal error: ${error.message}`, 'red'));
    process.exit(1);
  });
