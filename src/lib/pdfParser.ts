import { chunkPlainText, type ScrapedItem } from './scraper';

// pdfjs-dist (which pdf-parse v2 is built on) checks for globalThis.DOMMatrix
// and tries to polyfill it via the optional 'canvas' package if missing —
// but 'canvas' needs native compilation (Cairo/Pixman) we don't want to add
// to the Alpine image just for this, and pdfjs-dist only WARNS when canvas
// isn't there rather than actually working around it: something downstream
// still hard-references DOMMatrix regardless, throwing
// "ReferenceError: DOMMatrix is not defined" — caught only in production
// (Fly/Alpine), not local dev, since dev never actually exercised this
// exact code path the same way. Using the lightweight pure-JS `dommatrix`
// package instead of native 'canvas' — text extraction only needs correct
// 2D affine matrix math for glyph positioning, not real canvas rendering.
import DOMMatrix from 'dommatrix';
if (!(globalThis as unknown as { DOMMatrix?: unknown }).DOMMatrix) {
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrix;
}

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
