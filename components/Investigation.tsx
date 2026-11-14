"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AcervoGrid } from "./AcervoGrid";
import { Drawable } from "./Drawable";
import { Icon, type IconName } from "./Icon";
import { Mascot } from "./Mascot";
import { faviconUrl, lectureLabel, siteName, type Material, type TraceNode, type Turn, providerLabel } from "@/lib/aster";

type Props = {
  turn: Turn | null;
  materials: Material[];
  compact: boolean;
  replaying: boolean;
  live: boolean;
  onToggleCompact: () => void;
  onReplay: () => void;
  onOpenNode: (node: TraceNode) => void;
};

type Edge = { id: string; d: string; tone: "flow" | "aula" | "web"; live: boolean };

const ease = [0.23, 1, 0.32, 1] as const;

function nodeIcon(node: TraceNode): IconName {
  switch (node.kind) {
    case "question": return "question";
    case "search": return "search";
    case "read": return "page";
    case "web": return "globe";
    case "check": return node.ok === false ? "alert" : "shield";
    case "fallback": return "swap";
    case "answer": return "check";
    case "stop": return node.tone === "error" ? "alert" : "flag";
  }
}

function nodeTitle(node: TraceNode) {
  switch (node.kind) {
    case "question": return "Pergunta";
    case "search": return "Busca nas aulas";
    case "read": return "Leitura";
    case "web": return "Pesquisa na web";
    case "check": return node.ok === null ? "Verificação" : node.ok ? "Verificado" : "Resposta recusada";
    case "fallback": return "Modelo reserva";
    case "answer": return node.chat ? "Conversa" : "Resposta";
    case "stop": return node.tone === "error" ? "Falha" : "Sem base";
  }
}

function shortLabel(node: TraceNode) {
  switch (node.kind) {
    case "question": return "Pergunta";
    case "search": return `“${node.query}”`;
    case "read": return lectureLabel(node.aula, node.page);
    case "web": return node.results?.length ? siteName(node.results[0].domain) : "Web";
    case "check": return node.ok === null ? "Conferindo" : node.ok ? "Conferido" : "Recusada";
    case "fallback": return "Reserva";
    case "answer": return node.chat ? "Conversa" : `${node.citations} citações`;
    case "stop": return node.tone === "error" ? "Falha" : "Sem base";
  }
}

function NodeBody({ node, materials }: { node: TraceNode; materials: Material[] }) {
  switch (node.kind) {
    case "question":
      return <p className="node-text clamp-3">{node.text}</p>;
    case "search": {
      const docs = node.hits ? new Set(node.hits.map((hit) => hit.document_id)).size : 0;
      return (
        <>
          <p className="node-query">“{node.query}”{node.aula && <span className="node-scope"> em {lectureLabel(node.aula)}</span>}</p>
          {node.hits === null ? (
            // enquanto varre, o mapa das 12 aulas; com o resultado, as páginas achadas (o mapa quase todo apagado parecia vazio)
            <AcervoGrid materials={materials} hits={node.hits} focus={node.aula} />
          ) : node.hits.length > 0 && (
            <ul className="hit-mini">
              {Array.from(new Map(node.hits.map((hit) => [`${hit.document_id}:${hit.page}`, hit])).values()).slice(0, 3).map((hit) => (
                <li key={hit.id}><Icon name="page" size={13} /><span><b>{lectureLabel(hit.document_id, hit.page)}</b>{hit.quote}</span></li>
              ))}
            </ul>
          )}
          <p className="node-meta">{node.hits === null ? "Varrendo 12 aulas" : node.hits.length ? `${node.hits.length} trechos em ${docs} ${docs === 1 ? "aula" : "aulas"}` : "Nada encontrado"}</p>
        </>
      );
    }
    case "read":
      return (
        <>
          <p className="node-strong">{lectureLabel(node.aula, node.page)}</p>
          {node.payload ? <p className="node-text clamp-2">{node.payload.heading || node.payload.title}</p> : <p className="node-meta">Abrindo a página</p>}
          <div className="page-lines" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} style={{ width: `${92 - ((index * 17) % 38)}%` }} />)}</div>
        </>
      );
    case "web":
      return (
        <>
          <p className="node-query">“{node.query}”</p>
          {node.results === null ? <p className="node-meta">Pesquisando</p> : node.results.length ? (
            <ul className="web-mini">
              {node.results.slice(0, 3).map((result) => (
                <li key={result.id}><img src={faviconUrl(result.domain)} alt="" width="16" height="16" loading="lazy" /><span>{result.title.replace(/ — Wikipédia$/, "")}</span></li>
              ))}
            </ul>
          ) : <p className="node-meta">Sem resultados</p>}
          {node.provider && <p className="node-meta">via {providerLabel(node.provider)}</p>}
        </>
      );
    case "check":
      return <p className="node-text clamp-3">{node.message}</p>;
    case "fallback":
      return (
        <>
          {node.tried.length > 0 && <p className="node-meta">Sem resposta de {node.tried.join(", ")}</p>}
          <p className="node-text">Usando {node.model}</p>
        </>
      );
    case "answer":
      return <p className="node-text">{node.chat ? "Resposta direta, sem pesquisa" : `${node.citations} ${node.citations === 1 ? "fonte citada" : "fontes citadas"}`}</p>;
    case "stop":
      return <p className="node-text clamp-3">{node.message}</p>;
  }
}

