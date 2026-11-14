"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

// Coordenadas ilustrativas em 2 dimensões. Modelos reais usam centenas ou milhares (Aula 6, p. 25).
const WORDS: Record<string, { x: number; y: number; group: string }> = {
  homem: { x: -0.55, y: -0.35, group: "pessoas" },
  mulher: { x: -0.15, y: -0.38, group: "pessoas" },
  menino: { x: -0.62, y: -0.72, group: "pessoas" },
  menina: { x: -0.22, y: -0.75, group: "pessoas" },
  rei: { x: -0.5, y: 0.45, group: "realeza" },
  rainha: { x: -0.1, y: 0.42, group: "realeza" },
  "príncipe": { x: -0.57, y: 0.08, group: "realeza" },
  princesa: { x: -0.17, y: 0.05, group: "realeza" },
  gato: { x: 0.45, y: 0.55, group: "animais" },
  cachorro: { x: 0.6, y: 0.48, group: "animais" },
  cavalo: { x: 0.72, y: 0.66, group: "animais" },
  "maçã": { x: 0.5, y: -0.45, group: "frutas" },
  banana: { x: 0.68, y: -0.55, group: "frutas" },
  uva: { x: 0.55, y: -0.7, group: "frutas" },
};

const PRESETS = [
  { a: "rei", b: "homem", c: "mulher" },
  { a: "menino", b: "homem", c: "mulher" },
  { a: "princesa", b: "mulher", c: "homem" },
];

const SIZE = 440;
const toX = (x: number) => ((x + 1) / 2) * (SIZE - 60) + 30;
const toY = (y: number) => ((1 - y) / 2) * (SIZE - 60) + 30;


export function EmbeddingLab() {
  const [preset, setPreset] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const { a, b, c } = PRESETS[preset];
  const A = WORDS[a];
  const B = WORDS[b];
  const C = WORDS[c];
  const result = { x: A.x - B.x + C.x, y: A.y - B.y + C.y };
  const ranking = useMemo(() => Object.entries(WORDS)
    .filter(([word]) => ![a, b, c].includes(word))
    .map(([word, point]) => ({ word, distance: Math.hypot(point.x - result.x, point.y - result.y) }))
    .sort((p, q) => p.distance - q.distance)
    .slice(0, 3), [a, b, c, result.x, result.y]);
  const winner = ranking[0]?.word;

  return (
    <div className="lab-demo embed">
      <div className="embed-controls">
        <p className="embed-equation" aria-live="polite">
          <span className="word">{a}</span> − <span className="word">{b}</span> + <span className="word">{c}</span> ≈ <motion.span key={`${preset}-${run}`} className="word is-result" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 2.1, type: "spring", bounce: 0.4 }}>{winner}</motion.span>
        </p>
        <div className="lab-segment wrap">
          {PRESETS.map((item, index) => <button key={index} type="button" aria-pressed={preset === index} onClick={() => { setPreset(index); setRun((value) => value + 1); }}>{item.a} − {item.b} + {item.c}</button>)}
        </div>
        <button type="button" className="secondary-button" onClick={() => setRun((value) => value + 1)}>Animar de novo</button>
        <ol className="embed-ranking">
          {ranking.map((item, index) => (
            <li key={item.word} className={index === 0 ? "is-top" : ""}>
              <span>{item.word}</span>
              <span className="embed-bar"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.05, 1 - item.distance / 1.2) }} transition={{ delay: 2 + index * 0.1, duration: 0.5 }} /></span>
              <code>{item.distance.toFixed(2).replace(".", ",")}</code>
            </li>
          ))}
        </ol>
        <p className="lab-note">Distância até o ponto calculado: quanto menor, mais parecido o significado. Mapa ilustrativo em 2 dimensões; o modelo citado na aula gera 1536.</p>
      </div>

      <svg className="embed-map" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Mapa de palavras no espaço vetorial">
        <defs>
          <marker id="arrow-lime" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--lime)" /></marker>
          <marker id="arrow-roof" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--roof)" /></marker>
        </defs>
        <line x1={toX(-1)} y1={toY(0)} x2={toX(1)} y2={toY(0)} className="embed-axis" />
        <line x1={toX(0)} y1={toY(-1)} x2={toX(0)} y2={toY(1)} className="embed-axis" />
        <AnimatePresence>
          <motion.g key={`${preset}-${run}`}>
            <motion.line x1={toX(B.x)} y1={toY(B.y)} x2={toX(A.x)} y2={toY(A.y)} className="embed-vector" markerEnd="url(#arrow-lime)" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.8, delay: 0.2 }} />
            <motion.line x1={toX(C.x)} y1={toY(C.y)} x2={toX(result.x)} y2={toY(result.y)} className="embed-vector is-moved" markerEnd="url(#arrow-roof)" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.8, delay: 1.1 }} />
            <motion.circle cx={toX(result.x)} cy={toY(result.y)} r="16" className="embed-target" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 1.9, type: "spring", bounce: 0.4 }} />
          </motion.g>
        </AnimatePresence>
        {Object.entries(WORDS).map(([word, point]) => {
          const role = word === a || word === b || word === c ? "is-input" : word === winner ? "is-winner" : "";
          return (
            <g key={word} className={`embed-word group-${point.group} ${role}`} onPointerEnter={() => setHover(word)} onPointerLeave={() => setHover(null)}>
              <circle cx={toX(point.x)} cy={toY(point.y)} r={role ? 7 : 5} />
              <text x={toX(point.x) + 10} y={toY(point.y) + 4}>{word}</text>
              {hover === word && <text x={toX(point.x) + 10} y={toY(point.y) + 20} className="embed-coords">[{point.x.toFixed(2)}, {point.y.toFixed(2)}]</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
