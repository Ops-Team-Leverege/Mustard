/**
 * Flexible markdown formatting system.
 * 
 * Supports multiple output formats without hardcoding conversions.
 * Add new formats by extending the formatters object.
 */

export type MarkdownFormat = 'slack' | 'standard' | 'plaintext';

interface FormatRule {
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
}

interface MarkdownFormatter {
  rules: FormatRule[];
}

const formatters: Record<MarkdownFormat, MarkdownFormatter> = {
  slack: {
    rules: [
      // **bold** → *bold* (Slack uses single asterisks)
      { pattern: /\*\*(.+?)\*\*/g, replacement: '*$1*' },
      // ~~strikethrough~~ → ~strikethrough~ (Slack uses single tildes)
      { pattern: /~~(.+?)~~/g, replacement: '~$1~' },
    ],
  },
  standard: {
    rules: [
      // No transformations - keep as-is
    ],
  },
  plaintext: {
    rules: [
      // Remove all markdown formatting
      { pattern: /\*\*(.+?)\*\*/g, replacement: '$1' },
      { pattern: /\*(.+?)\*/g, replacement: '$1' },
      { pattern: /~~(.+?)~~/g, replacement: '$1' },
      { pattern: /`(.+?)`/g, replacement: '$1' },
      { pattern: /^#+\s+/gm, replacement: '' },
      { pattern: /^[-*]\s+/gm, replacement: '- ' },
    ],
  },
};

/**
 * Convert markdown to a specific output format.
 * 
 * @param text - The markdown text to convert
 * @param format - Target format ('slack', 'standard', 'plaintext')
 * @returns Converted text
 */
export function formatMarkdown(text: string, format: MarkdownFormat): string {
  const formatter = formatters[format];
  if (!formatter) {
    console.warn(`[MarkdownFormatter] Unknown format "${format}", returning unchanged`);
    return text;
  }

  let result = text;
  for (const rule of formatter.rules) {
    result = result.replace(rule.pattern, rule.replacement as string);
  }
  return result;
}

