"use client";

import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Mascot } from "./Mascot";
import Link from "next/link";
import { faviconUrl, lectureLabel, siteName, type Source, type TraceNode, type Turn } from "@/lib/aster";
import { stageForPage } from "@/lib/lab";

type Segment = { text: string; bold: boolean };

function segmentsOf(text: string): Segment[] {
  const parts: Segment[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > cursor) parts.push({ text: text.slice(cursor, match.index), bold: false });
    parts.push({ text: match[1], bold: true });
    cursor = match.index! + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), bold: false });
  return parts;
}

function RevealText({ segments, count }: { segments: Segment[]; count: number }) {
  let remaining = count;
  return (
    <>
      {segments.map((segment, index) => {
        if (remaining <= 0) return null;
        const visible = segment.text.slice(0, remaining);
        remaining -= segment.text.length;
        return segment.bold ? <strong key={index}>{visible}</strong> : <Fragment key={index}>{visible}</Fragment>;
      })}
    </>
  );
}

/** Citações da mesma página (ou do mesmo site) viram um chip só. */
function groupCitations(ids: string[], turn: Turn) {
  const groups: { key: string; sources: Source[] }[] = [];
  for (const id of ids) {
    const source = turn.sources.find((item) => item.id === id) ?? turn.seen[id];
    if (!source) continue;
    const key = source.kind === "aula" ? `${source.document_id}:${source.page}` : `web:${source.domain}`;
    const group = groups.find((item) => item.key === key);
    if (group) group.sources.push(source);
    else groups.push({ key, sources: [source] });
  }
  return groups;
}


function listPt(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}
export function SourceChip({ source, onOpen, index }: { source: Source; onOpen: (source: Source) => void; index?: number | string }) {
  return (
    <span className="chip-wrap">
      <button type="button" className={`chip chip-${source.kind}`} onClick={() => onOpen(source)} data-cursor={`chip-${source.id}`}>
        {source.kind === "aula" ? <Icon name="page" size={14} /> : <img src={faviconUrl(source.domain)} alt="" width="14" height="14" />}
        <span>{source.kind === "aula" ? lectureLabel(source.document_id, source.page) : siteName(source.domain)}</span>
        {index !== undefined && <span className="chip-n">{index}</span>}
      </button>
      <span className="chip-peek" role="tooltip">
        <span className="chip-peek-title">{source.kind === "aula" ? source.title : source.title}</span>
        <span className="chip-peek-text">{source.kind === "aula" ? source.quote : source.snippet}</span>
      </span>
    </span>
  );
}

function liveLine(turn: Turn) {
  const last = [...turn.nodes].reverse().find((node: TraceNode) => "intent" in node && node.intent) as (TraceNode & { intent: string }) | undefined;
  if (turn.thinking) return turn.step > 1 ? "Pensando no próximo passo" : "Entendendo a pergunta";
  if (last?.intent) return last.intent;
  const current = turn.nodes[turn.nodes.length - 1];
  if (current?.kind === "check") return "Conferindo se cada frase tem fonte";
  return "Trabalhando";
}

type Props = {
  turns: Turn[];
  revealId: string | null;
  holdId: string | null;
  onRevealDone: (id: string) => void;
  onOpenSource: (source: Source, turn: Turn) => void;
  onRetry: (question: string) => void;
  onShowTrace: (turn: Turn) => void;
  onEdit: (question: string) => void;
  onClear: () => void;
  memory: string[];
  onForget: (index: number | null) => void;
  running: boolean;
  activeTurnId: string | null;
};

