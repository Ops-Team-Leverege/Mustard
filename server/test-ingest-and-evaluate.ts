/**
 * Test script to ingest transcript chunks and evaluate action extraction across 10 transcripts.
 * 
 * Usage: npx tsx server/test-ingest-and-evaluate.ts
 */

import { ingestTranscriptChunks } from "./ingestion/ingestTranscriptChunks";
import { storage } from "./storage";
import { extractMeetingActionStates, type TranscriptChunk } from "./rag/composer";

interface TranscriptRow {
  leverage_team: string | null;
  customer_names: string | null;
  company_name: string | null;
  name: string | null;
}

interface TranscriptChunkRow {
  chunk_index: number;
  speaker_role: string;
  speaker_name: string | null;
  content: string;
}

const TARGET_TRANSCRIPTS = [
  { id: "e8ac53ee-a110-4eb8-a2ff-ca94dcac0f01", name: "ACE BD Discovery Call" },
  { id: "ddc6d29a-9a49-4914-ab95-612b67355f75", name: "ACE PitCrew Pilot/Pricing" },
  { id: "74447639-747a-47a4-9283-1380dfaf8892", name: "Kal Tire BD Intro" },
  { id: "2cf1f6a6-14c2-4de7-a9d9-92a8ac428a8b", name: "Canadian Tire Follow Up" },
  { id: "f0df4afe-7dfe-471f-86f0-fa282d51923c", name: "Discount Tire Intro" },
  { id: "6496cb63-666e-4fc2-b7c2-61888103e613", name: "ACE Weekly Sync" },
  { id: "0380b110-2761-4998-8df4-5ac61da792ec", name: "Canadian Tire BD Intro" },
  { id: "ce138401-f356-4614-af0e-1974aa71f570", name: "Oilex Discovery" },
  { id: "965130f8-b303-4845-a5cb-ba68a38336b1", name: "Cox Automotive Demo" },
  { id: "e4647cfd-b7da-493c-a407-11a7eb4091d6", name: "ACE PitCrew Walkthrough" },
];

async function ingestTargetTranscripts() {
  console.log("=".repeat(80));
  console.log("STEP 1: INGESTING TRANSCRIPT CHUNKS");
  console.log("=".repeat(80));
  
  for (const t of TARGET_TRANSCRIPTS) {
    const existingChunks = await storage.rawQuery(`
      SELECT COUNT(*) as count FROM transcript_chunks WHERE transcript_id = $1
    `, [t.id]) as { count: string }[];
    
    const chunkCount = Number(existingChunks[0]?.count || 0);
    
    if (chunkCount > 0) {
      console.log(`✓ ${t.name}: ${chunkCount} chunks already exist`);
      continue;
    }
    
    try {
      const result = await ingestTranscriptChunks({ transcriptId: t.id, limit: 1 });
      console.log(`+ ${t.name}: ingested ${result.chunksPrepared} chunks`);
    } catch (err) {
      console.log(`✗ ${t.name}: failed - ${err}`);
    }
  }
}

interface ActionResult {
  transcriptId: string;
  companyName: string;
  meetingName: string;
  primaryActions: number;
  secondaryActions: number;
  extractionTimeMs: number;
  actions: any[];
}

