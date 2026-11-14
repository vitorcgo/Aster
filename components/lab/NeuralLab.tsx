"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { accuracy, applyGradients, batches, createNetwork, forward, gradients, loss, makeDataset, predict, trainEpoch, type Activation, type Dataset, type Network, type Sample } from "@/lib/nn";

const DATASETS: { id: Dataset; label: string }[] = [
  { id: "xor", label: "XOR" },
  { id: "circle", label: "Círculo" },
  { id: "diagonal", label: "Diagonal" },
];
const ACTIVATIONS: { id: Activation; label: string }[] = [
  { id: "relu", label: "ReLU" },
  { id: "leaky", label: "LeakyReLU" },
  { id: "sigmoid", label: "Sigmoid" },
];
const RATES = [0.03, 0.1, 0.3, 1];

const LOOP = [
  { title: "Mini-batch", formula: "16 amostras" },
  { title: "Forward pass", formula: "z = Σ w·x + b" },
  { title: "Perda", formula: "J = −[y log ŷ + (1−y) log(1−ŷ)]" },
  { title: "Backward pass", formula: "∂J/∂w pela regra da cadeia" },
  { title: "Atualizar pesos", formula: "θ ← θ − α∇J" },
];

const W = 520;
const H = 300;
const GRID = 56;

type Pulse = { direction: "forward" | "backward"; layer: number; key: number } | null;

function layout(sizes: number[]) {
  const columns = sizes.length;
  return sizes.map((count, layer) => {
    const x = 50 + (layer * (W - 100)) / Math.max(1, columns - 1);
    const gap = Math.min(54, (H - 60) / Math.max(1, count));
    const top = H / 2 - ((count - 1) * gap) / 2;
    return Array.from({ length: count }, (_, index) => ({ x, y: top + index * gap }));
  });
}

function format(value: number) {
  return value.toFixed(2).replace(".", ",");
}

