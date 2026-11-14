"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Icon } from "./Icon";
import type { PagePayload } from "@/lib/aster";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type Highlight = { id: string; quote: string };
type Mark = { group: string; index: number; left: number; top: number; width: number; height: number };

type Props = {
  page: PagePayload;
  highlights: Highlight[];
  scanning: boolean;
  onRendered?: () => void;
  onEvidence?: () => void;
};

const plain = (value: string) =>
  value
    .replace(/[őĄ]/g, "fi")
    .replace(/[ŐĄ]/g, "Fi")
    .replace(/Ÿ/g, "e")
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");

export default function PdfViewer({ page, highlights, scanning, onRendered, onEvidence }: Props) {
  const [pageNumber, setPageNumber] = useState(page.page);
  // o total pertence a um PDF; ao trocar de arquivo ele some até o novo carregar
  const [loaded, setLoaded] = useState({ url: "", pages: 0 });
  const numPages = loaded.url === page.pdf_url ? loaded.pages : 0;
  const [box, setBox] = useState({ width: 600, height: 400 });
  const [aspect, setAspect] = useState(4 / 3);
  const [zoom, setZoom] = useState(1);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [rendered, setRendered] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const highlightKey = highlights.map((item) => item.id).join("|");
  // o pai recria a lista e as funções a cada evento; guardamos em refs para não refazer a busca no texto
  const highlightsRef = useRef(highlights);
  const callbacks = useRef({ onRendered, onEvidence });
  highlightsRef.current = highlights;
  callbacks.current = { onRendered, onEvidence };

  useEffect(() => {
    setPageNumber(page.page);
    setZoom(1);
  }, [page.document_id, page.page]);


  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const update = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // só a página, o tamanho ou o zoom exigem nova renderização do texto; trocar o trecho não
  useEffect(() => {
    setMarks([]);
    setRendered(false);
  }, [pageNumber, page.document_id, box.width, box.height, zoom]);

  useEffect(() => { setMarks([]); }, [highlightKey]);

  const fitWidth = Math.max(220, Math.floor(Math.min(box.width - 28, (box.height - 28) * aspect)));
  const width = Math.round(fitWidth * zoom);

  const locate = useCallback(() => {
    const host = sheet.current;
    if (!host) return;
    const layer = host.querySelector(".react-pdf__Page__textContent");
    if (!layer) return;
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const mapped: { node: Text; offset: number }[] = [];
    let normalized = "";
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const content = node.textContent ?? "";
      for (let index = 0; index < content.length; index++) {
        for (const char of plain(content[index])) {
          normalized += char;
          mapped.push({ node, offset: index });
        }
      }
    }
    const origin = host.getBoundingClientRect();
    const found: Mark[] = [];
    for (const highlight of highlightsRef.current) {
      const full = plain(highlight.quote);
      const attempts = [full, full.slice(0, 90), full.slice(0, 45), full.slice(-45)].filter((item) => item.length >= 12);
      let start = -1;
      let needle = "";
      for (const attempt of attempts) {
        start = normalized.indexOf(attempt);
        if (start >= 0) { needle = attempt; break; }
      }
      if (start < 0) continue;
      const first = mapped[start];
      const last = mapped[start + needle.length - 1];
      if (!first || !last) continue;
      const range = document.createRange();
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset + 1);
      // agrupa os retângulos por linha para um destaque limpo
      const lines: DOMRect[] = [];
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1) continue;
        const line = lines.find((item) => Math.abs(item.top - rect.top) < rect.height * 0.5);
        if (line) {
          const left = Math.min(line.left, rect.left);
          const right = Math.max(line.right, rect.right);
          lines[lines.indexOf(line)] = new DOMRect(left, Math.min(line.top, rect.top), right - left, Math.max(line.height, rect.height));
        } else lines.push(rect);
      }
      lines.forEach((rect, index) => found.push({ group: highlight.id, index, left: rect.left - origin.left - 2, top: rect.top - origin.top - 1, width: rect.width + 4, height: rect.height + 2 }));
    }
    setMarks(found);
    if (found.length) callbacks.current.onEvidence?.();
    // highlightKey muda quando os trechos a marcar mudam de verdade
  }, [highlightKey]);

  const onTextLayer = useCallback(() => {
    setRendered(true);
    callbacks.current.onRendered?.();
    window.setTimeout(locate, 40);
  }, [locate]);

  useEffect(() => {
    if (rendered) locate();
  }, [rendered, locate]);

  const file = useMemo(() => page.pdf_url, [page.pdf_url]);
  const firstGroup = marks[0]?.group;

  return (
    <div className="pdf">
      <div className="pdf-stage" ref={stage}>
        <div className="pdf-scroll">
          <div className="pdf-sheet" ref={sheet} style={{ width }} data-cursor="doc-page">
            <Document
              file={file}
              onLoadSuccess={({ numPages: count }) => setLoaded({ url: page.pdf_url, pages: count })}
              loading={<div className="pdf-placeholder" style={{ width, height: width / aspect }} />}
              error={<p className="pdf-error">Não foi possível abrir o PDF.</p>}
            >
              <Page
                pageNumber={pageNumber}
                width={width}
                renderAnnotationLayer={false}
                onLoadSuccess={(loaded) => setAspect(loaded.originalWidth / loaded.originalHeight)}
                onRenderTextLayerSuccess={onTextLayer}
                loading={<div className="pdf-placeholder" style={{ width, height: width / aspect }} />}
              />
            </Document>
            {pageNumber === page.page && marks.map((mark) => (
              <motion.span
                key={`${mark.group}-${mark.index}-${width}`}
                className="pdf-mark"
                data-cursor={mark.group === firstGroup ? "evidence" : undefined}
                style={{ left: mark.left, top: mark.top, width: mark.width, height: mark.height }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.55 + mark.index * 0.28, duration: 0.42, ease: [0.23, 1, 0.32, 1] }}
              />
            ))}
            {scanning && rendered && <span className="pdf-scan" aria-hidden="true" />}
          </div>
        </div>
      </div>
      <div className="pdf-toolbar" role="toolbar" aria-label="Controles do documento">
        <button type="button" className="icon-button" onClick={() => setPageNumber((value) => Math.max(1, value - 1))} disabled={pageNumber <= 1} aria-label="Página anterior"><Icon name="left" /></button>
        <span className="pdf-count">Página {pageNumber} de {numPages || "…"}</span>
        <button type="button" className="icon-button" onClick={() => setPageNumber((value) => Math.min(numPages || value, value + 1))} disabled={!numPages || pageNumber >= numPages} aria-label="Próxima página"><Icon name="right" /></button>
        {pageNumber !== page.page && <button type="button" className="text-button" onClick={() => setPageNumber(page.page)}>Voltar à página {page.page}</button>}
        <span className="toolbar-gap" />
        <button type="button" className="icon-button" onClick={() => setZoom((value) => Math.max(0.6, +(value - 0.15).toFixed(2)))} aria-label="Diminuir zoom"><Icon name="minus" /></button>
        <button type="button" className="text-button zoom-value" onClick={() => setZoom(1)} aria-label="Ajustar à tela">{Math.round(zoom * 100)}%</button>
        <button type="button" className="icon-button" onClick={() => setZoom((value) => Math.min(2.4, +(value + 0.15).toFixed(2)))} aria-label="Aumentar zoom"><Icon name="plus" /></button>
        <a className="icon-button" href={`${page.pdf_url}#page=${pageNumber}`} target="_blank" rel="noreferrer" aria-label="Abrir PDF em nova aba"><Icon name="external" /></a>
      </div>
    </div>
  );
}
