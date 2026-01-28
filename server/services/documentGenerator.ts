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
} from 'docx';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEVEREGE_LOGO_PATH = path.join(__dirname, '../assets/leverege-logo.png');

interface DocumentConfig {
  generateDocForContracts: string[];
  wordThreshold: number;
  fileNamePattern: string;
  messages: Record<string, string>;
  closing: string;
}

interface DocumentSection {
  heading?: string;
  level?: 1 | 2;
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
  
  console.log(`[DocumentGenerator] Checking contract="${contract}" (type: ${typeof contract}) against list=${JSON.stringify(config.generateDocForContracts)}, wordCount=${wordCount}, threshold=${config.wordThreshold}`);
  
  const isInList = config.generateDocForContracts.includes(contract);
  console.log(`[DocumentGenerator] Contract "${contract}" in list: ${isInList}, exact match test: ${config.generateDocForContracts.some(c => c === contract)}`);
  
  if (isInList) {
    console.log(`[DocumentGenerator] Contract "${contract}" is in doc list - will generate document`);
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
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({
            text: trimmed.substring(2),
          }),
        ],
        bullet: { level: 0 },
        spacing: { before: 100, after: 100 },
      }));
    } else if (/^\d+\.\s/.test(trimmed)) {
      const match = trimmed.match(/^\d+\.\s(.+)/);
      if (match) {
        paragraphs.push(new Paragraph({
          children: [
            new TextRun({
              text: match[1],
            }),
          ],
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
      const children: TextRun[] = [];
      let remaining = trimmed;
      
      const boldRegex = /\*\*(.+?)\*\*/g;
      let lastIndex = 0;
      let match;
      
      while ((match = boldRegex.exec(remaining)) !== null) {
        if (match.index > lastIndex) {
          children.push(new TextRun({
            text: remaining.substring(lastIndex, match.index),
          }));
        }
        children.push(new TextRun({
          text: match[1],
          bold: true,
        }));
        lastIndex = match.index + match[0].length;
      }
      
      if (lastIndex < remaining.length) {
        children.push(new TextRun({
          text: remaining.substring(lastIndex),
        }));
      }
      
      if (children.length === 0) {
        children.push(new TextRun({ text: remaining }));
      }
      
      paragraphs.push(new Paragraph({
        children,
        spacing: { before: 100, after: 100 },
      }));
    }
  }
  
  return paragraphs;
}

function renderSection(section: DocumentSection): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  
  if (section.heading) {
    const headingLevel = section.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2;
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
        new Paragraph({
          children: [
            new ImageRun({
              data: fs.readFileSync(LEVEREGE_LOGO_PATH),
              transformation: {
                width: 180,
                height: 45,
              },
              type: 'png',
            }),
          ],
          spacing: { after: 200 },
        }),
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
    
    if (trimmed.startsWith('## ')) {
      if (currentSection || currentContent.length > 0) {
        sections.push({
          heading: currentSection?.heading,
          level: currentSection?.level || 2,
          content: currentContent.join('\n'),
        });
      }
      currentSection = { heading: trimmed.substring(3), level: 2, content: '' };
      currentContent = [];
    } else if (trimmed.startsWith('# ')) {
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
