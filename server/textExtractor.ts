import mammoth from "mammoth";
import { Buffer } from "buffer";
import { createRequire } from "module";

// pdf-parse is CommonJS only, use require
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

export async function extractTextFromFile(buffer: Buffer, filename: string): Promise<string> {
  const extension = filename.toLowerCase().split('.').pop();

  switch (extension) {
    case 'txt':
      return buffer.toString('utf-8');
    
    case 'docx':
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    
    case 'pdf':
      const data = await pdfParse(buffer);
      return data.text;
    
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
}

export async function extractTextFromUrl(url: string): Promise<string> {
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  
  // For plain text or HTML, just get the text content
  if (contentType.includes('text/plain')) {
    return await response.text();
  }
  
  if (contentType.includes('text/html')) {
    const html = await response.text();
    // Simple HTML to text conversion - strip tags
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // For Google Docs export
  if (url.includes('docs.google.com')) {
    // Try to convert to plain text export URL
    const exportUrl = url.replace(/\/edit.*$/, '/export?format=txt');
    const exportResponse = await fetch(exportUrl);
    
    if (exportResponse.ok) {
      return await exportResponse.text();
    }
  }

  // For other content types, try to get as text
  const text = await response.text();
  return text;
}
