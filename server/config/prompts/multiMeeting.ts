/**
 * Multi-Meeting Prompts
 * 
 * Prompts for handling questions that span multiple meetings.
 * Includes pattern analysis, trends, and cross-meeting comparisons.
 */

/**
 * Pattern analysis synthesis prompt.
 * Used for finding recurring themes across meetings.
 */
export function buildPatternAnalysisPrompt(params: {
  topic?: string;
  meetingCount: number;
  companyCount: number;
}): string {
  const { topic, meetingCount, companyCount } = params;
  const topicClause = topic ? ` about "${topic}"` : '';
  
  return `You are analyzing patterns across ${meetingCount} meetings from ${companyCount} companies${topicClause}.

TASK: Identify recurring themes and patterns.

GUIDELINES:
- Group similar findings together
- Note frequency (how many meetings mentioned each theme)
- Distinguish between common themes and outliers
- Quote specific evidence where helpful
- Be honest about coverage limitations

FORMAT:
**Recurring Themes:**
1. [Theme] - Mentioned in X meetings
   - Key examples...

**Notable Outliers:**
- [Unique finding from specific company]

Provide actionable insights when possible.`;
}

/**
 * Trend summary synthesis prompt.
 * Used for analyzing changes over time across meetings.
 */
export function buildTrendSummaryPrompt(params: {
  topic?: string;
  meetingCount: number;
  timeRange?: string;
}): string {
  const { topic, meetingCount, timeRange } = params;
  const topicClause = topic ? ` regarding "${topic}"` : '';
  const timeClause = timeRange ? ` over ${timeRange}` : '';
  
  return `You are analyzing trends across ${meetingCount} meetings${topicClause}${timeClause}.

TASK: Identify how discussions have evolved over time.

GUIDELINES:
- Look for shifts in customer priorities
- Note emerging concerns or interests
- Identify declining themes
- Be explicit about the time period and sample size
- Don't over-generalize from limited data

FORMAT:
**Trend Analysis:**
- [Trend 1]: Description with timeline
- [Trend 2]: Description with timeline

**Key Shifts:**
- What's increasing in importance...
- What's decreasing...

Include caveats about data limitations.`;
}

/**
 * Cross-meeting questions synthesis prompt.
 * Used for analyzing questions asked across multiple meetings.
 */
export function buildCrossMeetingQuestionsPrompt(params: {
  meetingCount: number;
  companyCount: number;
}): string {
  const { meetingCount, companyCount } = params;
  
  return `You are analyzing customer questions from ${meetingCount} meetings across ${companyCount} companies.

TASK: Identify common questions and knowledge gaps.

GUIDELINES:
- Group similar questions together
- Note which questions are most frequent
- Identify questions that went unanswered
- Suggest areas needing better documentation

FORMAT:
**Frequently Asked Questions:**
1. [Question theme] - Asked in X meetings
   - Variations: [examples]
   - Common answers given: [summary]

**Knowledge Gaps:**
- [Topics where answers were inconsistent or unclear]

**Recommendations:**
- [Suggestions for improving responses]`;
}

/**
 * Comparison synthesis prompt.
 * Used for comparing findings across different companies/meetings.
 */
export function buildComparisonPrompt(params: {
  topic?: string;
  entities: string[];
}): string {
  const { topic, entities } = params;
  const topicClause = topic ? ` regarding "${topic}"` : '';
  
  return `You are comparing findings across: ${entities.join(", ")}${topicClause}.

TASK: Highlight similarities and differences.

GUIDELINES:
- Create a clear comparison structure
- Note where entities agree
- Highlight key differences
- Be specific with evidence
- Avoid generalizations without support

FORMAT:
**Comparison: ${entities.join(" vs ")}**

| Aspect | ${entities.join(" | ")} |
|--------|${entities.map(() => "--------|").join("")}
| [Topic] | [Finding] | [Finding] |

**Key Similarities:**
- ...

**Key Differences:**
- ...

**Implications:**
- What these differences might mean...`;
}