export function NeuralLab() {
  const [dataset, setDataset] = useState<Dataset>("xor");
  const [hidden, setHidden] = useState(1);
  const [width, setWidth] = useState(4);
  const [activation, setActivation] = useState<Activation>("relu");
  const [rate, setRate] = useState(0.3);
  const [seed, setSeed] = useState(7);
  const sizes = useMemo(() => [2, ...Array.from({ length: hidden }, () => width), 1], [hidden, width]);
  const data = useMemo(() => makeDataset(dataset), [dataset]);
  const [net, setNet] = useState<Network>(() => createNetwork([2, 4, 1], "relu", 7));
  const [epoch, setEpoch] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<number | null>(null);
  const [pulse, setPulse] = useState<Pulse>(null);
  const [batch, setBatch] = useState<Sample[]>([]);
  const [probe, setProbe] = useState<[number, number]>([0.6, -0.6]);
  const [hoverStep, setHoverStep] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const netRef = useRef(net);
  const epochRef = useRef(0);
  const stepToken = useRef(0);
  netRef.current = net;

  const reset = useCallback(() => {
    stepToken.current++;
    setRunning(false);
    setStage(null);
    setPulse(null);
    setBatch([]);
    const fresh = createNetwork(sizes, activation, seed);
    setNet(fresh);
    epochRef.current = 0;
    setEpoch(0);
    setHistory([loss(fresh, data)]);
  }, [sizes, activation, seed, data]);

  useEffect(() => { reset(); }, [reset]);

  // treino contínuo: algumas épocas por quadro
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    let budget = 0;
    const tick = (now: number) => {
      // cerca de 30 épocas por segundo: rápido o bastante, devagar para ver a fronteira se formar
      budget += Math.min(100, now - last) * 0.03;
      last = now;
      if (budget < 1) { frame = requestAnimationFrame(tick); return; }
      let current = netRef.current;
      while (budget >= 1) {
        budget -= 1;
        epochRef.current += 1;
        current = trainEpoch(current, data, rate, 16, epochRef.current);
      }
      netRef.current = current;
      setNet(current);
      setEpoch(epochRef.current);
      const value = loss(current, data);
      setHistory((list) => [...list.slice(-299), value]);
      if (epochRef.current >= 2000) { setRunning(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, data, rate]);

  // fronteira de decisão
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const context = surface.getContext("2d");
    if (!context) return;
    const image = context.createImageData(GRID, GRID);
    for (let row = 0; row < GRID; row++) {
      for (let column = 0; column < GRID; column++) {
        const x1 = (column / (GRID - 1)) * 2 - 1;
        const x2 = 1 - (row / (GRID - 1)) * 2;
        const p = predict(net, [x1, x2]);
        const offset = (row * GRID + column) * 4;
        // classe 0 em azul, classe 1 em laranja; a mistura mostra a incerteza
        image.data[offset] = Math.round(70 + p * (255 - 70));
        image.data[offset + 1] = Math.round(150 + p * (155 - 150));
        image.data[offset + 2] = Math.round(255 + p * (87 - 255));
        image.data[offset + 3] = Math.round(70 + Math.abs(p - 0.5) * 2 * 120);
      }
    }
    const buffer = document.createElement("canvas");
    buffer.width = GRID;
    buffer.height = GRID;
    buffer.getContext("2d")?.putImageData(image, 0, 0);
    const size = surface.width;
    context.clearRect(0, 0, size, size);
    context.imageSmoothingEnabled = true;
    context.drawImage(buffer, 0, 0, size, size);
    const inBatch = new Set(batch);
    for (const sample of data) {
      const x = ((sample.x[0] + 1) / 2) * size;
      const y = ((1 - sample.x[1]) / 2) * size;
      context.beginPath();
      context.arc(x, y, inBatch.has(sample) ? 6 : 4, 0, Math.PI * 2);
      context.fillStyle = sample.y ? "#ff9b57" : "#59b0ff";
      context.fill();
      context.lineWidth = inBatch.has(sample) ? 2.5 : 1.2;
      context.strokeStyle = inBatch.has(sample) ? "#d5ff6e" : "rgba(255,255,255,0.9)";
      context.stroke();
    }
    const px = ((probe[0] + 1) / 2) * size;
    const py = ((1 - probe[1]) / 2) * size;
    context.strokeStyle = "#d5ff6e";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(px, py, 9, 0, Math.PI * 2);
    context.moveTo(px - 14, py); context.lineTo(px - 5, py);
    context.moveTo(px + 5, py); context.lineTo(px + 14, py);
    context.moveTo(px, py - 14); context.lineTo(px, py - 5);
    context.moveTo(px, py + 5); context.lineTo(px, py + 14);
    context.stroke();
  }, [net, data, batch, probe]);

  const positions = useMemo(() => layout(net.sizes), [net.sizes]);
  const trace = useMemo(() => forward(net, probe), [net, probe]);
  const acc = useMemo(() => accuracy(net, data), [net, data]);
  const currentLoss = history[history.length - 1] ?? 0;

  const wait = (ms: number, token: number) => new Promise<boolean>((resolve) => window.setTimeout(() => resolve(token === stepToken.current), ms));

  // um ciclo do loop de treinamento, devagar, para enxergar cada etapa (Aula 3, p. 16)
  const stepThrough = async () => {
    setRunning(false);
    const token = ++stepToken.current;
    const chosen = batches(data, 16, epochRef.current + 1)[0];
    setStage(0); setBatch(chosen);
    if (!(await wait(900, token))) return;
    setStage(1);
    for (let layer = 0; layer < net.sizes.length - 1; layer++) {
      setPulse({ direction: "forward", layer, key: Date.now() });
      if (!(await wait(560, token))) return;
    }
    setPulse(null); setStage(2);
    if (!(await wait(1100, token))) return;
    setStage(3);
    for (let layer = net.sizes.length - 2; layer >= 0; layer--) {
      setPulse({ direction: "backward", layer, key: Date.now() });
      if (!(await wait(560, token))) return;
    }
    setPulse(null); setStage(4);
    const updated = applyGradients(netRef.current, gradients(netRef.current, chosen), rate);
    netRef.current = updated;
    setNet(updated);
    setHistory((list) => [...list.slice(-299), loss(updated, data)]);
    if (!(await wait(1200, token))) return;
    setStage(null); setBatch([]);
  };

  const onCanvasMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x1 = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const x2 = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    setProbe([Math.max(-1, Math.min(1, x1)), Math.max(-1, Math.min(1, x2))]);
  };

  const maxLoss = Math.max(0.75, ...history);
  const lossPath = history.map((value, index) => `${index === 0 ? "M" : "L"}${(index / Math.max(1, history.length - 1)) * 220},${60 - (value / maxLoss) * 56}`).join(" ");
  const perceptronStuck = hidden === 0 && dataset !== "diagonal" && epoch > 120 && acc < 0.85;
  const solved = acc >= 0.97 && epoch > 0;
  const output = trace.a[trace.a.length - 1][0];

  return (
    <div className="lab-demo neural">
      <div className="neural-controls">
        <fieldset className="lab-field">
          <legend>Problema</legend>
          <div className="lab-segment">{DATASETS.map((item) => <button key={item.id} type="button" aria-pressed={dataset === item.id} onClick={() => setDataset(item.id)}>{item.label}</button>)}</div>
        </fieldset>
        <fieldset className="lab-field">
          <legend>Camadas ocultas</legend>
          <div className="lab-segment">{[0, 1, 2].map((value) => <button key={value} type="button" aria-pressed={hidden === value} onClick={() => setHidden(value)}>{value === 0 ? "0, Perceptron" : value}</button>)}</div>
        </fieldset>
        {hidden > 0 && (
          <fieldset className="lab-field">
            <legend>Neurônios por camada</legend>
            <div className="lab-stepper">
              <button type="button" onClick={() => setWidth((value) => Math.max(2, value - 1))} aria-label="Menos neurônios"><Icon name="minus" size={16} /></button>
              <output>{width}</output>
              <button type="button" onClick={() => setWidth((value) => Math.min(6, value + 1))} aria-label="Mais neurônios"><Icon name="plus" size={16} /></button>
            </div>
          </fieldset>
        )}
        <fieldset className="lab-field">
          <legend>Ativação das camadas ocultas</legend>
          <div className="lab-segment">{ACTIVATIONS.map((item) => <button key={item.id} type="button" aria-pressed={activation === item.id} onClick={() => setActivation(item.id)}>{item.label}</button>)}</div>
        </fieldset>
        <fieldset className="lab-field">
          <legend>Taxa de aprendizado α</legend>
          <div className="lab-segment">{RATES.map((value) => <button key={value} type="button" aria-pressed={rate === value} onClick={() => setRate(value)}>{String(value).replace(".", ",")}</button>)}</div>
        </fieldset>
        <div className="lab-actions">
          <button type="button" className="primary-button" onClick={() => { stepToken.current++; setStage(null); setPulse(null); setBatch([]); setRunning((value) => !value); }}>
            <Icon name={running ? "pause" : "play"} size={17} />{running ? "Pausar" : epoch ? "Continuar" : "Treinar"}
          </button>
          <button type="button" className="secondary-button" onClick={stepThrough} disabled={stage !== null}>Passo a passo</button>
          <button type="button" className="secondary-button" onClick={() => setSeed((value) => value + 1)}><Icon name="replay" size={16} />Novos pesos</button>
        </div>
      </div>

      <div className="neural-stage">
        <svg className="neural-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Rede com camadas de ${net.sizes.join(", ")} neurônios`}>
          {net.weights.map((layer, l) => layer.map((row, j) => row.map((weight, i) => {
            const from = positions[l][i];
            const to = positions[l + 1][j];
            const strength = Math.min(1, Math.abs(weight) / 2);
            return (
              <line
                key={`e-${l}-${i}-${j}`}
                className={`nn-edge ${stage === 4 ? "is-updating" : ""}`}
                x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={weight >= 0 ? "var(--lime)" : "var(--roof)"}
                strokeWidth={0.6 + strength * 5}
                strokeOpacity={0.18 + strength * 0.75}
              />
            );
          })))}
          <AnimatePresence>
            {pulse && net.weights[pulse.layer].flatMap((row, j) => row.map((_, i) => {
              const from = pulse.direction === "forward" ? positions[pulse.layer][i] : positions[pulse.layer + 1][j];
              const to = pulse.direction === "forward" ? positions[pulse.layer + 1][j] : positions[pulse.layer][i];
              return (
                <motion.circle
                  key={`p-${pulse.key}-${i}-${j}`}
                  r={pulse.direction === "forward" ? 4.5 : 4}
                  className={`nn-pulse is-${pulse.direction}`}
                  initial={{ cx: from.x, cy: from.y, opacity: 0 }}
                  animate={{ cx: to.x, cy: to.y, opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 0.52, ease: [0.65, 0, 0.35, 1] }}
                />
              );
            }))}
          </AnimatePresence>
          {positions.map((column, l) => column.map((node, index) => {
            const a = trace.a[l][index];
            const isOutput = l === positions.length - 1;
            const isInput = l === 0;
            const level = isInput ? (a + 1) / 2 : Math.max(0, Math.min(1, isOutput ? a : a / 2));
            return (
              <g key={`n-${l}-${index}`} className="nn-node">
                <circle cx={node.x} cy={node.y} r={isInput || isOutput ? 19 : 16} className="nn-node-ring" />
                <circle cx={node.x} cy={node.y} r={isInput || isOutput ? 19 : 16} className="nn-node-fill" style={{ opacity: 0.15 + level * 0.85 }} fill={isOutput ? (a >= 0.5 ? "var(--roof)" : "#59b0ff") : "var(--lime)"} />
                <text x={node.x} y={node.y + 4} className="nn-node-value">{format(a)}</text>
                {isInput && <text x={node.x - 30} y={node.y + 4} className="nn-node-label">x{index === 0 ? "₁" : "₂"}</text>}
                {isOutput && <text x={node.x + 28} y={node.y + 4} className="nn-node-label">ŷ</text>}
                <title>{isInput ? `Entrada x${index + 1} = ${format(a)}` : `z = ${format(trace.z[l][index])}, ativação = ${format(a)}`}</title>
              </g>
            );
          }))}
          {stage === 2 && (
            <g className="nn-loss-bubble">
              <rect x={W - 150} y={H / 2 - 64} width="130" height="34" rx="10" />
              <text x={W - 85} y={H / 2 - 42}>perda {format(currentLoss)}</text>
            </g>
          )}
          <text x="50" y={H - 8} className="nn-layer-label">entrada</text>
          {hidden > 0 && <text x={W / 2} y={H - 8} className="nn-layer-label">{hidden === 1 ? "camada oculta" : "camadas ocultas"}</text>}
          <text x={W - 50} y={H - 8} className="nn-layer-label">saída</text>
        </svg>

        <ol className="loop-strip" aria-label="Loop de treinamento da Aula 3, página 16">
          {LOOP.map((item, index) => (
            <li key={item.title} className={stage === index ? "is-active" : stage !== null && index < stage ? "is-done" : ""} onPointerEnter={() => setHoverStep(index)} onPointerLeave={() => setHoverStep(null)}>
              <span className="loop-n">{index + 1}</span>
              <strong>{item.title}</strong>
            </li>
          ))}
        </ol>
        <p className="loop-formula" aria-live="polite">
          <span>{LOOP[stage ?? hoverStep ?? 1].title}</span>
          <code>{LOOP[stage ?? hoverStep ?? 1].formula}</code>
        </p>
      </div>

      <div className="neural-side">
        <div className="boundary">
          <canvas ref={canvas} width={280} height={280} onPointerMove={onCanvasMove} aria-label="Fronteira de decisão. Passe o mouse para testar um ponto na rede." />
          <p className="boundary-note">Passe o mouse no mapa: o ponto entra na rede e você vê cada neurônio responder. Saída ŷ = {format(output)}.</p>
        </div>
        <dl className="neural-stats">
          <div><dt>Época</dt><dd>{epoch}</dd></div>
          <div><dt>Perda</dt><dd>{format(currentLoss)}</dd></div>
          <div><dt>Acurácia</dt><dd>{Math.round(acc * 100)}%</dd></div>
        </dl>
        <svg className="loss-chart" viewBox="0 0 220 62" preserveAspectRatio="none" aria-label="Perda ao longo das épocas"><path d={lossPath} /></svg>
        <AnimatePresence mode="wait">
          {perceptronStuck ? (
            <motion.p key="stuck" className="lab-insight is-warn" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>Um único perceptron não separa esse problema: nenhuma reta divide os grupos. Adicione uma camada oculta.</motion.p>
          ) : solved ? (
            <motion.p key="solved" className="lab-insight is-good" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>A rede aprendeu a separar os grupos: {Math.round(acc * 100)}% de acerto em {epoch} épocas.</motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
