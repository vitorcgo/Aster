"use client";

import Link from "next/link";
import { animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { lectureLabel } from "@/lib/aster";
import { labGet } from "@/lib/lab";
import type { RQuery } from "./StageReranker";

type Lecture = { document_id: string; page: number };
type Evaluation = {
  metrics: Record<string, number>;
  results: { q: string; expected: Lecture; origin: string; rank: number | null; top: Lecture[] }[];
};
type Mode = "busca" | "rede";

const ease = [0.23, 1, 0.32, 1] as const;

function tone(rank: number | null) {
  if (!rank) return "is-miss";
  if (rank === 1) return "is-first";
  if (rank <= 3) return "is-top3";
  if (rank <= 6) return "is-top6";
  return "is-far";
}

function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const last = useRef(shown);
  useEffect(() => {
    if (reduced) { last.current = value; setShown(value); return; }
    // conta a partir do número que está na tela, para a troca busca/rede também animar
    const controls = animate(last.current, value, { duration: 0.9, ease, onUpdate: (latest) => { last.current = latest; setShown(Math.round(latest)); } });
    return () => controls.stop();
  }, [value, reduced]);
  return <>{shown}</>;
}

/** Anel que enche até a fração de perguntas que caíram dentro do critério. */
function Ring({ hits, total, title, hint, delay }: { hits: number; total: number; title: string; hint: string; delay: number }) {
  const radius = 52;
  const length = 2 * Math.PI * radius;
  const share = total ? hits / total : 0;
  return (
    <motion.figure className="eval-ring" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.5, ease }}>
      <svg viewBox="0 0 128 128" aria-hidden="true">
        <circle className="ring-track" cx="64" cy="64" r={radius} />
        <motion.circle
          className="ring-fill" cx="64" cy="64" r={radius}
          strokeDasharray={length}
          initial={{ strokeDashoffset: length }}
          animate={{ strokeDashoffset: length * (1 - share) }}
          transition={{ delay: delay + 0.15, duration: 1.1, ease }}
        />
      </svg>
      <div className="ring-center">
        <strong><CountUp value={hits} /></strong>
        <span>de {total}</span>
      </div>
      <figcaption><b>{title}</b><small>{hint}</small></figcaption>
    </motion.figure>
  );
}

