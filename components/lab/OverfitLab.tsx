"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";

type Point = { x: number; y: number };

function rng(seed: number) {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

const truth = (x: number) => Math.sin(Math.PI * x) * 0.8;

function makePoints(seed: number, count: number): Point[] {
  const random = rng(seed);
  return Array.from({ length: count }, (_, index) => {
    const x = -1 + (2 * (index + 0.5 + (random() - 0.5) * 0.6)) / count;
    return { x, y: truth(x) + (random() - 0.5) * 0.45 };
  });
}

/** Mínimos quadrados para um polinômio do grau pedido (eliminação de Gauss). */
function fit(points: Point[], degree: number): number[] {
  const n = degree + 1;
  const matrix = Array.from({ length: n }, () => Array(n + 1).fill(0));
  for (const point of points) {
    const powers = Array.from({ length: 2 * n }, (_, k) => point.x ** k);
    for (let row = 0; row < n; row++) {
      for (let column = 0; column < n; column++) matrix[row][column] += powers[row + column];
      matrix[row][n] += point.y * powers[row];
    }
  }
  for (let row = 0; row < n; row++) matrix[row][row] += 1e-9;
  for (let pivot = 0; pivot < n; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row++) if (Math.abs(matrix[row][pivot]) > Math.abs(matrix[best][pivot])) best = row;
    [matrix[pivot], matrix[best]] = [matrix[best], matrix[pivot]];
    for (let row = 0; row < n; row++) {
      if (row === pivot) continue;
      const factor = matrix[row][pivot] / matrix[pivot][pivot];
      for (let column = pivot; column <= n; column++) matrix[row][column] -= factor * matrix[pivot][column];
    }
  }
  return matrix.map((row, index) => row[n] / row[index]);
}

const evaluate = (coefficients: number[], x: number) => coefficients.reduce((sum, value, power) => sum + value * x ** power, 0);
const mse = (coefficients: number[], points: Point[]) => points.reduce((sum, point) => sum + (evaluate(coefficients, point.x) - point.y) ** 2, 0) / points.length;

const W = 520;
const H = 300;
const sx = (x: number) => ((x + 1) / 2) * (W - 40) + 20;
const sy = (y: number) => H / 2 - y * (H / 2 - 20);

export function OverfitLab() {
  const [degree, setDegree] = useState(3);
  const train = useMemo(() => makePoints(11, 12), []);
  const validation = useMemo(() => makePoints(97, 12), []);
  const table = useMemo(() => Array.from({ length: 11 }, (_, index) => {
    const coefficients = fit(train, index + 1);
    return { degree: index + 1, coefficients, train: mse(coefficients, train), validation: mse(coefficients, validation) };
  }), [train, validation]);
  const current = table[degree - 1];
  const curve = Array.from({ length: 160 }, (_, index) => {
    const x = -1 + (2 * index) / 159;
    const y = Math.max(-1.6, Math.min(1.6, evaluate(current.coefficients, x)));
    return `${index ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
  }).join(" ");
  const best = table.reduce((p, q) => (q.validation < p.validation ? q : p));
  const verdict = degree <= 2 ? { label: "Underfitting", text: "O modelo é simples demais e erra até no treino.", tone: "is-warn" } : current.validation > best.validation * 2.2 ? { label: "Overfitting", text: "O erro no treino quase zera, mas na validação dispara: o modelo decorou o ruído.", tone: "is-bad" } : { label: "Bom ajuste", text: "O modelo captura o padrão sem decorar o ruído.", tone: "is-good" };
  const maxError = Math.max(...table.map((row) => Math.min(row.validation, 0.6)), 0.1);
  const errorPath = (key: "train" | "validation") => table.map((row, index) => `${index ? "L" : "M"}${10 + index * 22},${86 - (Math.min(row[key], 0.6) / maxError) * 76}`).join(" ");

  return (
    <div className="lab-demo overfit">
      <div className="overfit-controls">
        <label className="lab-field range">
          <span>Complexidade do modelo: polinômio de grau <strong>{degree}</strong></span>
          <input type="range" min={1} max={11} value={degree} onChange={(event) => setDegree(Number(event.target.value))} />
        </label>
        <motion.div key={verdict.label} className={`lab-insight ${verdict.tone}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <strong>{verdict.label}.</strong> {verdict.text}
        </motion.div>
        <dl className="neural-stats">
          <div><dt>Erro no treino</dt><dd>{current.train.toFixed(3).replace(".", ",")}</dd></div>
          <div><dt>Erro na validação</dt><dd>{current.validation.toFixed(3).replace(".", ",")}</dd></div>
        </dl>
        <figure className="error-figure">
          <figcaption>Erro por grau do modelo</figcaption>
          <svg viewBox="0 0 240 96" aria-label="Erro de treino e de validação por grau">
            <path d={errorPath("train")} className="err-train" />
            <path d={errorPath("validation")} className="err-val" />
            <line x1={10 + (degree - 1) * 22} x2={10 + (degree - 1) * 22} y1="4" y2="90" className="err-marker" />
          </svg>
          <p className="err-legend"><span className="key-train">treino</span><span className="key-val">validação</span></p>
        </figure>
      </div>
      <svg className="overfit-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Ajuste de grau ${degree} aos pontos`}>
        <path d={Array.from({ length: 120 }, (_, index) => { const x = -1 + (2 * index) / 119; return `${index ? "L" : "M"}${sx(x)},${sy(truth(x))}`; }).join(" ")} className="truth-line" />
        <motion.path d={curve} className="fit-line" animate={{ d: curve }} transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }} />
        {validation.map((point, index) => <circle key={`v-${index}`} cx={sx(point.x)} cy={sy(point.y)} r="5" className="pt-val" />)}
        {train.map((point, index) => <circle key={`t-${index}`} cx={sx(point.x)} cy={sy(point.y)} r="5" className="pt-train" />)}
      </svg>
    </div>
  );
}