export function Investigation({ turn, materials, compact, replaying, live, onToggleCompact, onReplay, onOpenNode }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // zoom manual (null = ajustar sozinho) e área ampliada, para olhar a trilha de perto na apresentação
  const [zoom, setZoom] = useState<number | null>(null);
  const [tall, setTall] = useState(false);
  const [autoScale, setAutoScale] = useState(1);
  const nodes = turn?.nodes ?? [];
  const thinking = !!turn && turn.status === "running" && turn.thinking;
  const last = nodes[nodes.length - 1];

  // Fontes citadas: de qual nó cada uma veio
  const citedFrom = useMemo(() => {
    if (!turn || turn.status !== "answered") return [] as { from: string; tone: "aula" | "web" }[];
    const links = new Map<string, "aula" | "web">();
    for (const source of turn.sources) {
      if (source.kind === "web") {
        const node = nodes.find((item) => item.kind === "web" && item.results?.some((result) => result.id === source.id));
        if (node) links.set(node.id, "web");
      } else {
        const node = nodes.find((item) => item.kind === "read" && item.aula === source.document_id && item.page === source.page)
          ?? nodes.find((item) => item.kind === "search" && item.hits?.some((hit) => hit.id === source.id));
        if (node && !links.has(node.id)) links.set(node.id, "aula");
      }
    }
    return Array.from(links, ([from, tone]) => ({ from, tone }));
  }, [turn, nodes]);

  useLayoutEffect(() => {
    const element = track.current;
    const frame = viewport.current;
    if (!element || !frame) return;
    // encolhe a trilha para todos os passos caberem na altura disponível (até 60%); abaixo disso, rola
    const contentHeight = () => {
      // altura real dos blocos; o SVG das conexões fica de fora porque guarda o tamanho da medida anterior
      let bottom = 0;
      for (const child of Array.from(element.children)) {
        if (child instanceof HTMLElement) bottom = Math.max(bottom, child.offsetTop + child.offsetHeight);
      }
      return bottom + 22;
    };
    const fit = () => {
      element.style.transform = "none";
      element.style.marginBottom = "0px";
      element.style.width = compact ? "" : "100%";
      if (compact) return;
      // a trilha ocupa só a altura de que precisa (até 54% da área); o documento fica com o resto
      const work = frame.closest<HTMLElement>(".work");
      const head = frame.offsetTop;
      const limit = work ? work.clientHeight * (tall ? 0.8 : 0.54) : frame.clientHeight + head;
      const available = limit - head;
      let scale = 0.66;
      if (zoom !== null) {
        scale = zoom;
      } else {
        for (const candidate of [1, 0.92, 0.85, 0.78, 0.72, 0.66]) {
          element.style.width = `${100 / candidate}%`;
          if (contentHeight() * candidate <= available) { scale = candidate; break; }
        }
        setAutoScale(scale);
      }
      element.style.width = `${100 / scale}%`;
      element.style.transform = scale < 1 ? `scale(${scale})` : "none";
      // a escala não encolhe a caixa de layout; a margem negativa tira a sobra da área de rolagem
      element.style.marginBottom = `${-Math.round(element.offsetHeight * (1 - scale))}px`;
      frame.dataset.scale = String(scale);
      // se tudo coube, a trilha fica no topo; rolar só esconderia a primeira linha
      if (contentHeight() * scale <= available + 1) frame.scrollTop = 0;
      if (work) work.style.setProperty("--trace-h", `${Math.round(tall ? limit : Math.max(190, Math.min(limit, head + contentHeight() * scale)))}px`);
    };
    const measure = () => {
      fit();
      const items = Array.from(element.querySelectorAll<HTMLElement>("[data-node]"));
      const box = (id: string) => {
        const item = items.find((candidate) => candidate.dataset.node === id);
        return item ? { x: item.offsetLeft, y: item.offsetTop, w: item.offsetWidth, h: item.offsetHeight } : null;
      };
      const next: Edge[] = [];
      for (let index = 1; index < items.length; index++) {
        const a = items[index - 1];
        const b = items[index];
        const live = index === items.length - 1 && !!turn && turn.status === "running";
        const sameRow = Math.abs(a.offsetTop - b.offsetTop) < 12;
        if (sameRow) {
          const x1 = a.offsetLeft + a.offsetWidth;
          const y1 = a.offsetTop + (compact ? a.offsetHeight / 2 : 34);
          const x2 = b.offsetLeft;
          const y2 = b.offsetTop + (compact ? b.offsetHeight / 2 : 34);
          const bend = (x2 - x1) / 2;
          next.push({ id: `e-${a.dataset.node}-${b.dataset.node}`, d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`, tone: "flow", live });
        } else {
          // quebra de linha: sai por baixo do bloco e entra por cima do próximo, como uma serpentina
          const x1 = a.offsetLeft + a.offsetWidth / 2;
          const y1 = a.offsetTop + a.offsetHeight;
          const x2 = b.offsetLeft + b.offsetWidth / 2;
          const y2 = b.offsetTop;
          const drop = Math.max(18, (y2 - y1) / 2);
          next.push({ id: `e-${a.dataset.node}-${b.dataset.node}`, d: `M${x1},${y1} C${x1},${y1 + drop} ${x2},${y2 - drop} ${x2},${y2}`, tone: "flow", live });
        }
      }
      const answer = box(`${turn?.id}-a`);
      if (answer && !compact) {
        for (const link of citedFrom) {
          const from = box(link.from);
          if (!from) continue;
          const x1 = from.x + from.w / 2;
          const y1 = from.y + from.h;
          const x2 = answer.x + answer.w / 2;
          const y2 = answer.y + answer.h;
          const depth = Math.min(64, 22 + Math.abs(x2 - x1) * 0.08);
          next.push({ id: `c-${link.from}`, d: `M${x1},${y1} C${x1},${y1 + depth} ${x2},${y2 + depth} ${x2},${y2}`, tone: link.tone, live: false });
        }
      }
      setEdges(next);
      setSize({ width: element.scrollWidth, height: element.scrollHeight });
    };
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(frame);
    element.querySelectorAll("[data-node]").forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [nodes, thinking, compact, citedFrom, turn, zoom, tall]);

  // pergunta nova começa do topo: a rolagem da pergunta anterior escondia os primeiros passos
  const turnId = turn?.id;
  useLayoutEffect(() => {
    viewport.current?.scrollTo({ top: 0, left: 0 });
  }, [turnId]);

  // a área ampliada volta ao normal quando a trilha é recolhida
  useEffect(() => { if (compact) setTall(false); }, [compact]);

  const shownScale = zoom ?? autoScale;
  const stepZoom = (delta: number) => setZoom(Math.round(Math.min(1.4, Math.max(0.5, shownScale + delta)) * 100) / 100);

  // segue o nó mais novo
  useLayoutEffect(() => {
    const inner = track.current;
    const element = viewport.current;
    if (!inner || !element) return;
    const newest = inner.querySelector<HTMLElement>("[data-node]:last-of-type");
    if (!newest) return;
    const scale = Number(element.dataset.scale || 1);
    // sem animação: o cursor desenha o bloco logo em seguida e não pode perseguir um alvo em movimento
    // ao recolher, a rolagem vertical da trilha em linhas precisa voltar ao topo, senão a faixa fica vazia
    if (compact) element.scrollTo({ top: 0, left: Math.max(0, newest.offsetLeft + newest.offsetWidth - element.clientWidth + 40) });
    else if ((newest.offsetTop + newest.offsetHeight) * scale > element.scrollTop + element.clientHeight - 12) element.scrollTo({ top: Math.max(0, newest.offsetTop * scale - 14) });
  }, [nodes.length, thinking, compact]);

  const steps = nodes.filter((node) => node.kind === "search" || node.kind === "read" || node.kind === "web").length;
  const seconds = turn ? (turn.elapsed / 1000).toFixed(1).replace(".", ",") : "0";

  return (
    <section className={`investigation ${compact ? "is-compact" : ""}`} aria-labelledby="investigation-title">
      <header className="investigation-head">
        <h2 id="investigation-title">Investigação ao vivo</h2>
        {turn && <p className="investigation-meta">{turn.status === "running" ? (thinking ? `Pensando, etapa ${turn.step}` : "Usando ferramentas") : `${steps} ${steps === 1 ? "ação" : "ações"} em ${seconds} s`}</p>}
        <span className="toolbar-gap" />
        {turn && !compact && (
          <div className="zoom-control" role="group" aria-label="Zoom da investigação">
            <button type="button" onClick={() => stepZoom(-0.1)} disabled={shownScale <= 0.5} aria-label="Diminuir zoom"><Icon name="minus" size={15} /></button>
            <button type="button" className={`zoom-value ${zoom === null ? "is-auto" : ""}`} onClick={() => setZoom(null)} title="Ajustar para caber">
              {zoom === null ? "Ajustar" : `${Math.round(zoom * 100)}%`}
            </button>
            <button type="button" onClick={() => stepZoom(0.1)} disabled={shownScale >= 1.4} aria-label="Aumentar zoom"><Icon name="plus" size={15} /></button>
          </div>
        )}
        {turn && !compact && (
          <button type="button" className="ghost-button icon-only" onClick={() => setTall((value) => !value)} aria-pressed={tall} aria-label={tall ? "Voltar a área ao tamanho normal" : "Ampliar a área da investigação"} title={tall ? "Tamanho normal" : "Ampliar"}>
            <Icon name={tall ? "shrink" : "grow"} size={16} />
          </button>
        )}
        {turn && turn.status !== "running" && turn.events.length > 0 && (
          <button type="button" className="ghost-button" onClick={onReplay} disabled={replaying}><Icon name="replay" size={16} />{replaying ? "Revendo" : "Rever"}</button>
        )}
        {turn && (
          <button type="button" className="ghost-button icon-only" onClick={onToggleCompact} aria-label={compact ? "Expandir investigação" : "Recolher investigação"} aria-pressed={!compact}>
            <Icon name={compact ? "expand" : "collapse"} size={16} />
          </button>
        )}
      </header>

      {!turn ? (
        <div className="investigation-empty">
          <p>Cada busca, página aberta e pesquisa na web que o Aster fizer aparece aqui, no momento em que acontece.</p>
        </div>
      ) : (
        <div className="track-viewport" ref={viewport}>
        <div className="track" ref={track}>
          <svg className="track-edges" width={size.width} height={size.height} aria-hidden="true">
            {edges.map((edge) => (
              <g key={edge.id} className={`edge edge-${edge.tone} ${edge.live ? "is-live" : ""}`}>
                <motion.path id={edge.id} d={edge.d} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: edge.tone === "flow" ? 0.6 : 0.9, ease, delay: edge.tone === "flow" ? 0 : 0.3 }} />
                {edge.live && (
                  <text className="edge-glyphs" dy="4">
                    <textPath href={`#${edge.id}`} startOffset="0%">
                      * + · : *
                      <animate attributeName="startOffset" from="-20%" to="100%" dur="1.3s" repeatCount="indefinite" />
                    </textPath>
                  </text>
                )}
              </g>
            ))}
          </svg>
          <AnimatePresence initial={false}>
            {nodes.map((node) => {
              const isLast = node === last;
              const clickable = node.kind === "read" || node.kind === "web" || node.kind === "search";
              const tone = node.kind === "answer" ? "is-answer" : node.kind === "stop" ? `is-stop is-${node.tone}` : node.kind === "check" && node.ok === false ? "is-warn" : node.kind === "web" ? "is-web" : "";
              const intent = "intent" in node ? node.intent : "";
              return (
                <Drawable
                  key={node.id}
                  tag="article"
                  target={`node-${node.id}`}
                  enabled={live}
                  radius={compact ? 999 : 18}
                  data-node={node.id}
                  className={`trace-node node-${node.kind} ${tone} ${isLast && turn.status === "running" ? "is-current" : ""}`}
                >
                  {clickable ? (
                    <button type="button" className="node-hit" onClick={() => onOpenNode(node)} aria-label={`Abrir ${nodeTitle(node).toLowerCase()}: ${shortLabel(node)}`} />
                  ) : null}
                  <header className="node-head">
                    <span className="node-icon"><Icon name={nodeIcon(node)} size={compact ? 15 : 16} /></span>
                    <span className="node-title">{compact ? shortLabel(node) : nodeTitle(node)}</span>
                  </header>
                  {!compact && (
                    <div className="node-body">
                      {intent && <p className="node-intent">{intent}</p>}
                      <NodeBody node={node} materials={materials} />
                    </div>
                  )}
                </Drawable>
              );
            })}
            {thinking && (
              <motion.article
                key="thinking"
                data-node={`${turn.id}-think`}
                data-cursor="thinking"
                className="trace-node node-thinking"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
                transition={{ type: "spring", duration: 0.5, bounce: 0.2 }}
              >
                <header className="node-head">
                  <Mascot mood="thinking" size={compact ? 20 : 30} />
                  <span className="node-title">Pensando</span>
                </header>
                {!compact && <div className="node-body"><p className="node-meta">Decidindo o próximo passo</p><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span></div>}
              </motion.article>
            )}
          </AnimatePresence>
        </div>
        </div>
      )}
    </section>
  );
}
