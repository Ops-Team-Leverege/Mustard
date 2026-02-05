import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ExternalHyperlink,
} from 'docx';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve logo path once at initialization
const LEVEREGE_LOGO_PATH = (() => {
  const possiblePaths = [
    path.join(__dirname, '../assets/leverege-logo.png'),
    path.join(process.cwd(), 'server/assets/leverege-logo.png'),
    path.join(__dirname, '../../server/assets/leverege-logo.png'),
    path.join(process.cwd(), 'assets/leverege-logo.png'),
  ];
  
  for (const logoPath of possiblePaths) {
    if (fs.existsSync(logoPath)) {
      console.log(`[DocumentGenerator] Found logo at: ${logoPath}`);
      return logoPath;
    }
  }
  
  console.error(`[DocumentGenerator] Logo not found in any of these paths:`, possiblePaths);
  return null;
})();

// Load logo buffer with graceful fallback
function getLeveregeLogo(): Buffer | null {
  if (!LEVEREGE_LOGO_PATH) return null;
  try {
    return fs.readFileSync(LEVEREGE_LOGO_PATH);
  } catch (error) {
    console.error(`[DocumentGenerator] Error reading logo: ${error}`);
    return null;
  }
}

interface DocumentConfig {
  generateDocForContracts: string[];
  neverGenerateDocForContracts?: string[];
  wordThreshold: number;
  fileNamePattern: string;
  messages: Record<string, string>;
  closing: string;
}

interface DocumentSection {
  heading?: string;
  level?: 1 | 2 | 3;
  content: string | string[];
}

interface DocumentRequest {
  type: string;
  title: string;
  sections: DocumentSection[];
  metadata: {
    customer?: string;
    date: string;
  };
}

let configCache: DocumentConfig | null = null;

export function getDocumentConfig(): DocumentConfig {
  if (configCache) return configCache;
  
  const configPath = path.join(process.cwd(), 'config', 'documents.json');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  configCache = JSON.parse(configContent) as DocumentConfig;
  return configCache;
}

export function clearConfigCache(): void {
  configCache = null;
}

export function shouldGenerateDocument(contract: string, wordCount: number): boolean {
  // Force reload config to avoid stale cache
  clearConfigCache();
  const config = getDocumentConfig();
  
  // Check if contract is in the never-generate list (e.g., Slack search - links don't work in Word)
  const neverList = config.neverGenerateDocForContracts || [];
  if (neverList.includes(contract)) {
    console.log(`[DocumentGenerator] Contract "${contract}" → never generate document (in exclusion list)`);
    return false;
  }
  
  const isInList = config.generateDocForContracts.includes(contract);
  
  if (isInList) {
    console.log(`[DocumentGenerator] Contract "${contract}" → generate document (wordCount=${wordCount})`);
    return true;
  }
  
  const byWordCount = wordCount > config.wordThreshold;
  console.log(`[DocumentGenerator] Contract not in list, checking word count: ${wordCount} > ${config.wordThreshold} = ${byWordCount}`);
  return byWordCount;
}

export function getDocumentMessage(contract: string): string {
  const config = getDocumentConfig();
  const message = config.messages[contract] || config.messages.default;
  return `${message}\n\n${config.closing}`;
}

export function generateFileName(type: string, customer?: string): string {
  const config = getDocumentConfig();
  const date = new Date().toISOString().split('T')[0];
  
  const customerPart = customer 
    ? customer.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')
    : 'General';
  
  const typePart = type.replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('_');
  
  return config.fileNamePattern
    .replace('{customer}', customerPart)
    .replace('{type}', typePart)
    .replace('{date}', date);
}

/**
 * Parse inline markdown (bold and links) and return array of TextRun/ExternalHyperlink.
 * Handles **word** patterns and [text](url) links within text.
 */
function parseInlineMarkdown(text: string): (TextRun | ExternalHyperlink)[] {
  const children: (TextRun | ExternalHyperlink)[] = [];
  
  // Combined regex for bold and markdown links
  // Matches: **bold text** or [link text](url)
  const inlineRegex = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;
  
  while ((match = inlineRegex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      children.push(new TextRun({
        text: text.substring(lastIndex, match.index),
      }));
    }
    
    if (match[1]) {
      // Bold text: **text**
      children.push(new TextRun({
        text: match[1],
        bold: true,
      }));
    } else if (match[2] && match[3]) {
      // Markdown link: [text](url)
      children.push(new ExternalHyperlink({
        children: [
          new TextRun({
            text: match[2],
            style: "Hyperlink",
            color: "0563C1",
            underline: { type: "single" },
          }),
        ],
        link: match[3],
      }));
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text after last match
  if (lastIndex < text.length) {
    children.push(new TextRun({
      text: text.substring(lastIndex),
    }));
  }
  
  // If no matches, return original text
  if (children.length === 0) {
    children.push(new TextRun({ text }));
  }
  
  return children;
}

function parseMarkdownContent(content: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('## ')) {
      paragraphs.push(new Paragraph({
        text: trimmed.substring(3),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
      }));
    } else if (trimmed.startsWith('# ')) {
      paragraphs.push(new Paragraph({
        text: trimmed.substring(2),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }));
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      // Parse inline markdown in bullet items
      paragraphs.push(new Paragraph({
        children: parseInlineMarkdown(trimmed.substring(2)),
        bullet: { level: 0 },
        spacing: { before: 100, after: 100 },
      }));
    } else if (/^\d+\.\s/.test(trimmed)) {
      const match = trimmed.match(/^\d+\.\s(.+)/);
      if (match) {
        // Parse inline markdown in numbered items
        paragraphs.push(new Paragraph({
          children: parseInlineMarkdown(match[1]),
          bullet: { level: 0 },
          spacing: { before: 100, after: 100 },
        }));
      }
    } else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({
            text: trimmed.slice(2, -2),
            bold: true,
          }),
        ],
        spacing: { before: 200, after: 100 },
      }));
    } else {
      // Parse inline markdown for regular text
      paragraphs.push(new Paragraph({
        children: parseInlineMarkdown(trimmed),
        spacing: { before: 100, after: 100 },
      }));
    }
  }
  
  return paragraphs;
}

