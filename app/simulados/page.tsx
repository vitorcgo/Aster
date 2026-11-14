"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AsterCursor, type CursorState } from "@/components/AsterCursor";
import { Drawable } from "@/components/Drawable";
import { Icon } from "@/components/Icon";
import { Landscape } from "@/components/Landscape";
import { Mascot } from "@/components/Mascot";
import { TopBar } from "@/components/TopBar";
import { lectureLabel } from "@/lib/aster";
import { forgetDrawn, waitForDrawn } from "@/lib/draw";
import { QUESTIONS, type Question } from "@/lib/questions";

type Scope = "recentes" | "todas";
type Mode = "treino" | "prova";
type Phase = "setup" | "building" | "running" | "result";
type Slot = { n: number; document_id: string; subject: string; pages: number[]; format: string };
/** Questão do simulado: as escritas pela IA trazem um comentário por alternativa, como no gabarito da Prova 1. */
type Item = Pick<Question, "id" | "prompt" | "options" | "answer" | "source"> & { comments?: string[]; explanation?: string; format?: string; topic?: string; fromBank?: boolean };
type Options = { recentes: { id: string; subject: string }[]; todas: { id: string; subject: string }[]; ia: boolean; revisao?: number };

const KEYS = ["A", "B", "C", "D", "E"];
const ease = [0.23, 1, 0.32, 1] as const;
const BURST = ["+", "*", "·", "+", "*", ":", "+", "·", "*", "+", "·", "*"];

function shuffle<T>(list: T[]) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

const reviewHref = (item: Item) => `/?source=${item.source.document_id}&page=${item.source.page}&q=${encodeURIComponent(item.source.query)}`;
const lectureNumber = (id: string) => Number(id.replace(/\D/g, "")) || 0;
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function lectureList(ids: string[]) {
  const numbers = ids.map(lectureNumber).sort((a, b) => a - b);
  if (!numbers.length) return "";
  if (numbers.length > 4) return `Aulas ${numbers[0]} a ${numbers[numbers.length - 1]}`;
  return `Aulas ${numbers.slice(0, -1).join(", ")} e ${numbers[numbers.length - 1]}`;
}

