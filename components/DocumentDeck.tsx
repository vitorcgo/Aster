"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Drawable } from "./Drawable";
import { Icon } from "./Icon";
import { faviconUrl, lectureLabel, siteName, type PagePayload, type WebSource } from "@/lib/aster";

const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false, loading: () => <div className="pdf-boot" /> });

export type DocTab =
  | { id: string; kind: "page"; page: PagePayload }
  | { id: string; kind: "web"; query: string; provider: string; results: WebSource[] };

type Props = {
  tabs: DocTab[];
  activeId: string | null;
  drawId: string | null;
  onSelect: (id: string) => void;
  highlights: { id: string; quote: string }[];
  focusWebId: string | null;
  scanning: boolean;
  onRendered: () => void;
  onEvidence: () => void;
};

// várias pesquisas na web viram várias abas; o termo pesquisado as diferencia
function webLabel(query: string) {
  const text = query.trim() || "Web";
  return text.length > 24 ? `${text.slice(0, 23)}…` : text;
}

export function pageTabId(documentId: string, page: number) {
  return `${documentId}-p${page}`;
}

function WebPanel({ tab, focusId }: { tab: Extract<DocTab, { kind: "web" }>; focusId: string | null }) {
  return (
    <div className="web-panel" data-cursor="doc-web">
      <p className="web-query">
        <Icon name="search" size={15} />
        <span>“{tab.query}”</span>
        <span className="web-provider">via {tab.provider === "google" ? "Google" : "Wikipédia"}</span>
      </p>
      {tab.results.length === 0 && <p className="web-empty">A pesquisa não trouxe resultados.</p>}
      <ol className="web-results">
        {tab.results.map((result, index) => (
          <motion.li
            key={result.id}
            className={`web-card ${focusId === result.id ? "is-focus" : ""}`}
            data-cursor={`web-${result.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * index, duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="web-card-site">
              <img src={faviconUrl(result.domain)} alt="" width="20" height="20" />
              <span>{siteName(result.domain)}</span>
              <span className="web-card-id">{result.id.replace("web-", "web ")}</span>
            </div>
            <a className="web-card-title" href={result.url} target="_blank" rel="noreferrer">{result.title}<Icon name="external" size={14} /></a>
            <p className="web-card-snippet">{result.snippet}</p>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

export function DocumentDeck({ tabs, activeId, drawId, onSelect, highlights, focusWebId, scanning, onRendered, onEvidence }: Props) {
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1] ?? null;
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [active?.id]);

  return (
    <section className="deck" aria-label="Fontes abertas">
      <div className="deck-tabs" role="tablist" aria-label="Páginas e pesquisas abertas" ref={strip}>
        {tabs.length === 0 && <span className="deck-tabs-empty">Fontes</span>}
        {tabs.map((tab) => {
          const selected = tab.id === active?.id;
          return (
            <button key={tab.id} type="button" role="tab" aria-selected={selected} className="deck-tab" data-cursor={`tab-${tab.id}`} onClick={() => onSelect(tab.id)}>
              {tab.kind === "page" ? <Icon name="page" size={15} /> : <img src={faviconUrl(tab.results[0]?.domain ?? "wikipedia.org")} alt="" width="15" height="15" />}
              <span>{tab.kind === "page" ? lectureLabel(tab.page.document_id, tab.page.page) : webLabel(tab.query)}</span>
              {selected && <motion.span className="deck-tab-line" layoutId="deck-tab-line" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            </button>
          );
        })}
      </div>
      <div className="deck-body" data-cursor="doc">
        <AnimatePresence mode="wait" initial={false}>
          {!active ? (
            <motion.div key="empty" className="deck-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Icon name="book" size={28} />
              <p>As páginas que o Aster abrir e os sites que ele consultar aparecem aqui.</p>
            </motion.div>
          ) : (
            <motion.div key={active.id} className="deck-slot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <Drawable target={`sheet-${active.id}`} enabled={drawId === active.id} radius={14} className="deck-sheet">
              {active.kind === "page" ? (
                <>
                  <p className="deck-caption"><strong>{active.page.title.split(" · ")[0]}</strong> {active.page.title.split(" · ").slice(1).join(" ")}</p>
                  <PdfViewer page={active.page} highlights={highlights} scanning={scanning} onRendered={onRendered} onEvidence={onEvidence} />
                </>
              ) : (
                <WebPanel tab={active} focusId={focusWebId} />
              )}
              </Drawable>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