function renderSection(section: DocumentSection): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  
  if (section.heading) {
    let headingLevel: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2 | typeof HeadingLevel.HEADING_3;
    if (section.level === 1) {
      headingLevel = HeadingLevel.HEADING_1;
    } else if (section.level === 3) {
      headingLevel = HeadingLevel.HEADING_3;
    } else {
      headingLevel = HeadingLevel.HEADING_2;
    }
    paragraphs.push(new Paragraph({
      text: section.heading,
      heading: headingLevel,
      spacing: { before: 400, after: 200 },
    }));
  }
  
  if (Array.isArray(section.content)) {
    for (const item of section.content) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: item })],
        bullet: { level: 0 },
        spacing: { before: 100, after: 100 },
      }));
    }
  } else {
    paragraphs.push(...parseMarkdownContent(section.content));
  }
  
  return paragraphs;
}

export async function generateDocument(request: DocumentRequest): Promise<Buffer> {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 22,
          },
        },
        heading1: {
          run: {
            font: 'Arial',
            size: 32,
            bold: true,
            color: '1a365d',
          },
        },
        heading2: {
          run: {
            font: 'Arial',
            size: 28,
            bold: true,
            color: '2d3748',
          },
        },
      },
    },
    sections: [{
      properties: {},
      children: [
        // Logo paragraph (optional - skipped if logo not found)
        ...((): Paragraph[] => {
          const logoData = getLeveregeLogo();
          if (logoData) {
            return [new Paragraph({
              children: [
                new ImageRun({
                  data: logoData,
                  transformation: {
                    width: 180,
                    height: 45,
                  },
                  type: 'png',
                }),
              ],
              spacing: { after: 200 },
            })];
          }
          // Fallback: text-based header if logo not found
          return [new Paragraph({
            children: [
              new TextRun({
                text: 'LEVEREGE',
                bold: true,
                size: 28,
                color: '1a365d',
              }),
            ],
            spacing: { after: 200 },
          })];
        })(),
        new Paragraph({
          text: request.title,
          heading: HeadingLevel.TITLE,
          spacing: { before: 200, after: 100 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `Generated by PitCrew Sauce • ${request.metadata.date}`,
              italics: true,
              color: '888888',
              size: 18,
            }),
          ],
          spacing: { after: 400 },
        }),
        ...request.sections.flatMap(section => renderSection(section)),
        new Paragraph({
          children: [],
          spacing: { before: 600 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: '─'.repeat(50),
              color: 'cccccc',
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: 'Generated by PitCrew Sauce • For internal use',
              italics: true,
              color: '888888',
              size: 18,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 200 },
        }),
      ],
    }],
  });

  return await Packer.toBuffer(doc);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

export function contentToSections(content: string, title?: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  
  const lines = content.split('\n');
  let currentSection: DocumentSection | null = null;
  let currentContent: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip markdown horizontal rules (---, ___, ***)
    if (/^[-_*]{3,}$/.test(trimmed)) {
      continue;
    }
    
    // Handle ### headers (level 3)
    if (trimmed.startsWith('### ')) {
      if (currentSection || currentContent.length > 0) {
        sections.push({
          heading: currentSection?.heading,
          level: currentSection?.level || 3,
          content: currentContent.join('\n'),
        });
      }
      currentSection = { heading: trimmed.substring(4), level: 3, content: '' };
      currentContent = [];
    }
    // Handle ## headers (level 2)
    else if (trimmed.startsWith('## ')) {
      if (currentSection || currentContent.length > 0) {
        sections.push({
          heading: currentSection?.heading,
          level: currentSection?.level || 2,
          content: currentContent.join('\n'),
        });
      }
      currentSection = { heading: trimmed.substring(3), level: 2, content: '' };
      currentContent = [];
    } 
    // Handle # headers (level 1)
    else if (trimmed.startsWith('# ')) {
      if (currentSection || currentContent.length > 0) {
        sections.push({
          heading: currentSection?.heading,
          level: currentSection?.level || 1,
          content: currentContent.join('\n'),
        });
      }
      currentSection = { heading: trimmed.substring(2), level: 1, content: '' };
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  
  if (currentSection || currentContent.length > 0) {
    sections.push({
      heading: currentSection?.heading,
      level: currentSection?.level || 2,
      content: currentContent.join('\n'),
    });
  }
  
  if (sections.length === 0) {
    sections.push({ content });
  }
  
  return sections;
}
