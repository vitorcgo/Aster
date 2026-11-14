"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Drawable } from "./Drawable";
import { Icon } from "./Icon";
import { faviconUrl, lectureLabel, siteName, type PagePayload, type WebSource, providerLabel } from "@/lib/aster";

const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false, loading: () => <div className="pdf-boot" /> });

/** Uma fonte aberta. `turn` é a pergunta dona dela: cada pergunta mostra só as próprias fontes. */
export type DocTab =
  | { id: string; kind: "page"; page: PagePayload; turn?: string }
  | { id: string; kind: "web"; query: string; provider: string; results: WebSource[]; turn?: string };

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
  /** texto do estado vazio, conforme a pergunta ativa */
  empty?: string;
  /** pergunta dona das fontes na tela, e para que lado ela fica na conversa (1 = mais nova, -1 = mais antiga) */
  turnKey?: string | null;
  direction?: number;
};

// Trocar de pergunta é trocar de baralho: o cartão da pergunta anterior recua para trás e o da nova entra por cima.
// Voltar a uma pergunta antiga faz o caminho inverso. Dentro da mesma pergunta, trocar de aba é só um esmaecer.
const card = {
  enter: (shift: number) => ({ opacity: 0, x: shift * 56, y: shift ? 6 : 0, scale: shift ? 0.96 : 1, rotate: shift * 1.4, zIndex: 2 }),
  center: { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, zIndex: 2 },
  exit: (shift: number) => ({ opacity: 0, x: shift * -40, y: shift ? 14 : 0, scale: shift ? 0.9 : 1, rotate: shift * -2, zIndex: 1 }),
};
const cardMotion = { type: "spring", stiffness: 260, damping: 30, mass: 0.9, opacity: { duration: 0.24 } } as const;

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
        <span className="web-provider">via {providerLabel(tab.provider)}</span>
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

export function DocumentDeck({ tabs, activeId, drawId, onSelect, highlights, focusWebId, scanning, onRendered, onEvidence, empty, turnKey = null, direction = 1 }: Props) {
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1] ?? null;
  const strip = useRef<HTMLDivElement>(null);
  // o deslocamento só vale quando a pergunta mudou; calculado no render para o cartão que sai e o que entra concordarem
  const slotKey = `${turnKey ?? "none"}:${active?.id ?? "empty"}`;
  const last = useRef({ slotKey, turnKey, shift: 0 });
  if (last.current.slotKey !== slotKey) {
    last.current = { slotKey, turnKey, shift: last.current.turnKey !== turnKey ? (direction < 0 ? -1 : 1) : 0 };
  }
  const shift = last.current.shift;

  useEffect(() => {
    // rola só a faixa de abas, na horizontal: scrollIntoView rolava a página inteira até o documento (no celular, ao abrir)
    const bar = strip.current;
    const tab = bar?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!bar || !tab) return;
    const left = tab.offsetLeft - bar.offsetLeft;
    if (left < bar.scrollLeft) bar.scrollTo({ left, behavior: "smooth" });
    else if (left + tab.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: left + tab.offsetWidth - bar.clientWidth, behavior: "smooth" });
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
        <AnimatePresence initial={false} custom={shift}>
          {!active ? (
            <motion.div key={slotKey} className="deck-empty" custom={shift} variants={card} initial="enter" animate="center" exit="exit" transition={cardMotion}>
              <Icon name="book" size={28} />
              <p>{empty ?? "As páginas que o Aster abrir e os sites que ele consultar aparecem aqui."}</p>
            </motion.div>
          ) : (
            <motion.div key={slotKey} className="deck-slot" custom={shift} variants={card} initial="enter" animate="center" exit="exit" transition={cardMotion}>
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
