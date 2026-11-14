"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";

// Casinha 12×12, a mesma linguagem da paisagem do Aster. 1 = pixel aceso.
const HOUSE = [
  "000001100000",
  "000011110000",
  "000111111000",
  "001111111100",
  "011111111110",
  "111111111111",
  "011000000110",
  "011011100110",
  "011011100110",
  "011011100110",
  "011011100110",
  "011111111110",
].map((row) => row.split("").map(Number));

const KERNELS = {
  vertical: { label: "Borda vertical", values: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]] },
  horizontal: { label: "Borda horizontal", values: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]] },
  sharpen: { label: "Nitidez", values: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]] },
  blur: { label: "Desfoque", values: [[1, 1, 1], [1, 1, 1], [1, 1, 1]].map((row) => row.map((value) => value / 9)) },
} as const;
type KernelId = keyof typeof KERNELS;

function convolve(image: number[][], kernel: readonly (readonly number[])[], stride: number, same: boolean) {
  const pad = same ? 1 : 0;
  const size = image.length + pad * 2;
  const padded = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => image[row - pad]?.[column - pad] ?? 0));
  const out: number[][] = [];
  const windows: { row: number; column: number }[] = [];
  for (let row = 0; row + 3 <= size; row += stride) {
    const line: number[] = [];
    for (let column = 0; column + 3 <= size; column += stride) {
      let sum = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) sum += padded[row + i][column + j] * kernel[i][j];
      line.push(sum);
      windows.push({ row: row - pad, column: column - pad });
    }
    out.push(line);
  }
  return { out, windows };
}

function maxPool(map: number[][]) {
  const out: number[][] = [];
  for (let row = 0; row + 2 <= map.length; row += 2) {
    const line: number[] = [];
    for (let column = 0; column + 2 <= map[0].length; column += 2) line.push(Math.max(map[row][column], map[row][column + 1], map[row + 1][column], map[row + 1][column + 1]));
    out.push(line);
  }
  return out;
}

function tone(value: number, max: number) {
  const t = Math.max(-1, Math.min(1, value / (max || 1)));
  return t >= 0 ? `rgba(213, 255, 110, ${0.08 + t * 0.92})` : `rgba(255, 155, 87, ${0.08 - t * 0.92})`;
}

