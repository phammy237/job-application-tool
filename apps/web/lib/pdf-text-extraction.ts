import 'server-only';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfTextExtractionResult =
  | { status: 'ok'; text: string }
  | { status: 'no_extractable_text' }
  | { status: 'parse_failed'; message: string };

/**
 * Deterministic, server-side selectable-text extraction only — no OCR (docs/DEPLOYMENT.md's
 * Resume Import section: "no OCR unless absolutely necessary," and it hasn't been). Uses
 * `pdfjs-dist` — the real, actively-maintained Mozilla PDF.js library — directly, rather than a
 * thin wrapper package: a real-incident finding during this feature's own live verification.
 * `pdf-parse@1.1.1` (the initially-chosen wrapper) bundles a ~2017 pdf.js snapshot that failed to
 * parse output from BOTH `pdfkit` and `pdf-lib` (two different, current, widely-used PDF writer
 * libraries) with "bad XRef entry"/"Invalid PDF structure" — a real reliability risk for actual
 * user résumés (exported from Word, Google Docs, Canva, LaTeX, etc. — virtually all "modern" PDF
 * output), not just a synthetic-test-file quirk. Its package root also had an unrelated top-level
 * side effect that broke the production build entirely (see git history — fixed first, then this
 * library swap fixed the underlying parsing reliability problem itself). `pdfjs-dist`'s Node
 * ("legacy") build correctly parsed both writers' output in live verification.
 *
 * A scanned/image-only PDF has no text layer at all; this honestly reports that
 * (`no_extractable_text`) rather than returning empty text as if it were a real (if short)
 * résumé — the caller must never treat that as "an empty résumé."
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfTextExtractionResult> {
  try {
    const doc = await getDocument({
      data: new Uint8Array(buffer),
      // Silences a benign "standardFontDataUrl not provided" warning for PDFs using the 14
      // standard PDF fonts (Helvetica, Times, etc.) — text extraction doesn't render glyphs, so
      // no font files are actually fetched; this only tells pdf.js where it would look, not to.
      standardFontDataUrl: undefined,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pageTexts.push(pageText);
    }
    await doc.destroy();

    const text = pageTexts.join('\n').trim();
    if (!text) {
      return { status: 'no_extractable_text' };
    }
    return { status: 'ok', text };
  } catch (error) {
    return {
      status: 'parse_failed',
      message: error instanceof Error ? error.message : 'Unknown PDF parsing error',
    };
  }
}
