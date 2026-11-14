"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { Landscape } from "@/components/Landscape";
import { Mascot } from "@/components/Mascot";
import { TopBar } from "@/components/TopBar";
import { lectureLabel } from "@/lib/aster";
import { LEVEL_LABEL, QUESTIONS, type Level, type Question } from "@/lib/questions";

type Choice = Level | "misto";
type Mode = "treino" | "prova";
type Phase = "setup" | "running" | "result";

const KEYS = ["A", "B", "C", "D"];

function shuffle<T>(list: T[]) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function reviewHref(question: Question) {
  return `/?source=${question.source.document_id}&page=${question.source.page}&q=${encodeURIComponent(question.source.query)}`;
}

export default function Simulados() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [level, setLevel] = useState<Choice>("misto");
  const [mode, setMode] = useState<Mode>("treino");
  const [count, setCount] = useState(5);
  const [deck, setDeck] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);

  const pool = useMemo(() => (level === "misto" ? QUESTIONS : QUESTIONS.filter((question) => question.level === level)), [level]);
  const counts = useMemo(() => [3, 5, 8, 12].filter((value) => value <= pool.length), [pool.length]);
  useEffect(() => { if (!counts.includes(count)) setCount(counts[counts.length - 1] ?? 3); }, [counts, count]);

  const start = () => {
    const chosen = level === "misto"
      ? shuffle(QUESTIONS).slice(0, count).sort((a, b) => ["facil", "medio", "dificil"].indexOf(a.level) - ["facil", "medio", "dificil"].indexOf(b.level))
      : shuffle(pool).slice(0, count);
    setDeck(chosen);
    setIndex(0);
    setAnswers({});
    setPicked(null);
    setChecked(false);
    setPhase("running");
  };

  const current = deck[index];
  const score = deck.filter((question) => answers[question.id] === question.answer).length;

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
      const position = KEYS.indexOf(key) >= 0 ? KEYS.indexOf(key) : ["1", "2", "3", "4"].indexOf(key);
      if (position >= 0 && current && position < current.options.length && !checked) setPicked(position);
      if (event.key === "Enter" && picked !== null) { event.preventDefault(); confirm(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, current, checked, picked, confirm]);

  const percent = deck.length ? score / deck.length : 0;
  const circumference = 2 * Math.PI * 62;

  return (
    <div className="quiz">
      <Landscape dim={phase !== "setup"} />
      <TopBar current="/simulados" mood={phase === "result" ? (percent >= 0.6 ? "success" : "idle") : phase === "running" ? "thinking" : "idle"} />
      <main className="quiz-main">
        <AnimatePresence mode="wait">
          {phase === "setup" && (
            <motion.section key="setup" className="quiz-panel quiz-intro" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}>
              <div>
                <h1>Treine para a prova com as próprias aulas.</h1>
                <p>Cada gabarito aponta a página que sustenta a resposta. Errou? Um clique leva você ao trecho certo.</p>
                <div className="quiz-setup">
                  <fieldset className="quiz-field">
                    <legend>Dificuldade</legend>
                    <div className="segmented">
                      {(["misto", "facil", "medio", "dificil"] as Choice[]).map((value) => (
                        <label key={value}>
                          <input type="radio" name="level" value={value} checked={level === value} onChange={() => setLevel(value)} />
                          <span>{value !== "misto" && <i className={`level-dot level-${value}`} aria-hidden="true" />}{value === "misto" ? "Misturado" : LEVEL_LABEL[value]}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="quiz-field">
                    <legend>Questões</legend>
                    <div className="segmented">
                      {counts.map((value) => (
                        <label key={value}>
                          <input type="radio" name="count" value={value} checked={count === value} onChange={() => setCount(value)} />
                          <span>{value}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="quiz-field">
                    <legend>Correção</legend>
                    <div className="segmented">
                      <label><input type="radio" name="mode" checked={mode === "treino"} onChange={() => setMode("treino")} /><span>A cada questão</span></label>
                      <label><input type="radio" name="mode" checked={mode === "prova"} onChange={() => setMode("prova")} /><span>Só no final, como na prova</span></label>
                    </div>
                  </fieldset>
                  <div><button type="button" className="primary-button" onClick={start}>Começar simulado<Icon name="right" size={18} /></button></div>
                </div>
              </div>
              <Mascot mood="idle" size={150} />
            </motion.section>
          )}

          {phase === "running" && current && (
            <motion.section key={`q-${current.id}`} className="quiz-panel quiz-card" initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }} transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }} aria-labelledby="quiz-question">
              <div className="quiz-progress">
                <span>Questão {index + 1} de {deck.length}</span>
                <span className="quiz-bar"><span style={{ transform: `scaleX(${(index + (checked ? 1 : 0)) / deck.length})` }} /></span>
                <span className="quiz-level"><i className={`level-dot level-${current.level}`} aria-hidden="true" />{LEVEL_LABEL[current.level]}</span>
              </div>
              <h2 className="quiz-question" id="quiz-question">{current.prompt}</h2>
              <div className="quiz-options" role="radiogroup" aria-labelledby="quiz-question">
                {current.options.map((option, position) => {
                  const right = checked && position === current.answer;
                  const wrong = checked && position === picked && position !== current.answer;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={picked === position}
                      className={`quiz-option ${picked === position && !checked ? "is-picked" : ""} ${right ? "is-right" : ""} ${wrong ? "is-wrong" : ""}`}
                      onClick={() => !checked && setPicked(position)}
                      disabled={checked}
                    >
                      <span className="quiz-key">{KEYS[position]}</span>
                      <span>{option}</span>
                      {right && <span className="quiz-verdict">Correta</span>}
                      {wrong && <span className="quiz-verdict">Sua resposta</span>}
                    </button>
                  );
                })}
              </div>
              <AnimatePresence>
                {checked && (
                  <motion.div className="quiz-explain" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                    <p><strong>{picked === current.answer ? "Isso mesmo." : "Não foi dessa vez."}</strong> {current.explanation}</p>
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
                <button type="button" className="secondary-button" onClick={() => setPhase("setup")}>Sair</button>
              </div>
            </motion.section>
          )}

          {phase === "result" && (
            <motion.div key="result" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }} className="quiz-panel">
              <section className="quiz-result" aria-labelledby="result-title">
                <div className="score-ring" role="img" aria-label={`${score} de ${deck.length} acertos`}>
                  <svg viewBox="0 0 150 150" aria-hidden="true">
                    <circle className="track-ring" cx="75" cy="75" r="62" />
                    <motion.circle className="value-ring" cx="75" cy="75" r="62" strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: circumference * (1 - percent) }} transition={{ duration: 1.1, ease: [0.23, 1, 0.32, 1], delay: 0.2 }} />
                  </svg>
                  <strong>{score}/{deck.length}<small>acertos</small></strong>
                </div>
                <div>
                  <h2 id="result-title">{percent >= 0.8 ? "Mandou muito bem." : percent >= 0.5 ? "Bom caminho, falta pouco." : "Vale revisar com calma."}</h2>
                  <p>{deck.length - score ? `Revise ${deck.length - score === 1 ? "a questão marcada" : "as questões marcadas"} abrindo a página da aula, ou pergunte ao Aster.` : "Você acertou todas. Que tal subir a dificuldade?"}</p>
                  <div className="quiz-actions" style={{ marginTop: 16 }}>
                    <button type="button" className="primary-button" onClick={start}><Icon name="replay" size={17} />Novo simulado</button>
                    <button type="button" className="secondary-button" onClick={() => setPhase("setup")}>Mudar opções</button>
                  </div>
                </div>
              </section>
              <ol className="review-list">
                {deck.map((question) => {
                  const ok = answers[question.id] === question.answer;
                  return (
                    <li key={question.id} className="review-item">
                      <span className={`review-mark ${ok ? "ok" : "no"}`}><Icon name={ok ? "check" : "close"} size={16} strokeWidth={2.6} /></span>
                      <div>
                        <p>{question.prompt}</p>
                        <small>Resposta: {question.options[question.answer]}</small>
                      </div>
                      <Link className="secondary-button" href={reviewHref(question)}><Icon name="page" size={16} />{lectureLabel(question.source.document_id, question.source.page)}</Link>
                    </li>
                  );
                })}
              </ol>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