export function StageEval({ neural, relevance, deep = false }: { neural: ((query: RQuery) => number | null) | null; relevance: RQuery[] | null; deep?: boolean }) {
  const [data, setData] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("busca");
  const [picked, setPicked] = useState(0);
  useEffect(() => { labGet<Evaluation>("/api/lab/evaluation").then(setData).catch((problem: Error) => setError(problem.message)); }, []);

  if (error) return <p className="sheet-error">{error}</p>;
  if (!data) return <p className="lab-note">Fazendo as 26 perguntas de teste para a busca do Aster.</p>;

  const neuralRanks = neural && relevance ? relevance.map((query) => neural(query)) : null;
  const useNetwork = mode === "rede" && !!neuralRanks;
  const ranks = data.results.map((item, index) => (useNetwork && neuralRanks ? neuralRanks[index] : item.rank));
  const total = ranks.length;
  const within = (k: number) => ranks.filter((rank) => rank !== null && rank <= k).length;
  const current = data.results[Math.min(picked, total - 1)];
  const currentRank = ranks[Math.min(picked, total - 1)];
  const m = data.metrics;

  return (
    <div className="stage-grid score">
      {deep && <p className="score-lead">
        Fizemos <b>{total} perguntas</b> em que já sabíamos a página certa da aula. Para cada uma, conferimos <b>em que posição</b> a busca colocou essa página.
      </p>}

      <div className="score-switch" role="radiogroup" aria-label="Quem ordena as páginas">
        <button type="button" role="radio" aria-checked={mode === "busca"} className={mode === "busca" ? "is-on" : ""} onClick={() => setMode("busca")}>Busca por palavras</button>
        <button type="button" role="radio" aria-checked={mode === "rede"} className={mode === "rede" ? "is-on" : ""} onClick={() => setMode("rede")} disabled={!neuralRanks} title={neuralRanks ? undefined : "Treine a rede na etapa anterior para comparar"}>
          Com a rede neural
        </button>
        {mode === "busca" && !neuralRanks && <small>Treine a rede na etapa anterior para comparar.</small>}
      </div>

      <div className="eval-rings">
        <Ring hits={within(1)} total={total} title="Acertou de primeira" hint="a página certa veio em 1º lugar" delay={0} />
        <Ring hits={within(3)} total={total} title="Entre as 3 primeiras" hint="o aluno acharia sem rolar" delay={0.1} />
        <Ring hits={within(6)} total={total} title="Entre as 6 que o Aster lê" hint="o agente recebe essas 6 páginas" delay={0.2} />
      </div>

      {deep && (
      <section className="score-board" aria-label="Placar pergunta por pergunta">
        <header>
          <h3>Placar, pergunta por pergunta</h3>
          <ul className="score-legend">
            <li><i className="is-first" />1º lugar</li>
            <li><i className="is-top3" />2º ou 3º</li>
            <li><i className="is-top6" />4º a 6º</li>
            <li><i className="is-miss" />não achou</li>
          </ul>
        </header>
        <ol className="score-tiles">
          {data.results.map((item, index) => {
            const rank = ranks[index];
            return (
              <motion.li key={item.q} layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 + index * 0.025, type: "spring", stiffness: 420, damping: 26 }}>
                <button type="button" className={`score-tile ${tone(rank)} ${index === picked ? "is-picked" : ""}`} onClick={() => setPicked(index)} aria-label={`Pergunta ${index + 1}: ${rank ? `${rank}º lugar` : "não achou"}`} title={item.q}>
                  <motion.span key={`${mode}-${rank}`} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.25 }}>{rank ? `${rank}º` : "–"}</motion.span>
                </button>
              </motion.li>
            );
          })}
        </ol>
        <motion.div key={`${picked}-${mode}`} className="score-detail" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <span className={`score-pill ${tone(currentRank)}`}>{currentRank ? `${currentRank}º lugar` : "não achou"}</span>
          <p>{current.q}<small>{current.origin === "simulado" ? "pergunta do simulado" : "conceito que o próprio Aster usa"}</small></p>
          <Link className="chip chip-aula" href={`/?source=${current.expected.document_id}&page=${current.expected.page}&q=${encodeURIComponent(current.q)}`}>
            Página certa: {lectureLabel(current.expected.document_id, current.expected.page)}
          </Link>
        </motion.div>
      </section>
      )}

      {deep && (
      <details className="score-terms">
        <summary>Os nomes técnicos destes números</summary>
        <div className="formula-card two">
          <div><span>Recall@k (Aula 2, p. 32)</span><code>VP ÷ (VP + FN)</code><p className="lab-note">É o que os anéis mostram: das perguntas, em quantas a página certa apareceu entre as k primeiras. Busca por palavras: @1 {Math.round(m["recall@1"] * 100)}%, @3 {Math.round(m["recall@3"] * 100)}%, @6 {Math.round(m["recall@6"] * 100)}%.</p></div>
          <div><span>Precisão@k (Aula 2, p. 31)</span><code>VP ÷ (VP + FP)</code><p className="lab-note">Das k páginas trazidas, quantas eram certas. Cai quando olhamos mais páginas, o trade-off da p. 33. @3: {Math.round(m["precision@3"] * 100)}%.</p></div>
        </div>
        <p className="lab-note">MRR {m.mrr.toFixed(2).replace(".", ",")}: a média de 1 ÷ posição. Vale 1 se tudo viesse em 1º lugar.</p>
      </details>
      )}
    </div>
  );
}