export function ConvLab() {
  const [image, setImage] = useState(HOUSE);
  const [kernelId, setKernelId] = useState<KernelId>("vertical");
  const [stride, setStride] = useState(1);
  const [same, setSame] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const painting = useRef<number | null>(null);
  const kernel = KERNELS[kernelId].values;
  const { out, windows } = useMemo(() => convolve(image, kernel, stride, same), [image, kernel, stride, same]);
  const pooled = useMemo(() => maxPool(out.map((row) => row.map((value) => Math.max(0, value)))), [out]);
  const total = windows.length;
  const done = Math.min(cursor, total);
  const max = Math.max(1, ...out.flat().map(Math.abs));
  const current = windows[Math.min(done, total - 1)];

  useEffect(() => { setCursor(0); setPlaying(true); }, [kernelId, stride, same]);
  useEffect(() => {
    if (!playing) return;
    if (cursor >= total) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setCursor((value) => value + 1), total > 80 ? 45 : 110);
    return () => window.clearTimeout(timer);
  }, [playing, cursor, total]);

  const paint = (row: number, column: number, value?: number) => {
    setImage((grid) => grid.map((line, r) => line.map((cell, c) => (r === row && c === column ? (value ?? (cell ? 0 : 1)) : cell))));
    setCursor(total);
  };

  const columns = out[0]?.length ?? 0;
  let detail = 0;
  if (current) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) detail += (image[current.row + i]?.[current.column + j] ?? 0) * kernel[i][j];

  return (
    <div className="lab-demo conv">
      <div className="conv-controls">
        <fieldset className="lab-field">
          <legend>Filtro (kernel 3 × 3)</legend>
          <div className="lab-segment">{(Object.keys(KERNELS) as KernelId[]).map((id) => <button key={id} type="button" aria-pressed={kernelId === id} onClick={() => setKernelId(id)}>{KERNELS[id].label}</button>)}</div>
        </fieldset>
        <fieldset className="lab-field">
          <legend>Padding</legend>
          <div className="lab-segment"><button type="button" aria-pressed={!same} onClick={() => setSame(false)}>valid</button><button type="button" aria-pressed={same} onClick={() => setSame(true)}>same</button></div>
        </fieldset>
        <fieldset className="lab-field">
          <legend>Stride</legend>
          <div className="lab-segment">{[1, 2].map((value) => <button key={value} type="button" aria-pressed={stride === value} onClick={() => setStride(value)}>{value}</button>)}</div>
        </fieldset>
        <div className="lab-actions">
          <button type="button" className="primary-button" onClick={() => { if (cursor >= total) setCursor(0); setPlaying((value) => !value); }}><Icon name={playing ? "pause" : "play"} size={17} />{playing ? "Pausar" : cursor >= total ? "Deslizar de novo" : "Deslizar"}</button>
          <button type="button" className="secondary-button" onClick={() => { setPlaying(false); setCursor((value) => Math.min(total, value + 1)); }}>Um passo</button>
        </div>
        <p className="lab-note">Clique ou arraste na imagem para desenhar e veja o filtro reagir.</p>
      </div>

      <div className="conv-stage">
        <figure className="conv-figure">
          <figcaption>Imagem de entrada {image.length} × {image.length}</figcaption>
          <div className="pixel-grid" style={{ gridTemplateColumns: `repeat(${image.length}, 1fr)` }} onPointerUp={() => { painting.current = null; }} onPointerLeave={() => { painting.current = null; }}>
            {image.map((line, row) => line.map((cell, column) => {
              const inside = current && row >= current.row && row < current.row + 3 && column >= current.column && column < current.column + 3 && cursor < total + 1;
              return (
                <button
                  key={`${row}-${column}`}
                  type="button"
                  className={`pixel ${cell ? "is-on" : ""} ${inside ? "is-window" : ""}`}
                  aria-label={`Pixel ${row + 1}, ${column + 1}: ${cell ? "aceso" : "apagado"}`}
                  onPointerDown={() => { painting.current = cell ? 0 : 1; paint(row, column, painting.current); }}
                  onPointerEnter={() => { if (painting.current !== null) paint(row, column, painting.current); }}
                />
              );
            }))}
          </div>
        </figure>

        <div className="conv-op" aria-live="polite">
          <div className="kernel-grid">{kernel.map((line, i) => line.map((value, j) => <span key={`${i}-${j}`} className={value > 0 ? "is-pos" : value < 0 ? "is-neg" : ""}>{Number.isInteger(value) ? value : value.toFixed(2).replace(".", ",")}</span>))}</div>
          <p className="conv-sum">Σ = <strong>{detail.toFixed(1).replace(".", ",")}</strong></p>
          <Icon name="right" size={22} />
        </div>

        <figure className="conv-figure">
          <figcaption>Mapa de características {out.length} × {columns}</figcaption>
          <div className="pixel-grid feature" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
            {out.map((line, row) => line.map((value, column) => {
              const index = row * columns + column;
              return <span key={`${row}-${column}`} className={`pixel ${index === done ? "is-current" : ""}`} style={{ background: index < done ? tone(value, max) : "rgba(255,255,255,0.04)" }} />;
            }))}
          </div>
        </figure>

        <figure className="conv-figure small">
          <figcaption>Max-pooling 2 × 2 → {pooled.length} × {pooled[0]?.length ?? 0}</figcaption>
          <div className="pixel-grid feature" style={{ gridTemplateColumns: `repeat(${pooled[0]?.length ?? 1}, 1fr)` }}>
            {pooled.map((line, row) => line.map((value, column) => <span key={`${row}-${column}`} className="pixel" style={{ background: done >= total ? tone(value, max) : "rgba(255,255,255,0.04)" }} />))}
          </div>
        </figure>
      </div>
    </div>
  );
}
