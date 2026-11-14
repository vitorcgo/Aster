"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { lectureLabel } from "@/lib/aster";
import { labPost } from "@/lib/lab";
import { aiPayload } from "@/lib/ai";

type Point = { id: string; document_id: string; page: number; quote: string; heading: string; lexical_rank: number; semantic_rank: number; cosine: number; x: number; y: number };
type Result = { model: string; dimensions: number; question: { x: number; y: number }; candidates: Point[] };

const SIZE = 420;
const sx = (x: number) => SIZE / 2 + x * (SIZE / 2 - 34);
const sy = (y: number) => SIZE / 2 - y * (SIZE / 2 - 34);

export function StageEmbeddings({ question, deep = false }: { question: string; deep?: boolean }) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => { setResult(null); setError(""); }, [question]);

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      setResult(await labPost<Result>("/api/lab/embeddings", { q: question, ai: aiPayload() }));
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!result) {
    return (
      <div className="embed-start">
        {deep ? (
          <>
            <p>O Aster busca por palavras. Aqui a pergunta e os {15} melhores candidatos da busca viram vetores com o modelo de embeddings do Gemini, e a similaridade de cosseno reordena tudo pelo significado.</p>
            <p className="lab-note">Faz uma chamada à API de embeddings do Gemini, com a sua chave.</p>
          </>
        ) : (
          <p>A IA transforma a pergunta e os melhores pedacinhos em pontos num mapa. Quanto mais perto da sua pergunta, mais parecido é o sentido.</p>
        )}
        <button type="button" className="primary-button" onClick={run} disabled={loading}><Icon name="network" size={17} />{loading ? "Montando o mapa" : deep ? "Calcular embeddings" : "Montar o mapa"}</button>
        {error && <p className="sheet-error">{error}</p>}
      </div>
    );
  }

  const sorted = [...result.candidates].sort((a, b) => a.semantic_rank - b.semantic_rank);
  const best = sorted.slice(0, 3).map((item) => item.id);
  const maxCos = Math.max(...result.candidates.map((item) => item.cosine));
  const minCos = Math.min(...result.candidates.map((item) => item.cosine));

  return (
    <div className="embed-real">
      <figure className="lab-card">
        <figcaption>{deep ? `${result.dimensions.toLocaleString("pt-BR")} dimensões (${result.model}) projetadas em 2D. A estrela é a sua pergunta.` : "A estrela é a sua pergunta. Os pontos mais perto dela são os pedacinhos com o sentido mais parecido."}</figcaption>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="embed-map" role="img" aria-label="Mapa dos vetores da pergunta e dos trechos">
          {result.candidates.filter((item) => best.includes(item.id)).map((item, index) => (
            <motion.line key={`l-${item.id}`} x1={sx(result.question.x)} y1={sy(result.question.y)} x2={sx(item.x)} y2={sy(item.y)} className="embed-link" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.5 + index * 0.2, duration: 0.6 }} />
          ))}
          {result.candidates.map((item, index) => {
            const strength = (item.cosine - minCos) / Math.max(0.0001, maxCos - minCos);
            return (
              <motion.g key={item.id} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * 0.04 }} onPointerEnter={() => setHover(item.id)} onPointerLeave={() => setHover(null)} className="embed-point">
                <circle cx={sx(item.x)} cy={sy(item.y)} r={6 + strength * 6} style={{ fillOpacity: 0.35 + strength * 0.6 }} className={best.includes(item.id) ? "is-best" : ""} />
                {(hover === item.id || best.includes(item.id)) && <text x={sx(item.x) + 12} y={sy(item.y) + 4}>{lectureLabel(item.document_id, item.page)}</text>}
              </motion.g>
            );
          })}
          <motion.path d={`M${sx(result.question.x)},${sy(result.question.y) - 11} l3.2,7 7.6,0.6 -5.8,5 1.8,7.4 -6.8,-4 -6.8,4 1.8,-7.4 -5.8,-5 7.6,-0.6z`} className="embed-question" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.5 }} />
        </svg>
      </figure>
      <div className="lab-card">
        <h3>{deep ? "Palavras × significado" : "Os mais parecidos com a pergunta"}</h3>
        {deep && <p className="lab-note">Ordem da busca lexical ao lado da ordem por similaridade de cosseno (1 = mesmo sentido).</p>}
        <ol className={`rank-compare ${deep ? "" : "is-simple"}`}>
          {sorted.slice(0, deep ? 8 : 4).map((item) => {
            const moved = item.lexical_rank - item.semantic_rank;
            return (
              <li key={item.id} className={hover === item.id ? "is-hover" : ""} onPointerEnter={() => setHover(item.id)} onPointerLeave={() => setHover(null)}>
                <span className="rank-n">{item.semantic_rank}</span>
                <span className="rank-body"><strong>{lectureLabel(item.document_id, item.page)}</strong> {item.heading}</span>
                {deep && <code>{item.cosine.toFixed(3).replace(".", ",")}</code>}
                <span className={`rank-move ${moved > 0 ? "up" : moved < 0 ? "down" : ""}`}>{moved > 0 ? `subiu ${moved}` : moved < 0 ? `desceu ${-moved}` : "igual"}</span>
              </li>
            );
          })}
        </ol>
        <button type="button" className="secondary-button" onClick={run} disabled={loading}><Icon name="replay" size={16} />Recalcular</button>
      </div>
    </div>
  );
}