const clock = (time?: number) => (time ? new Date(time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");

/** Texto da resposta com as fontes no fim, para colar num resumo. */
function plainAnswer(turn: Turn) {
  const numbered = new Map(turn.sources.map((source, index) => [source.id, index + 1]));
  const body = turn.blocks.map((block) => {
    const marks = [...new Set(block.citation_ids.map((id) => numbered.get(id)).filter(Boolean))].map((n) => `[${n}]`).join("");
    return `${block.text.replace(/\*\*(.+?)\*\*/g, "$1")} ${marks}`.trim();
  }).join("\n\n");
  const sources = turn.sources.map((source, index) => `[${index + 1}] ${source.kind === "aula" ? `${lectureLabel(source.document_id, source.page)}: ${source.title}` : `${source.title} (${source.url})`}`).join("\n");
  return `Pergunta: ${turn.question}\n\n${body}${sources ? `\n\nFontes:\n${sources}` : ""}`;
}

function TurnActions({ turn, onEdit, onRetry, running }: { turn: Turn; onEdit: (question: string) => void; onRetry: (question: string) => void; running: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainAnswer(turn));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="turn-actions">
      <button type="button" className="turn-action" onClick={copy} title="Copiar a resposta com as fontes">
        <Icon name={copied ? "check" : "copy"} size={15} />{copied ? "Copiado" : "Copiar"}
      </button>
      <button type="button" className="turn-action" onClick={() => onEdit(turn.question)} title="Colocar a pergunta no campo para ajustar">
        <Icon name="edit" size={15} />Editar pergunta
      </button>
      <button type="button" className="turn-action" onClick={() => onRetry(turn.question)} disabled={running} title="Fazer a mesma pergunta de novo">
        <Icon name="replay" size={15} />Perguntar de novo
      </button>
    </div>
  );
}

function SourceList({ turn, onOpen }: { turn: Turn; onOpen: (source: Source) => void }) {
  if (!turn.sources.length) return null;
  return (
    <details className="source-list">
      <summary><Icon name="right" size={14} className="source-list-chevron" />{turn.sources.length} {turn.sources.length === 1 ? "fonte usada" : "fontes usadas"}</summary>
      <ol>
        {turn.sources.map((source, index) => (
          <li key={source.id}>
            <button type="button" onClick={() => onOpen(source)}>
              <span className="source-n">{index + 1}</span>
              {source.kind === "aula" ? <Icon name="page" size={15} /> : <img src={faviconUrl(source.domain)} alt="" width="15" height="15" />}
              <span className="source-text">
                <strong>{source.kind === "aula" ? lectureLabel(source.document_id, source.page) : siteName(source.domain)}</strong>
                <small>{source.kind === "aula" ? source.quote : source.title}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}

function TurnAnswer({ turn, revealing, onRevealDone, onOpenSource, onShowTrace, onEdit, onRetry, running, active }: { turn: Turn; revealing: boolean; onRevealDone: (id: string) => void; onOpenSource: Props["onOpenSource"]; onShowTrace: Props["onShowTrace"]; onEdit: Props["onEdit"]; onRetry: Props["onRetry"]; running: boolean; active: boolean }) {
  const blocks = useMemo(() => turn.blocks.map((block) => ({ ...block, segments: segmentsOf(block.text), length: segmentsOf(block.text).reduce((sum, item) => sum + item.text.length, 0) })), [turn.blocks]);
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const [count, setCount] = useState(revealing ? 0 : total);
  const done = count >= total;

  useEffect(() => {
    if (!revealing) { setCount(total); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setCount(total); return; }
    setCount(0);
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(total, Math.floor((now - started) / 14));
      setCount(next);
      if (next < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [revealing, total]);

  useEffect(() => {
    if (revealing && done) onRevealDone(turn.id);
  }, [revealing, done, onRevealDone, turn.id]);

  const numbered = new Map(turn.sources.map((source, index) => [source.id, index + 1]));
  const lectureCount = turn.sources.filter((source) => source.kind === "aula").length;
  const webCount = turn.sources.length - lectureCount;
  const actions = turn.nodes.filter((node) => node.kind === "search" || node.kind === "read" || node.kind === "web").length;
  const stage = turn.sources.map((source) => (source.kind === "aula" ? stageForPage(source.document_id, source.page) : null)).find(Boolean) ?? null;
  let consumed = 0;

  return (
    <div className="answer" data-cursor={`answer-${turn.id}`}>
      {blocks.map((block, index) => {
        const start = consumed;
        consumed += block.length;
        const visible = Math.max(0, Math.min(block.length, count - start));
        if (visible === 0 && index > 0) return null;
        const complete = visible >= block.length;
        return (
          <p className="answer-block" key={index}>
            <RevealText segments={block.segments} count={visible} />
            {!complete && <span className="caret" aria-hidden="true" />}
            {complete && block.citation_ids.length > 0 && (
              <span className="answer-cites">
                {groupCitations(block.citation_ids, turn).map((group) => (
                  <SourceChip key={group.key} source={group.sources[0]} index={group.sources.map((item) => numbered.get(item.id)).filter(Boolean).join(", ")} onOpen={(item) => onOpenSource(item, turn)} />
                ))}
              </span>
            )}
          </p>
        );
      })}
      <AnimatePresence>
        {done && (
          <motion.footer className="answer-foot" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="answer-badges">
              {turn.mode === "local" && <span className="badge badge-warn">Modo local: trechos copiados, sem IA</span>}
              {turn.usedFallback && <span className="badge">Modelo reserva</span>}
              {turn.remembered?.map((fact) => <span key={fact} className="badge badge-memory" title="Guardado na memória do Aster, neste navegador">Guardei: {fact}</span>)}
              {!!turn.masked?.length && <span className="badge" title="Esses dados foram trocados por marcadores antes de a pergunta sair deste computador">{`Ocultei ${listPt(turn.masked)} antes de enviar`}</span>}
              {webCount > 0 && lectureCount === 0 && <span className="badge badge-web">Fora do material das aulas</span>}
              {webCount > 0 && lectureCount > 0 && <span className="badge badge-web">Aulas e web</span>}
            </div>
            {stage && (
              <Link className="lab-link" href={`/laboratorio?etapa=${stage.id}&q=${encodeURIComponent(turn.question)}`}>
                <Icon name="network" size={16} />
                <span><strong>Ver no Laboratório</strong> {stage.title}: como o Aster faz isso</span>
                <Icon name="right" size={16} />
              </Link>
            )}
            <SourceList turn={turn} onOpen={(item) => onOpenSource(item, turn)} />
            <TurnActions turn={turn} onEdit={onEdit} onRetry={onRetry} running={running} />
            {!turn.chat && (
              <p className="answer-meta">
                {actions} {actions === 1 ? "ação" : "ações"} em {(turn.elapsed / 1000).toFixed(1).replace(".", ",")} s{turn.model ? ` com ${turn.model}` : ""}
                {!active && <button type="button" className="link-button" onClick={() => onShowTrace(turn)}>Ver investigação</button>}
              </p>
            )}
          </motion.footer>
        )}
      </AnimatePresence>
      {revealing && !done && <button type="button" className="link-button skip" onClick={() => setCount(total)}>Mostrar tudo</button>}
    </div>
  );
}

export function Thread({ turns, revealId, holdId, onRevealDone, onOpenSource, onRetry, onShowTrace, onEdit, onClear, memory, onForget, running, activeTurnId }: Props) {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  // só acompanha o fim enquanto o aluno está lá embaixo; se ele subiu para ler, não puxamos de volta
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const last = turns[turns.length - 1];
  const lastState = last ? `${last.id}-${last.status}-${last.nodes.length}-${last.thinking}` : "";

  const onScroll = () => {
    const element = box.current;
    if (!element) return;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    pinned.current = atEnd;
    setAway(!atEnd);
  };

  const toEnd = () => {
    pinned.current = true;
    setAway(false);
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  };

  // pergunta nova sempre leva ao fim
  useEffect(() => { toEnd(); }, [turns.length]);

  useEffect(() => {
    if (pinned.current) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [lastState, revealId, holdId]);

  // a resposta sendo escrita cresce sem mudar o estado do turno; segue o crescimento enquanto preso ao fim
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (pinned.current) element.scrollTop = element.scrollHeight; });
    Array.from(element.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [turns.length]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  const answered = turns.filter((turn) => turn.status === "answered").length;

  return (
    <div className="thread-frame">
      <header className="chat-head">
        <span className="chat-head-title"><Icon name="chat" size={16} />Conversa</span>
        <span className="chat-head-meta">{turns.length} {turns.length === 1 ? "pergunta" : "perguntas"}{answered !== turns.length ? ` · ${answered} respondidas` : ""}</span>
        <button type="button" className={`chat-head-memory ${memory.length ? "has-facts" : ""}`} onClick={() => setMemoryOpen((value) => !value)} aria-expanded={memoryOpen} title="O que o Aster lembra de você">
          <Icon name="book" size={14} />Memória{memory.length > 0 && <b>{memory.length}</b>}
        </button>
        <button
          type="button"
          className={`chat-head-clear ${confirmClear ? "is-confirm" : ""}`}
          disabled={running}
          onClick={() => (confirmClear ? onClear() : setConfirmClear(true))}
          title={running ? "Espere a pesquisa terminar" : "Apagar a conversa e começar outra"}
        >
          <Icon name={confirmClear ? "check" : "plus"} size={15} />{confirmClear ? "Confirmar" : "Nova conversa"}
        </button>
      </header>
      <AnimatePresence>
        {memoryOpen && (
          <motion.div className="memory-panel" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <p className="memory-title">O que o Aster lembra de você</p>
            {memory.length ? (
              <>
                <ul>
                  {memory.map((fact, index) => (
                    <li key={fact}><span>{fact}</span><button type="button" onClick={() => onForget(index)} aria-label={`Esquecer: ${fact}`}><Icon name="close" size={13} /></button></li>
                  ))}
                </ul>
                <button type="button" className="link-button" onClick={() => onForget(null)}>Esquecer tudo</button>
              </>
            ) : (
              <p className="memory-empty">Nada ainda. Conte seu nome, seu curso ou como prefere estudar, e ele guarda para as próximas conversas. Fica só neste navegador.</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="thread" ref={box} onScroll={onScroll} aria-live="polite">
        {turns.map((turn) => {
          const revealing = turn.id === revealId;
          const pendingReveal = turn.status === "answered" && holdId === turn.id;
          const showAnswer = turn.status === "answered" && !pendingReveal;
          const mood = turn.status === "running" || pendingReveal ? "thinking" : revealing ? "writing" : turn.status === "answered" ? "success" : "idle";
          return (
            <div className={`turn ${turn.id === activeTurnId ? "is-active" : ""}`} key={turn.id}>
              <motion.div className="bubble-question" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", duration: 0.45, bounce: 0.15 }}>
                <p>{turn.question}</p>
                {turn.createdAt && <time dateTime={new Date(turn.createdAt).toISOString()}>{clock(turn.createdAt)}</time>}
              </motion.div>
              <motion.div className="bubble-aster" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.35 }}>
                <div className="bubble-aster-head">
                  <Mascot mood={turn.id === last?.id ? mood : turn.status === "answered" ? "success" : "idle"} size={30} />
                  <span>Aster</span>
                  {turn.status === "running" && !turn.light && <span className="bubble-step">passo {Math.max(1, turn.step)}</span>}
                </div>
                {(turn.status === "running" || pendingReveal) && (
                  <div className="live-line">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.p key={pendingReveal ? "selecionando" : liveLine(turn)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }} className="shimmer">
                        {pendingReveal ? "Marcando o trecho que sustenta a resposta" : turn.light ? "Digitando" : liveLine(turn)}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                )}
                {showAnswer && <TurnAnswer turn={turn} revealing={revealing} onRevealDone={onRevealDone} onOpenSource={onOpenSource} onShowTrace={onShowTrace} onEdit={onEdit} onRetry={onRetry} running={running} active={turn.id === activeTurnId} />}
                {(turn.status === "empty" || turn.status === "failed") && (
                  <div className={`answer-problem ${turn.status === "failed" ? "is-error" : ""}`}>
                    <p>{turn.message}</p>
                    <div className="answer-problem-actions">
                      <button type="button" className="ghost-button dark" onClick={() => onRetry(turn.question)} disabled={running}><Icon name="replay" size={15} />Tentar de novo</button>
                      <button type="button" className="ghost-button dark" onClick={() => onEdit(turn.question)}><Icon name="edit" size={15} />Editar pergunta</button>
                    </div>
                  </div>
                )}
              </motion.div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <AnimatePresence>
        {away && (
          <motion.button type="button" className="to-end" onClick={toEnd} initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.9 }} transition={{ duration: 0.2 }}>
            <Icon name="down" size={15} />{running ? "Acompanhar a pesquisa" : "Ir para o fim"}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
