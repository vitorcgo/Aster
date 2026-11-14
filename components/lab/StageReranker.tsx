"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { lectureLabel } from "@/lib/aster";
import { labGet } from "@/lib/lab";
import { applyGradients, batches, createNetwork, forward, gradients, loss, predict, trainEpoch, type Activation, type Network, type Sample } from "@/lib/nn";

type RCandidate = { id: string; document_id: string; page: number; x: [number, number]; lexical: number; y: 0 | 1 };
type RQuery = { id: number; q: string; expected: { document_id: string; page: number }; origin: string; candidates: RCandidate[] };
type Relevance = { features: string[]; queries: RQuery[] };

const ACTIVATIONS: { id: Activation; label: string }[] = [{ id: "relu", label: "ReLU" }, { id: "leaky", label: "LeakyReLU" }, { id: "sigmoid", label: "Sigmoid" }];
const RATES = [0.03, 0.1, 0.3, 1];
const LOOP = [
  { title: "Mini-batch", formula: "16 pares pergunta e trecho" },
  { title: "Forward pass", formula: "z = Σ w·x + b" },
  { title: "Perda", formula: "J = −[y log ŷ + (1−y) log(1−ŷ)]" },
  { title: "Backward pass", formula: "∂J/∂w pela regra da cadeia" },
  { title: "Atualizar pesos", formula: "θ ← θ − α∇J" },
];
const W = 520;
const H = 280;
const GRID = 56;

const toNet = (x: [number, number]): [number, number] => [x[0] * 2 - 1, x[1] * 2 - 1];

function samplesOf(queries: RQuery[]): Sample[] {
  const result: Sample[] = [];
  for (const query of queries) {
    for (const candidate of query.candidates) {
      const sample: Sample = { x: toNet(candidate.x), y: candidate.y };
      // poucos positivos: repetimos para a rede não aprender só a dizer "não"
      for (let copy = 0; copy < (candidate.y ? 4 : 1); copy++) result.push(sample);
    }
  }
  return result;
}

function pageRank(query: RQuery, order: RCandidate[]) {
  const pages: string[] = [];
  for (const candidate of order) {
    const key = `${candidate.document_id}:${candidate.page}`;
    if (!pages.includes(key)) pages.push(key);
  }
  const position = pages.indexOf(`${query.expected.document_id}:${query.expected.page}`);
  return position >= 0 ? position + 1 : null;
}

function rerank(net: Network, query: RQuery) {
  return [...query.candidates].sort((a, b) => predict(net, toNet(b.x)) - predict(net, toNet(a.x)) || b.lexical - a.lexical);
}

function recallAt(ranks: (number | null)[], k: number) {
  return ranks.filter((rank) => rank !== null && rank <= k).length / Math.max(1, ranks.length);
}

