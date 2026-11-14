"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { lectureLabel } from "@/lib/aster";
import { labGet } from "@/lib/lab";
import type { RQuery } from "./StageReranker";

type Evaluation = {
  metrics: Record<string, number>;
  results: { q: string; expected: { document_id: string; page: number }; origin: string; rank: number | null; top: { document_id: string; page: number }[] }[];
};

const pct = (value: number) => `${Math.round(value * 100)}%`;

function badge(rank: number | null) {
  if (!rank) return { text: "fora", tone: "is-bad" };
  if (rank === 1) return { text: "1º", tone: "is-good" };
  if (rank <= 3) return { text: `${rank}º`, tone: "is-mid" };
  return { text: `${rank}º`, tone: "is-low" };
}

export function StageEval({ neural, relevance }: { neural: ((query: RQuery) => number | null) | null; relevance: RQuery[] | null }) {
  const [data, setData] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { labGet<Evaluation>("/api/lab/evaluation").then(setData).catch((problem: Error) => setError(problem.message)); }, []);
  if (error) return <p className="sheet-error">{error}</p>;
  if (!data) return <p className="lab-note">Rodando a busca nas perguntas de avaliação.</p>;
  const m = data.metrics;
  const neuralRanks = neural && relevance ? relevance.map((query) => neural(query)) : null;
  const neuralRecall1 = neuralRanks ? neuralRanks.filter((rank) => rank === 1).length / neuralRanks.length : null;

  return (
    <div className="stage-grid">
      <div className="metric-row">
        {[
          { label: "Recall@1", value: m["recall@1"], note: "página certa em 1º" },
          { label: "Recall@3", value: m["recall@3"], note: "entre as 3 primeiras" },
          { label: "Recall@6", value: m["recall@6"], note: "entre as 6 que o agente vê" },
          { label: "Precisão@3", value: m["precision@3"], note: "das 3 páginas, quantas certas" },
          { label: "MRR", value: m.mrr, note: "média de 1 ÷ posição", raw: true },
        ].map((item, index) => (
          <motion.div key={item.label} className="metric" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}>
            <span>{item.label}</span>
            <strong>{item.raw ? item.value.toFixed(2).replace(".", ",") : pct(item.value)}</strong>
            <small>{item.note}</small>
          </motion.div>
        ))}
        {neuralRecall1 !== null && (
          <motion.div className="metric is-neural" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <span>Recall@1 com a rede</span>
            <strong>{pct(neuralRecall1)}</strong>
            <small>reranker treinado na etapa 5</small>
          </motion.div>
        )}
      </div>
      <div className="formula-card two">
        <div><span>Recall (Aula 2, p. 32)</span><code>VP ÷ (VP + FN)</code><p className="lab-note">Das páginas certas, quantas a busca trouxe. Aqui há uma página certa por pergunta.</p></div>
        <div><span>Precisão (Aula 2, p. 31)</span><code>VP ÷ (VP + FP)</code><p className="lab-note">Do que a busca trouxe, quanto estava certo. Cai quando olhamos mais páginas: o trade-off da p. 33.</p></div>
      </div>
      <p className="lab-note">{data.results.length} perguntas com a página esperada conferida: as 12 dos simulados e 14 sobre os conceitos que o próprio Aster usa.</p>
      <ol className="eval-list">
        {data.results.map((item, index) => {
          const lexical = badge(item.rank);
          const network = neuralRanks ? badge(neuralRanks[index]) : null;
          return (
            <li key={item.q}>
              <span className={`eval-badge ${lexical.tone}`} title="Posição da página certa na busca do Aster">{lexical.text}</span>
              {network && <span className={`eval-badge ${network.tone}`} title="Posição com o reranker neural">{network.text}</span>}
              <span className="eval-q">{item.q}<small>{item.origin === "simulado" ? "simulado" : "conceito do sistema"}</small></span>
              <Link className="chip chip-aula" href={`/?source=${item.expected.document_id}&page=${item.expected.page}&q=${encodeURIComponent(item.q)}`}>{lectureLabel(item.expected.document_id, item.expected.page)}</Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
