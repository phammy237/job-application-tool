'use client';

import { Button } from '@career-os/ui';
import { useEffect, useRef, useState } from 'react';
import type { ResumeCompileState } from './use-resume-compile';

// Client-side PDF *rendering* half of pdfjs-dist — apps/web/lib/pdf-text-extraction.ts already
// uses this package server-side for the other half (text extraction from an uploaded résumé).
// The worker file is served as a plain static asset from /public rather than resolved through
// webpack (Next.js's bundler rejects a `new URL('pdfjs-dist/...', import.meta.url)` reference
// to this package's ESM worker with an "ESM packages need to be imported" build error) — see
// public/pdf.worker.min.mjs, copied from node_modules/pdfjs-dist/build/pdf.worker.min.mjs.
// Must be re-copied if the pdfjs-dist dependency version ever changes.
async function loadPdfjs() {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  return pdfjsLib;
}

/**
 * The actual rendered PDF preview panel — replaces the raw-`.tex`-in-a-`<pre>` "preview" that
 * used to live here. Renders onto a `<canvas>` via pdfjs-dist rather than an `<iframe>`/`<embed>`
 * so zoom/fit-width are just a re-render at a different scale, not fighting a browser's native
 * PDF viewer chrome. Shows the LAST successfully compiled PDF even while a newer compile is
 * in flight or has failed (marked "Unsaved changes"/"Compilation error" respectively) — never
 * blanks a working preview just because the draft changed underneath it.
 */
export function ResumePdfPreview({
  state,
  onRefresh,
  onDownloadPdf,
  onDownloadTex,
}: {
  state: ResumeCompileState;
  onRefresh: () => void;
  onDownloadPdf: (blob: Blob) => void;
  onDownloadTex: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);

  const currentBlob = state.kind === 'ready' ? state.blob : null;

  useEffect(() => {
    if (!currentBlob) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await loadPdfjs();
        const buffer = await currentBlob.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setPageIndex(0);
        setRenderError(null);
      } catch {
        if (!cancelled) setRenderError('Could not render this PDF for preview.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentBlob]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const page = await pdfDoc.getPage(pageIndex + 1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = fitWidth && containerRef.current
        ? Math.max((containerRef.current.clientWidth - 32) / baseViewport.width, 0.1)
        : zoom;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport }).promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageIndex, zoom, fitWidth]);

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Preview</h3>
          <StatusLabel state={state} />
        </div>
        <div className="flex items-center gap-2">
          {pdfDoc && pdfDoc.numPages > 1 ? (
            <div className="flex items-center gap-1 text-xs">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
              >
                ←
              </Button>
              <span className="text-muted-foreground">
                Page {pageIndex + 1} / {pdfDoc.numPages}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pageIndex >= pdfDoc.numPages - 1}
                onClick={() => setPageIndex((i) => Math.min(pdfDoc.numPages - 1, i + 1))}
              >
                →
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            variant={fitWidth ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFitWidth(true)}
          >
            Fit width
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={fitWidth === false && zoom <= 0.4}
            onClick={() => {
              setFitWidth(false);
              setZoom((z) => Math.max(0.4, (fitWidth ? 1 : z) - 0.15));
            }}
          >
            −
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setFitWidth(false);
              setZoom((z) => Math.min(3, (fitWidth ? 1 : z) + 0.15));
            }}
          >
            +
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="border-border bg-muted sticky top-4 max-h-[80vh] overflow-auto rounded-md border p-4"
      >
        {state.kind === 'not_configured' ? (
          <EmptyPanel>
            PDF preview isn&apos;t configured for this deployment yet — download the .tex file
            and compile it yourself (e.g. paste it into Overleaf) until a compile service is
            connected.
          </EmptyPanel>
        ) : state.kind === 'idle' || (state.kind === 'compiling' && !currentBlob) ? (
          <EmptyPanel>Generating preview…</EmptyPanel>
        ) : currentBlob ? (
          <canvas ref={canvasRef} className="mx-auto block shadow" />
        ) : state.kind === 'error' ? (
          <EmptyPanel>Compilation error — see details below.</EmptyPanel>
        ) : (
          <EmptyPanel>No preview yet.</EmptyPanel>
        )}
        {renderError ? <p className="text-destructive mt-2 text-xs">{renderError}</p> : null}
      </div>

      {state.kind === 'error' ? (
        <div className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-sm">
          <p className="text-destructive font-medium">Compilation error</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {state.message}
            {state.line ? ` (line ${state.line})` : ''}
          </p>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          disabled={!currentBlob}
          onClick={() => currentBlob && onDownloadPdf(currentBlob)}
        >
          Download PDF
        </Button>
        <Button type="button" variant="outline" onClick={onDownloadTex}>
          Download .tex
        </Button>
      </div>
    </div>
  );
}

function StatusLabel({ state }: { state: ResumeCompileState }) {
  if (state.kind === 'not_configured') {
    return <span className="text-muted-foreground text-xs">Not configured</span>;
  }
  if (state.kind === 'compiling') {
    return <span className="text-muted-foreground text-xs">Generating preview…</span>;
  }
  if (state.kind === 'error') {
    return <span className="text-destructive text-xs">Compilation error</span>;
  }
  if (state.kind === 'ready') {
    return state.stale ? (
      <span className="text-xs text-amber-600">Unsaved changes</span>
    ) : (
      <span className="text-xs text-green-700">Compiled successfully</span>
    );
  }
  return null;
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex min-h-[40vh] items-center justify-center text-center text-sm">
      <p className="max-w-sm">{children}</p>
    </div>
  );
}