function layout(sizes: number[]) {
  return sizes.map((count, layer) => {
    const x = 70 + (layer * (W - 150)) / Math.max(1, sizes.length - 1);
    const gap = Math.min(52, (H - 60) / Math.max(1, count));
    const top = H / 2 - ((count - 1) * gap) / 2;
    return Array.from({ length: count }, (_, index) => ({ x, y: top + index * gap }));
  });
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const num = (value: number) => value.toFixed(2).replace(".", ",");

export function StageReranker({ onModel, onData, deep = false }: { onModel?: (rank: ((query: RQuery) => number | null) | null) => void; onData?: (queries: RQuery[]) => void ; deep?: boolean }) {
  const [data, setData] = useState<Relevance | null>(null);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState(1);
  const [width, setWidth] = useState(4);
  const [activation, setActivation] = useState<Activation>("relu");
  const [rate, setRate] = useState(0.3);
  const [seed, setSeed] = useState(7);
  const sizes = useMemo(() => [2, ...Array.from({ length: hidden }, () => width), 1], [hidden, width]);
  const samples = useMemo(() => (data ? samplesOf(data.queries) : []), [data]);
  const [net, setNet] = useState<Network>(() => createNetwork([2, 4, 1], "relu", 7));
  const [epoch, setEpoch] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<number | null>(null);
  const [pulse, setPulse] = useState<{ direction: "forward" | "backward"; layer: number; key: number } | null>(null);
  const [batch, setBatch] = useState<Sample[]>([]);
  const [probe, setProbe] = useState<[number, number]>([0.2, 0.6]);
  const [focus, setFocus] = useState(12);
  const [loo, setLoo] = useState<{ progress: number; recall1?: number; recall3?: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const netRef = useRef(net);
  const epochRef = useRef(0);
  const token = useRef(0);
  netRef.current = net;

  useEffect(() => { labGet<Relevance>("/api/lab/relevance").then((result) => { setData(result); onData?.(result.queries); }).catch((problem: Error) => setError(problem.message)); }, [onData]);

  const reset = useCallback(() => {
    token.current++;
    setRunning(false); setStage(null); setPulse(null); setBatch([]); setLoo(null);
    const fresh = createNetwork(sizes, activation, seed);
    setNet(fresh);
    epochRef.current = 0;
    setEpoch(0);
    setHistory(samples.length ? [loss(fresh, samples)] : []);
  }, [sizes, activation, seed, samples]);
  useEffect(() => { reset(); }, [reset]);

  useEffect(() => {
    if (!running || !samples.length) return;
    let frame = 0;
    let last = performance.now();
    let budget = 0;
    const tick = (now: number) => {
      budget += Math.min(100, now - last) * 0.025;
      last = now;
      if (budget >= 1) {
        let current = netRef.current;
        while (budget >= 1) { budget -= 1; epochRef.current += 1; current = trainEpoch(current, samples, rate, 16, epochRef.current); }
        netRef.current = current;
        setNet(current);
        setEpoch(epochRef.current);
        setHistory((list) => [...list.slice(-299), loss(current, samples)]);
        if (epochRef.current >= 600) { setRunning(false); return; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, samples, rate]);

  const ranks = useMemo(() => {
    if (!data) return null;
    const lexical = data.queries.map((query) => pageRank(query, query.candidates));
    const neural = data.queries.map((query) => pageRank(query, rerank(net, query)));
    return { lexical, neural };
  }, [data, net]);

  useEffect(() => {
    if (!onModel) return;
    onModel(epoch > 0 ? (query: RQuery) => pageRank(query, rerank(netRef.current, query)) : null);
  }, [epoch, net, onModel]);

  // fronteira de decisão no espaço das duas características reais
  useEffect(() => {
    const surface = canvas.current;
    if (!surface || !data) return;
    const context = surface.getContext("2d");
    if (!context) return;
    const image = context.createImageData(GRID, GRID);
    for (let row = 0; row < GRID; row++) for (let column = 0; column < GRID; column++) {
      const p = predict(net, [(column / (GRID - 1)) * 2 - 1, 1 - (row / (GRID - 1)) * 2]);
      const offset = (row * GRID + column) * 4;
      image.data[offset] = Math.round(70 + p * 185);
      image.data[offset + 1] = Math.round(150 + p * 5);
      image.data[offset + 2] = Math.round(255 - p * 168);
      image.data[offset + 3] = Math.round(60 + Math.abs(p - 0.5) * 2 * 120);
    }
    const buffer = document.createElement("canvas");
    buffer.width = GRID; buffer.height = GRID;
    buffer.getContext("2d")?.putImageData(image, 0, 0);
    const size = surface.width;
    context.clearRect(0, 0, size, size);
    context.drawImage(buffer, 0, 0, size, size);
    const selected = data.queries[focus];
    const inBatch = new Set(batch.map((sample) => sample.x.join(",")));
    for (const query of data.queries) for (const candidate of query.candidates) {
      const [x, y] = toNet(candidate.x);
      const px = ((x + 1) / 2) * size + ((candidate.id.length * 7) % 9) - 4;
      const py = ((1 - y) / 2) * size + ((candidate.id.length * 5) % 9) - 4;
      const mine = query === selected;
      context.beginPath();
      context.arc(px, py, mine ? 6 : candidate.y ? 4.5 : 3, 0, Math.PI * 2);
      context.fillStyle = candidate.y ? "#ff9b57" : "rgba(89,176,255,0.75)";
      context.fill();
      if (mine || inBatch.has(toNet(candidate.x).join(","))) { context.lineWidth = 2.5; context.strokeStyle = "#d5ff6e"; context.stroke(); }
    }
    const px = ((probe[0] + 1) / 2) * size;
    const py = ((1 - probe[1]) / 2) * size;
    context.strokeStyle = "#ffffff"; context.lineWidth = 1.5;
    context.beginPath(); context.arc(px, py, 8, 0, Math.PI * 2); context.stroke();
  }, [net, data, focus, batch, probe]);

  const wait = (ms: number, mine: number) => new Promise<boolean>((resolve) => window.setTimeout(() => resolve(mine === token.current), ms));
  const stepThrough = async () => {
    if (!samples.length) return;
    setRunning(false);
    const mine = ++token.current;
    const chosen = batches(samples, 16, epochRef.current + 1)[0];
    setStage(0); setBatch(chosen);
    if (!(await wait(900, mine))) return;
    setStage(1);
    for (let layer = 0; layer < sizes.length - 1; layer++) { setPulse({ direction: "forward", layer, key: Date.now() }); if (!(await wait(560, mine))) return; }
    setPulse(null); setStage(2);
    if (!(await wait(1000, mine))) return;
    setStage(3);
    for (let layer = sizes.length - 2; layer >= 0; layer--) { setPulse({ direction: "backward", layer, key: Date.now() }); if (!(await wait(560, mine))) return; }
    setPulse(null); setStage(4);
    const updated = applyGradients(netRef.current, gradients(netRef.current, chosen), rate);
    netRef.current = updated; setNet(updated);
    setEpoch((value) => Math.max(1, value));
    setHistory((list) => [...list.slice(-299), loss(updated, samples)]);
    if (!(await wait(1100, mine))) return;
    setStage(null); setBatch([]);
  };

  // validação justa: cada pergunta é avaliada por uma rede que não a viu no treino
  const leaveOneOut = () => {
    if (!data) return;
    const mine = ++token.current;
    setRunning(false);
    const results: (number | null)[] = [];
    setLoo({ progress: 0 });
    const fold = (index: number) => {
      if (mine !== token.current) return;
      if (index >= data.queries.length) {
        setLoo({ progress: 1, recall1: recallAt(results, 1), recall3: recallAt(results, 3) });
        return;
      }
      const training = samplesOf(data.queries.filter((_, position) => position !== index));
      let model = createNetwork(sizes, activation, seed);
      for (let step = 0; step < 220; step++) model = trainEpoch(model, training, rate, 16, step);
      results.push(pageRank(data.queries[index], rerank(model, data.queries[index])));
      setLoo({ progress: (index + 1) / data.queries.length });
      window.setTimeout(() => fold(index + 1), 0);
    };
    window.setTimeout(() => fold(0), 30);
  };

  const positions = useMemo(() => layout(sizes), [sizes]);
  const trace = useMemo(() => forward(net, probe), [net, probe]);
  const currentLoss = history[history.length - 1] ?? 0;
  const maxLoss = Math.max(0.3, ...history);
  const lossPath = history.map((value, index) => `${index ? "L" : "M"}${(index / Math.max(1, history.length - 1)) * 220},${60 - (value / maxLoss) * 56}`).join(" ");
  const selected = data?.queries[focus];

  if (error) return <p className="sheet-error">{error}</p>;
  if (!data || !ranks) return <p className="lab-note">Carregando os pares reais da busca.</p>;

  const lexicalRank = selected ? ranks.lexical[focus] : null;
  const neuralRank = selected ? ranks.neural[focus] : null;

  return (
    <div className={`lab-demo neural ${deep ? "" : "is-simple"}`}>
      <div className="neural-controls">
        <p className="lab-note">Dados reais: {data.queries.length} perguntas com a página certa conhecida, {data.queries.reduce((sum, query) => sum + query.candidates.length, 0)} trechos candidatos vindos da busca do Aster.</p>
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
          <legend>Ativação</legend>
          <div className="lab-segment">{ACTIVATIONS.map((item) => <button key={item.id} type="button" aria-pressed={activation === item.id} onClick={() => setActivation(item.id)}>{item.label}</button>)}</div>
        </fieldset>
        <fieldset className="lab-field">
          <legend>Taxa de aprendizado α</legend>
          <div className="lab-segment">{RATES.map((value) => <button key={value} type="button" aria-pressed={rate === value} onClick={() => setRate(value)}>{String(value).replace(".", ",")}</button>)}</div>
        </fieldset>
        <div className="lab-actions">
          <button type="button" className="primary-button" onClick={() => { token.current++; setStage(null); setPulse(null); setBatch([]); setRunning((value) => !value); }}>
            <Icon name={running ? "pause" : "play"} size={17} />{running ? "Pausar" : epoch ? "Continuar" : "Treinar"}
          </button>
          {deep && <button type="button" className="secondary-button" onClick={stepThrough} disabled={stage !== null}>Passo a passo</button>}
          <button type="button" className="secondary-button" onClick={() => setSeed((value) => value + 1)}><Icon name="replay" size={16} />{deep ? "Novos pesos" : "Começar do zero"}</button>
        </div>
      </div>

      <div className="neural-stage">
        <svg className="neural-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Rede com camadas de ${sizes.join(", ")} neurônios`}>
          {net.weights.map((layer, l) => layer.map((row, j) => row.map((weight, i) => {
            const from = positions[l][i];
            const to = positions[l + 1][j];
            const strength = Math.min(1, Math.abs(weight) / 2);
            return <line key={`e-${l}-${i}-${j}`} className={`nn-edge ${stage === 4 ? "is-updating" : ""}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={weight >= 0 ? "var(--lime)" : "var(--roof)"} strokeWidth={0.6 + strength * 5} strokeOpacity={0.18 + strength * 0.75} />;
          })))}
          <AnimatePresence>
            {pulse && net.weights[pulse.layer].flatMap((row, j) => row.map((_, i) => {
              const from = pulse.direction === "forward" ? positions[pulse.layer][i] : positions[pulse.layer + 1][j];
              const to = pulse.direction === "forward" ? positions[pulse.layer + 1][j] : positions[pulse.layer][i];
              return <motion.circle key={`p-${pulse.key}-${i}-${j}`} r={4.5} className={`nn-pulse is-${pulse.direction}`} initial={{ cx: from.x, cy: from.y, opacity: 0 }} animate={{ cx: to.x, cy: to.y, opacity: [0, 1, 1, 0] }} transition={{ duration: 0.52, ease: [0.65, 0, 0.35, 1] }} />;
            }))}
          </AnimatePresence>
          {positions.map((column, l) => column.map((node, index) => {
            const a = trace.a[l][index];
            const isOutput = l === positions.length - 1;
            const isInput = l === 0;
            const level = isInput ? (a + 1) / 2 : Math.max(0, Math.min(1, isOutput ? a : a / 2));
            return (
              <g key={`n-${l}-${index}`}>
                <circle cx={node.x} cy={node.y} r={18} className="nn-node-ring" />
                <circle cx={node.x} cy={node.y} r={18} className="nn-node-fill" style={{ opacity: 0.15 + level * 0.85 }} fill={isOutput ? (a >= 0.5 ? "var(--roof)" : "#59b0ff") : "var(--lime)"} />
                <text x={node.x} y={node.y + 4} className="nn-node-value">{num(isInput ? (a + 1) / 2 : a)}</text>
                {isInput && <text x={node.x - 26} y={node.y + 4} className="nn-node-label small" style={{ textAnchor: "end" }}>{index === 0 ? "trecho" : "título"}</text>}
                {isOutput && <text x={node.x + 26} y={node.y + 4} className="nn-node-label small" style={{ textAnchor: "start" }}>relevante?</text>}
              </g>
            );
          }))}
          {stage === 2 && <g className="nn-loss-bubble"><rect x={W - 160} y={H / 2 - 62} width="130" height="34" rx="10" /><text x={W - 95} y={H / 2 - 40}>erro {num(currentLoss)}</text></g>}
        </svg>
        {!deep && <p className="neural-simple-note">Cada bolinha é um neurônio. Ele olha duas coisas de cada pedacinho (as palavras-chave no texto e no título) e responde se é o pedacinho certo. Linhas verdes reforçam, laranjas enfraquecem. Clique em Treinar e veja as linhas mudando enquanto ela aprende.</p>}
        <ol className="loop-strip" aria-label="Loop de treinamento da Aula 3, página 16">
          {LOOP.map((item, index) => <li key={item.title} className={stage === index ? "is-active" : stage !== null && index < stage ? "is-done" : ""}><span className="loop-n">{index + 1}</span><strong>{item.title}</strong></li>)}
        </ol>
        <p className="loop-formula"><span>{LOOP[stage ?? 1].title}</span><code>{LOOP[stage ?? 1].formula}</code></p>

        <div className="lab-card rerank-query">
          <label className="lab-field">
            <span>Ver uma pergunta do conjunto</span>
            <select value={focus} onChange={(event) => setFocus(Number(event.target.value))}>
              {data.queries.map((query, index) => <option key={query.id} value={index}>{query.q}</option>)}
            </select>
          </label>
          {selected && (
            <p className="rerank-verdict">
              Página certa: <strong>{lectureLabel(selected.expected.document_id, selected.expected.page)}</strong>. A busca do Aster a colocou em <strong>{lexicalRank ? `${lexicalRank}º` : "nenhuma posição"}</strong>; com a rede, ela fica em <strong className={neuralRank && lexicalRank && neuralRank < lexicalRank ? "is-up" : ""}>{neuralRank ? `${neuralRank}º` : "nenhuma posição"}</strong>.
            </p>
          )}
        </div>
      </div>

      <div className="neural-side">
        <div className="boundary">
          <canvas ref={canvas} width={280} height={280} onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setProbe([Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)), Math.max(-1, Math.min(1, 1 - ((event.clientY - rect.top) / rect.height) * 2))]); }} aria-label="Pares pergunta e trecho no plano das duas características" />
          <p className="axis-x">cobertura da pergunta no trecho →</p>
          <p className="boundary-note">Laranja: trecho da página certa. Azul: outros. Para cima, mais termos da pergunta no título do slide. Em verde, a pergunta escolhida.</p>
        </div>
        <dl className="neural-stats">
          <div><dt>Rodadas de treino</dt><dd>{epoch}</dd></div>
          <div><dt>Erro da rede</dt><dd>{num(currentLoss)}</dd></div>
          <div><dt>Acerta de primeira</dt><dd>{pct(recallAt(ranks.neural, 1))}</dd></div>
        </dl>
        <svg className="loss-chart" viewBox="0 0 220 62" preserveAspectRatio="none" aria-label="Erro da rede caindo a cada rodada de treino"><path d={lossPath} /></svg>
        <div className="lab-card compare">
          <p><span>Busca do Aster</span><strong>{pct(recallAt(ranks.lexical, 1))}</strong><small>{deep ? "acerta a página em 1º" : "acerta de primeira"}</small></p>
          <p><span>Com a rede</span><strong className={recallAt(ranks.neural, 1) > recallAt(ranks.lexical, 1) ? "is-up" : ""}>{pct(recallAt(ranks.neural, 1))}</strong><small>{deep ? "nas perguntas que ela já viu" : epoch ? "depois de treinar" : "antes de treinar, chutando"}</small></p>
          <button type="button" className="secondary-button" onClick={leaveOneOut} disabled={!!loo && loo.progress < 1}>
            {loo && loo.progress < 1 ? `Validando ${Math.round(loo.progress * 100)}%` : "Testar com perguntas novas"}
          </button>
          {loo?.recall1 !== undefined && <p className="lab-note">Escondendo cada pergunta do treino e testando nela depois: acerta de primeira em {pct(loo.recall1)} e fica entre as 3 primeiras em {pct(loo.recall3 ?? 0)}. Esse é o número honesto, porque testar nas perguntas que a rede já viu seria colar na prova (overfitting, Aula 2, p. 22).</p>}
        </div>
      </div>
    </div>
  );
}

export type { RQuery };