export default function Simulados() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [scope, setScope] = useState<Scope>("recentes");
  const [mode, setMode] = useState<Mode>("treino");
  const [count, setCount] = useState(5);
  const [options, setOptions] = useState<Options | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [deck, setDeck] = useState<Item[]>([]);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [verified, setVerified] = useState(false);
  const [cursor, setCursor] = useState<CursorState>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const run = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const cursorKey = useRef(0);
  const checkingRef = useRef(false);
  checkingRef.current = checking;

  useEffect(() => {
    fetch("/api/simulado/opcoes").then((response) => (response.ok ? response.json() : null)).then((data) => data && setOptions(data)).catch(() => undefined);
    return () => { run.current++; abort.current?.abort(); };
  }, []);

  const lectureNumbers = useMemo(() => (options ? options.todas.map((item) => lectureNumber(item.id)) : Array.from({ length: 12 }, (_, position) => position + 1)), [options]);
  const recentNumbers = useMemo(() => (options ? options.recentes.map((item) => lectureNumber(item.id)) : [11, 12]), [options]);
  const recentLabel = useMemo(() => lectureList(recentNumbers.map((number) => `aula-${number}`)) || "Últimas aulas", [recentNumbers]);
  // mesma conta do servidor: no foco recente, cerca de um quarto das questões é revisão das aulas anteriores
  const reviewCount = scope === "recentes" ? Math.max(1, Math.round(count * (options?.revisao ?? 0.25))) : 0;
  const scopeIds = useMemo(() => (options ? options[scope].map((item) => item.id) : scope === "recentes" ? ["aula-11", "aula-12"] : []), [options, scope]);
  const point = useCallback((target: string, label: string, gesture: NonNullable<CursorState>["gesture"]) => setCursor({ target, label, gesture, key: ++cursorKey.current }), []);

  /** Questões do banco fixo, para completar quando a IA não escreve todas (ou não há chave). */
  const fromBank = useCallback((amount: number, used: Item[]): Item[] => {
    const inScope = QUESTIONS.filter((question) => !scopeIds.length || scopeIds.includes(question.source.document_id));
    const pool = inScope.length >= amount ? inScope : QUESTIONS;
    return shuffle(pool).filter((question) => !used.some((item) => item.id === question.id)).slice(0, amount).map((question) => ({ ...question, fromBank: true }));
  }, [scopeIds]);

  const begin = useCallback((items: Item[]) => {
    setDeck(items);
    setIndex(0);
    setAnswers({});
    setPicked(null);
    setChecked(false);
    setCursor(null);
    setPhase("running");
  }, []);

  const build = useCallback(async () => {
    const token = ++run.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const alive = () => token === run.current;
    forgetDrawn((target) => target.startsWith("sim-"));
    setSlots([]); setDeck([]); setReady(false); setNote(""); setModel(null); setCursor(null); setChecking(false); setVerified(false);
    setPhase("building");

    const written: Item[] = [];
    let planned: Slot[] = [];
    let failure = "";
    let finished = false;
    // enquanto a IA escreve, o cursor passa pelas páginas sorteadas de cada questão
    const browse = (async () => {
      let turn = 0;
      while (alive() && !finished) {
        const pending = planned.filter((slot) => !written[slot.n - 1]);
        if (pending.length && !written.length && !checkingRef.current) {
          const slot = pending[turn++ % pending.length];
          point(`ghost-${slot.n}`, `Lendo ${lectureLabel(slot.document_id)}, p. ${slot.pages[0]} a ${slot.pages[slot.pages.length - 1]}`, "read");
        }
        await pause(2400);
      }
    })();

    try {
      const response = await fetch("/api/simulado/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, count }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { detail?: { message?: string } } | null;
        throw new Error(body?.detail?.message || "Não consegui falar com a API do Aster.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const arrived: Item[] = [];
      let streamDone = false;
      // o Aster desenha cada questão no quadro assim que ela chega, sem esperar a prova inteira
      const stager = (async () => {
        let position = 0;
        while (alive()) {
          if (position >= arrived.length) {
            if (streamDone) break;
            await pause(150);
            continue;
          }
          written[position] = arrived[position];
          setDeck([...written]);
          await pause(60);
          const target = `sim-${position + 1}`;
          point(target, `Escrevendo a questão ${position + 1}`, "draw");
          await waitForDrawn(target, 2200);
          await pause(220);
          position++;
        }
      })();
      while (alive()) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const event = JSON.parse(part.slice(6)) as { type: string; data: Record<string, unknown> };
          if (event.type === "plan") { planned = event.data.items as Slot[]; setSlots(planned); }
          if (event.type === "question") arrived.push(event.data.question as Item);
          if (event.type === "failed") failure = String(event.data.message ?? "");
          if (event.type === "done") { setModel(String(event.data.model ?? "")); setVerified(!!event.data.verified); }
        }
      }
      streamDone = true;
      await stager;
      if (!alive()) return;
    } catch (problem) {
      if (controller.signal.aborted) return;
      failure = (problem as Error).message;
    }
    finished = true;
    await browse;
    if (!alive()) return;
    const missing = count - written.length;
    const complete = missing > 0 ? [...written, ...fromBank(missing, written)] : written;
    if (missing > 0) {
      for (let position = written.length; position < complete.length; position++) {
        if (!alive()) return;
        setDeck(complete.slice(0, position + 1));
        await pause(60);
        point(`sim-${position + 1}`, `Buscando a questão ${position + 1} no banco`, "draw");
        await waitForDrawn(`sim-${position + 1}`, 2200);
        await pause(200);
      }
      setNote(written.length ? `A IA escreveu ${written.length} de ${count}; completei com questões do banco conferido.` : (failure || "Sem IA agora: usei as questões do banco conferido."));
    }
    if (!alive()) return;
    setDeck(complete);
    setReady(true);
    point("start-exam", "Prova pronta", "click");
  }, [scope, count, fromBank, point]);

  const current = deck[index];
  const score = deck.filter((item) => answers[item.id] === item.answer).length;
  const streak = useMemo(() => {
    let total = 0;
    for (let position = index - (checked ? 0 : 1); position >= 0; position--) {
      const item = deck[position];
      if (!item || answers[item.id] !== item.answer) break;
      total++;
    }
    return total;
  }, [deck, answers, index, checked]);

  const confirm = useCallback(() => {
    if (!current || picked === null) return;
    setAnswers((list) => ({ ...list, [current.id]: picked }));
    if (mode === "treino" && !checked) { setChecked(true); return; }
    if (index + 1 >= deck.length) { setPhase("result"); return; }
    setIndex((value) => value + 1);
    setPicked(null);
    setChecked(false);
  }, [current, picked, mode, checked, index, deck.length]);

  useEffect(() => {
    if (phase !== "running") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
      // num botão ou link focado, o Enter já gera o clique; tratar aqui confirmaria duas vezes
      if (event.key === "Enter" && event.target instanceof HTMLElement && event.target.closest("button, a")) return;
      const key = event.key.toUpperCase();
      const position = KEYS.indexOf(key) >= 0 ? KEYS.indexOf(key) : ["1", "2", "3", "4", "5"].indexOf(key);
      if (position >= 0 && current && position < current.options.length && !checked) setPicked(position);
      if (event.key === "Enter" && picked !== null) { event.preventDefault(); confirm(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, current, checked, picked, confirm]);

  const leave = () => { run.current++; abort.current?.abort(); setCursor(null); setPhase("setup"); };
  const percent = deck.length ? score / deck.length : 0;
  const circumference = 2 * Math.PI * 62;
  const correctNow = checked && current && picked === current.answer;
  const mood = phase === "building" ? (ready ? "success" : "writing") : phase === "result" ? (percent >= 0.6 ? "success" : "idle") : phase === "running" ? (checked ? (correctNow ? "success" : "idle") : "thinking") : "idle";

  return (
    <div className="quiz">
      <Landscape dim={phase !== "setup"} />
      <TopBar current="/simulados" mood={mood} />
      <main className={`quiz-main ${phase === "building" ? "is-wide" : ""}`}>
        <AnimatePresence mode="wait">
          {phase === "setup" && (
            <motion.section key="setup" className="quiz-panel quiz-setup-panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.4, ease }}>
              <div className="setup-form">
                <header>
                  <h1>Uma prova nova a cada vez.</h1>
                  <p>O Aster lê os slides e escreve questões inéditas no formato da Prova 1, com o gabarito comentado.</p>
                </header>

                <fieldset className="quiz-field">
                  <legend><span className="setup-step">1</span>Quer que use todas as aulas ou só depois da primeira prova?</legend>
                  <div className="scope-cards">
                    {(["recentes", "todas"] as Scope[]).map((value) => (
                      <label key={value} className={`scope-card ${scope === value ? "is-on" : ""}`}>
                        <input type="radio" name="scope" value={value} checked={scope === value} onChange={() => setScope(value)} />
                        <span className="scope-check" aria-hidden="true"><Icon name="check" size={13} strokeWidth={3} /></span>
                        <strong>{value === "recentes" ? "Só depois da primeira prova" : "Todas as aulas"}</strong>
                        <small>{value === "recentes" ? `Foco nas ${recentLabel.toLowerCase()}, com um pouco de revisão` : "Da primeira à última, por igual"}</small>
                        <span className="lecture-dots" aria-hidden="true">
                          {lectureNumbers.map((number) => (
                            <i key={number} className={value === "todas" || recentNumbers.includes(number) ? "is-main" : "is-review"}>{number}</i>
                          ))}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="setup-row">
                  <fieldset className="quiz-field">
                    <legend><span className="setup-step">2</span>Quantas questões?</legend>
                    <div className="segmented">
                      {[3, 5, 8, 10].map((value) => (
                        <label key={value}>
                          <input type="radio" name="count" value={value} checked={count === value} onChange={() => setCount(value)} />
                          <span>{value}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="quiz-field">
                    <legend><span className="setup-step">3</span>Quando corrigir?</legend>
                    <div className="segmented">
                      <label><input type="radio" name="mode" checked={mode === "treino"} onChange={() => setMode("treino")} /><span>A cada questão</span></label>
                      <label><input type="radio" name="mode" checked={mode === "prova"} onChange={() => setMode("prova")} /><span>Só no final</span></label>
                    </div>
                  </fieldset>
                </div>
              </div>

              <aside className="setup-ticket" aria-label="Resumo da prova">
                <motion.div className="ticket-mascot" animate={{ y: [0, -6, 0] }} transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}><Mascot mood="idle" size={92} /></motion.div>
                <p className="ticket-kicker">Sua prova</p>
                <p className="ticket-count"><motion.b key={count} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.25 }}>{count}</motion.b> questões</p>
                <div className="ticket-split" role="img" aria-label={reviewCount ? `${count - reviewCount} das ${recentLabel.toLowerCase()} e ${reviewCount} de revisão` : `${count} questões de todas as aulas`}>
                  <motion.span className="is-main" animate={{ flexGrow: count - reviewCount }} transition={{ type: "spring", stiffness: 260, damping: 28 }} />
                  {reviewCount > 0 && <motion.span className="is-review" initial={{ flexGrow: 0 }} animate={{ flexGrow: reviewCount }} transition={{ type: "spring", stiffness: 260, damping: 28 }} />}
                </div>
                <ul className="ticket-legend">
                  <li><i className="is-main" /><b>{count - reviewCount}</b> {scope === "recentes" ? `das ${recentLabel.toLowerCase()}` : "de todas as aulas"}</li>
                  {reviewCount > 0 && <li><i className="is-review" /><b>{reviewCount}</b> de revisão das anteriores</li>}
                </ul>
                <ul className="ticket-facts">
                  <li><Icon name="check" size={14} strokeWidth={2.6} />5 alternativas, de A a E</li>
                  <li><Icon name="check" size={14} strokeWidth={2.6} />Afirmações, caso prático, asserção e razão</li>
                  <li><Icon name="check" size={14} strokeWidth={2.6} />Gabarito comentado e conferido</li>
                  <li><Icon name="check" size={14} strokeWidth={2.6} />Correção {mode === "treino" ? "a cada questão" : "só no final, como na prova"}</li>
                </ul>
                <button type="button" className="primary-button ticket-go" onClick={build}>Montar a prova<Icon name="right" size={18} /></button>
                <small className="quiz-hint">{options && !options.ia ? "Sem chave de IA: as questões virão do banco conferido." : "As questões aparecem conforme ficam prontas."}</small>
              </aside>
            </motion.section>
          )}

          {phase === "building" && (
            <motion.section key="building" className="quiz-panel quiz-build" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.4, ease }} aria-live="polite">
              <header className="build-head">
                <Mascot mood={ready ? "success" : "writing"} size={54} />
                <div>
                  <h2 data-cursor="build-title">{ready ? "Prova pronta." : deck.length ? "Escrevendo as questões" : checking ? "Conferindo o gabarito" : slots.length ? "Lendo os slides sorteados" : "Sorteando as páginas"}</h2>
                  <p>{ready ? `${deck.length} questões${model ? `, escritas com ${model}` : ""}${verified ? ". Gabarito conferido numa segunda leitura" : ""}.` : `${scope === "recentes" ? "Só depois da primeira prova" : "Todas as aulas"} · ${count} questões no formato da Prova 1`}</p>
                </div>
                <span className="build-count"><b>{deck.length}</b> de {count}</span>
              </header>
              <ol className="build-board">
                {(slots.length ? slots : Array.from({ length: count }, (_, position) => ({ n: position + 1 } as Slot))).map((slot) => {
                  const question = deck[slot.n - 1];
                  return (
                    <li key={slot.n} className="build-slot">
                      <div className={`build-ghost ${question ? "is-hidden" : ""}`} data-cursor={`ghost-${slot.n}`}>
                        <span className="build-n">{slot.n}</span>
                        {slot.document_id ? (
                          <>
                            <strong>{lectureLabel(slot.document_id)}</strong>
                            <small>{slot.format}</small>
                            <small>p. {slot.pages[0]} a {slot.pages[slot.pages.length - 1]}</small>
                          </>
                        ) : <small>Sorteando</small>}
                        <span className="build-lines" aria-hidden="true"><i /><i /><i /></span>
                      </div>
                      {question && (
                        <Drawable target={`sim-${slot.n}`} enabled className="build-card" radius={16}>
                          <span className="build-n is-done">{slot.n}</span>
                          <strong>{lectureLabel(question.source.document_id, question.source.page)}</strong>
                          <small>{question.fromBank ? "Banco conferido" : question.format}</small>
                          <p>{question.topic || question.prompt}</p>
                        </Drawable>
                      )}
                    </li>
                  );
                })}
              </ol>
              {note && <p className="build-note">{note}</p>}
              <div className="quiz-actions">
                <button type="button" className="primary-button" data-cursor="start-exam" onClick={() => begin(deck)} disabled={!ready}>Começar a prova<Icon name="right" size={18} /></button>
                <button type="button" className="secondary-button" onClick={leave}>Cancelar</button>
              </div>
            </motion.section>
          )}

          {phase === "running" && current && (
            <motion.section key={`q-${current.id}`} className="quiz-panel quiz-card" initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }} transition={{ duration: 0.32, ease }} aria-labelledby="quiz-question">
              <div className="quiz-progress">
                <span>Questão {index + 1} de {deck.length}</span>
                <ol className="quiz-dots" aria-hidden="true">
                  {deck.map((item, position) => {
                    const answered = answers[item.id] !== undefined && (position < index || (position === index && checked));
                    const tone = !answered ? "" : mode === "prova" ? "is-done" : answers[item.id] === item.answer ? "is-right" : "is-wrong";
                    return <li key={item.id} className={`${tone} ${position === index ? "is-now" : ""}`} />;
                  })}
                </ol>
                {mode === "treino" && streak >= 2 && <motion.span key={streak} className="quiz-streak" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>{streak} seguidas</motion.span>}
                <span className="quiz-level">{current.fromBank ? "Banco conferido" : current.format} · {lectureLabel(current.source.document_id)}</span>
              </div>
              <div className="quiz-ask">
                <h2 className="quiz-question" id="quiz-question">{current.prompt}</h2>
                <div className="quiz-buddy">
                  <motion.div key={`${current.id}-${checked}`} initial={{ scale: 0.8, rotate: -6 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 380, damping: 14 }}>
                    <Mascot mood={checked ? (correctNow ? "success" : "idle") : picked !== null ? "writing" : "thinking"} size={84} />
                  </motion.div>
                  {correctNow && (
                    <span className="quiz-burst" aria-hidden="true">
                      {BURST.map((glyph, position) => {
                        const angle = (position / BURST.length) * Math.PI * 2;
                        return <motion.i key={position} initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }} animate={{ x: Math.cos(angle) * 74, y: Math.sin(angle) * 74, opacity: 0, scale: 1.3 }} transition={{ duration: 0.8, ease, delay: position * 0.012 }}>{glyph}</motion.i>;
                      })}
                    </span>
                  )}
                  <small>{checked ? (correctNow ? "Isso mesmo!" : "Quase. Veja o comentário.") : picked !== null ? "Confirma?" : "Leia com calma"}</small>
                </div>
              </div>
              <div className="quiz-options" role="radiogroup" aria-labelledby="quiz-question">
                {current.options.map((option, position) => {
                  const right = checked && position === current.answer;
                  const wrong = checked && position === picked && position !== current.answer;
                  const comment = checked ? current.comments?.[position] : "";
                  return (
                    <motion.button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={picked === position}
                      className={`quiz-option ${picked === position && !checked ? "is-picked" : ""} ${right ? "is-right" : ""} ${wrong ? "is-wrong" : ""} ${checked && !right && !wrong ? "is-dim" : ""}`}
                      onClick={() => !checked && setPicked(position)}
                      disabled={checked}
                      initial={{ opacity: 0, y: 10 }}
                      animate={wrong ? { opacity: 1, y: 0, x: [0, -7, 6, -4, 2, 0] } : { opacity: 1, y: 0, x: 0 }}
                      transition={{ delay: checked ? 0 : 0.08 + position * 0.05, duration: 0.3, ease }}
                      whileTap={checked ? undefined : { scale: 0.985 }}
                    >
                      <span className="quiz-key">{KEYS[position]}</span>
                      <span className="quiz-option-text">
                        {option}
                        {comment && <motion.small initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.3, delay: 0.1 + position * 0.04 }}>{comment}</motion.small>}
                      </span>
                      {right && <span className="quiz-verdict">Correta</span>}
                      {wrong && <span className="quiz-verdict">Sua resposta</span>}
                    </motion.button>
                  );
                })}
              </div>
              <AnimatePresence>
                {checked && (
                  <motion.div className="quiz-explain" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                    <p><strong>{correctNow ? "Isso mesmo." : "Não foi dessa vez."}</strong> {current.explanation ?? `A correta é a ${KEYS[current.answer]}. O comentário de cada alternativa está logo abaixo dela.`}</p>
                    <div className="quiz-actions">
                      <Link className="secondary-button" href={reviewHref(current)}><Icon name="page" size={16} />Ver na {lectureLabel(current.source.document_id, current.source.page)}</Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="quiz-actions">
                <button type="button" className="primary-button" onClick={confirm} disabled={picked === null}>
                  {mode === "treino" && !checked ? "Confirmar" : index + 1 >= deck.length ? "Ver resultado" : "Próxima"}
                </button>
                <button type="button" className="secondary-button" onClick={leave}>Sair</button>
                <small className="quiz-hint">Teclas A a E escolhem, Enter confirma</small>
              </div>
            </motion.section>
          )}

          {phase === "result" && (
            <motion.div key="result" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease }} className="quiz-panel">
              <section className="quiz-result" aria-labelledby="result-title">
                <div className="score-ring" role="img" aria-label={`${score} de ${deck.length} acertos`}>
                  <svg viewBox="0 0 150 150" aria-hidden="true">
                    <circle className="track-ring" cx="75" cy="75" r="62" />
                    <motion.circle className="value-ring" cx="75" cy="75" r="62" strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: circumference * (1 - percent) }} transition={{ duration: 1.1, ease, delay: 0.2 }} />
                  </svg>
                  <strong>{score}/{deck.length}<small>acertos</small></strong>
                </div>
                <div>
                  <h2 id="result-title">{percent >= 0.8 ? "Mandou muito bem." : percent >= 0.5 ? "Bom caminho, falta pouco." : "Vale revisar com calma."}</h2>
                  <p>{deck.length - score ? `Revise ${deck.length - score === 1 ? "a questão marcada" : "as questões marcadas"} abrindo a página da aula, ou pergunte ao Aster.` : "Você acertou todas. A próxima prova será diferente desta."}</p>
                  <div className="quiz-actions" style={{ marginTop: 16 }}>
                    <button type="button" className="primary-button" onClick={build}><Icon name="replay" size={17} />Outra prova, diferente</button>
                    <button type="button" className="secondary-button" onClick={leave}>Mudar opções</button>
                  </div>
                </div>
                <motion.div initial={{ scale: 0.5, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 12, delay: 0.3 }}><Mascot mood={percent >= 0.6 ? "success" : "idle"} size={110} /></motion.div>
              </section>
              <ol className="review-list">
                {deck.map((item, position) => {
                  const ok = answers[item.id] === item.answer;
                  return (
                    <motion.li key={item.id} className="review-item" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + position * 0.06, duration: 0.3, ease }}>
                      <span className={`review-mark ${ok ? "ok" : "no"}`}><Icon name={ok ? "check" : "close"} size={16} strokeWidth={2.6} /></span>
                      <div>
                        <p>{item.topic || item.prompt}</p>
                        <small>Resposta: {KEYS[item.answer]}. {item.options[item.answer]}</small>
                        {!ok && item.comments?.[answers[item.id]] && <small className="review-why">Você marcou {KEYS[answers[item.id]]}: {item.comments[answers[item.id]]}</small>}
                      </div>
                      <Link className="secondary-button" href={reviewHref(item)}><Icon name="page" size={16} />{lectureLabel(item.source.document_id, item.source.page)}</Link>
                    </motion.li>
                  );
                })}
              </ol>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <AsterCursor state={phase === "building" ? cursor : null} />
    </div>
  );
}