async function evaluateActionExtraction() {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 2: EVALUATING ACTION EXTRACTION ACROSS 10 TRANSCRIPTS");
  console.log("=".repeat(80));
  
  const results: ActionResult[] = [];
  
  for (const t of TARGET_TRANSCRIPTS) {
    const transcriptRows = await storage.rawQuery(`
      SELECT leverage_team, customer_names, company_name, name
      FROM transcripts WHERE id = $1
    `, [t.id]) as TranscriptRow[];
    
    if (transcriptRows.length === 0) {
      console.log(`\n✗ ${t.name} - not found`);
      continue;
    }
    
    const transcript = transcriptRows[0];
    
    const chunkRows = await storage.rawQuery(`
      SELECT chunk_index, speaker_role, speaker_name, content
      FROM transcript_chunks WHERE transcript_id = $1 ORDER BY chunk_index
    `, [t.id]) as TranscriptChunkRow[];
    
    if (chunkRows.length === 0) {
      console.log(`\n✗ ${t.name} - No chunks`);
      continue;
    }
    
    console.log(`\n${"─".repeat(80)}`);
    console.log(`Testing: ${transcript.name || transcript.company_name}`);
    console.log(`Company: ${transcript.company_name}`);
    console.log(`Chunks: ${chunkRows.length}`);
    
    const composerChunks: TranscriptChunk[] = chunkRows.map((c: TranscriptChunkRow) => ({
      chunkIndex: c.chunk_index,
      speakerRole: c.speaker_role as "leverege" | "customer" | "unknown",
      speakerName: c.speaker_name,
      text: c.content,
    }));
    
    const startTime = Date.now();
    
    try {
      const { primary, secondary } = await extractMeetingActionStates(composerChunks, {
        leverageTeam: transcript.leverage_team ?? undefined,
        customerNames: transcript.customer_names ?? undefined,
      });
      
      const extractionTime = Date.now() - startTime;
      
      console.log(`\nExtraction completed in ${extractionTime}ms`);
      console.log(`Primary Actions: ${primary.length}`);
      console.log(`Secondary Actions: ${secondary.length}`);
      
      if (primary.length > 0) {
        console.log("\nPrimary Actions:");
        primary.forEach((action: any, i: number) => {
          console.log(`  ${i + 1}. [${action.type}] ${action.action}`);
          console.log(`     Owner: ${action.owner || "Unassigned"}`);
          console.log(`     Confidence: ${action.confidence}`);
        });
      }
      
      results.push({
        transcriptId: t.id,
        companyName: transcript.company_name || "",
        meetingName: transcript.name || t.name,
        primaryActions: primary.length,
        secondaryActions: secondary.length,
        extractionTimeMs: extractionTime,
        actions: primary,
      });
      
    } catch (err) {
      console.log(`\n✗ Extraction failed: ${err}`);
    }
  }
  
  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY: ACTION EXTRACTION QUALITY REPORT");
  console.log("=".repeat(80));
  
  console.log("\n| # | Company | Meeting | Primary | Secondary | Time |");
  console.log("|---|---------|---------|---------|-----------|------|");
  
  let totalPrimary = 0;
  let totalSecondary = 0;
  let totalTime = 0;
  
  results.forEach((r, i) => {
    const company = r.companyName.slice(0, 20).padEnd(20);
    const meeting = r.meetingName.slice(0, 18).padEnd(18);
    console.log(`| ${i + 1} | ${company} | ${meeting} | ${String(r.primaryActions).padStart(7)} | ${String(r.secondaryActions).padStart(9)} | ${String(r.extractionTimeMs).padStart(4)}ms |`);
    totalPrimary += r.primaryActions;
    totalSecondary += r.secondaryActions;
    totalTime += r.extractionTimeMs;
  });
  
  console.log("|---|---------|---------|---------|-----------|------|");
  console.log(`\nTOTAL: ${totalPrimary} primary, ${totalSecondary} secondary across ${results.length} transcripts`);
  console.log(`Average per transcript: ${(totalPrimary / results.length).toFixed(1)} primary actions`);
  console.log(`Average extraction time: ${(totalTime / results.length).toFixed(0)}ms`);
  
  // Quality analysis
  console.log("\n" + "─".repeat(80));
  console.log("QUALITY ANALYSIS");
  console.log("─".repeat(80));
  
  const allActions = results.flatMap(r => r.actions);
  
  // Count action types
  const typeCount: Record<string, number> = {};
  allActions.forEach(a => {
    typeCount[a.type] = (typeCount[a.type] || 0) + 1;
  });
  console.log("\nAction Types Distribution:");
  Object.entries(typeCount).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type}: ${count} (${((count / allActions.length) * 100).toFixed(0)}%)`);
  });
  
  // Check for potential issues
  console.log("\nPotential Issues:");
  
  const introduceActions = allActions.filter(a => 
    a.action.toLowerCase().includes("introduce") || 
    a.action.toLowerCase().includes("introduction")
  );
  if (introduceActions.length > 0) {
    console.log(`  ⚠️ ${introduceActions.length} "introduce" actions may be in-call resolved`);
  }
  
  const systemActions = allActions.filter(a => 
    a.action.toLowerCase().includes("the system") || 
    a.action.toLowerCase().includes("the platform") ||
    a.action.toLowerCase().includes("will provide")
  );
  if (systemActions.length > 0) {
    console.log(`  ⚠️ ${systemActions.length} actions may be system feature descriptions`);
  }
  
  const vagueActions = allActions.filter(a => 
    a.action.toLowerCase().includes("look into") ||
    a.action.toLowerCase().includes("think about") ||
    a.action.toLowerCase().includes("explore")
  );
  if (vagueActions.length > 0) {
    console.log(`  ⚠️ ${vagueActions.length} actions may be too vague`);
  }
  
  const unassignedActions = allActions.filter(a => 
    !a.owner || a.owner === "Unassigned" || a.owner === "Unknown"
  );
  if (unassignedActions.length > 0) {
    console.log(`  ⚠️ ${unassignedActions.length} actions have no clear owner`);
  }
  
  // Look for key quality patterns
  const decisionChats = allActions.filter(a =>
    (a.action.toLowerCase().includes("chat with") ||
     a.action.toLowerCase().includes("discuss") ||
     a.action.toLowerCase().includes("sync with")) &&
    a.confidence >= 0.85
  );
  console.log(`\n✓ ${decisionChats.length} decision-related discussions captured`);
  
  const sendActions = allActions.filter(a =>
    a.action.toLowerCase().includes("send") &&
    a.confidence >= 0.85
  );
  console.log(`✓ ${sendActions.length} "send" deliverable actions captured`);
  
  console.log("\n✓ Evaluation complete!");
}

async function main() {
  try {
    await ingestTargetTranscripts();
    await evaluateActionExtraction();
    process.exit(0);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
