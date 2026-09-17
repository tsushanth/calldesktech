import { chunkPlainText, type ScrapedItem } from './scraper';

// Extracts text from an uploaded PDF and chunks it the same way pasted text
// is chunked — a PDF is really just "text we got a different way," so it
// reuses chunkPlainText rather than a separate PDF-specific splitting
// scheme. pdf-parse's own page-break markers ('\f' between pages) are
// normalized to blank lines first so chunking treats a page boundary like
// a paragraph boundary, not one giant run-on block of text.
export async function extractPdfText(buffer: Buffer, titlePrefix: string): Promise<ScrapedItem[]> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = result.text.replace(/\f/g, '\n\n');
    if (!text.trim()) {
      throw new Error('No extractable text found in this PDF (it may be scanned images rather than real text)');
    }
    return chunkPlainText(text, titlePrefix);
  } finally {
    await parser.destroy();
  }
}
