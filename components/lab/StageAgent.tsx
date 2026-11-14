"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { lectureLabel, type RunEvent, providerLabel } from "@/lib/aster";
import { labGet } from "@/lib/lab";

type AgentInfo = { system_prompt: string; tools: { name: string; description: string; parameters: unknown }[]; max_steps: number; chain: { provider: string; model: string }[] };
export type LabRun = { question: string; events: RunEvent[]; raw: string[]; status: "idle" | "running" | "done" | "error"; live: boolean; message?: string };

// As quatro partes de um bom system prompt, na Aula 6, p. 8, mais o contexto injetado (p. 37)
const PARTS = [
  { kind: "papel", label: "Papel", phrases: ["Você é o Aster, um agente de estudos simpático da disciplina de Inteligência Artificial do professor Daniel Cavalcante (SENAC)."] },
  { kind: "restricao", label: "Restrições", phrases: ["somente ids que você recebeu das ferramentas nesta conversa", "Não invente fatos.", "sem_base: só quando nem as aulas nem a web sustentarem uma resposta, ou o pedido for inadequado."] },
  { kind: "formato", label: "Formato", phrases: ["em 1 a 3 blocos curtos", "Cada bloco cita os ids que o sustentam (trechos das aulas ou web-N)"] },
  { kind: "tom", label: "Tom", phrases: ["como um bom monitor explicaria a um colega", "responda de forma breve e calorosa"] },
  { kind: "contexto", label: "Contexto", phrases: ["Aulas disponíveis:"] },
];

function annotate(prompt: string) {
  const marks: { start: number; end: number; kind: string; label: string }[] = [];
  for (const part of PARTS) for (const phrase of part.phrases) {
    const start = prompt.indexOf(phrase);
    if (start >= 0) marks.push({ start, end: part.kind === "contexto" ? prompt.length : start + phrase.length, kind: part.kind, label: part.label });
  }
  marks.sort((a, b) => a.start - b.start);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    nodes.push(prompt.slice(cursor, mark.start));
    nodes.push(<mark key={mark.start} className={`prompt-${mark.kind}`} title={mark.label}>{prompt.slice(mark.start, mark.end)}</mark>);
    cursor = mark.end;
  }
  nodes.push(prompt.slice(cursor));
  return nodes;
}

type Step = { kind: "thought" | "action" | "observation" | "answer" | "problem"; title: string; body: React.ReactNode; t: number };

function reactSteps(events: RunEvent[]): Step[] {
  const steps: Step[] = [];
  for (const event of events) {
    const data = event.data;
    if (event.type === "tool_call") {
      const { intencao, ...args } = data.args ?? {};
      if (intencao) steps.push({ kind: "thought", title: "Thought", body: intencao, t: event.t });
      if (data.tool !== "responder" && data.tool !== "conversar") steps.push({ kind: "action", title: `Action: ${data.tool}`, body: <code>{JSON.stringify(args)}</code>, t: event.t });
    } else if (event.type === "search_results") {
      const pages = Array.from(new Set((data.hits ?? []).map((hit: { document_id: string; page: number }) => lectureLabel(hit.document_id, hit.page))));
      steps.push({ kind: "observation", title: "Observation", body: pages.length ? `${data.hits.length} trechos: ${pages.join(", ")}` : "nenhum trecho encontrado", t: event.t });
    } else if (event.type === "page_read") {
      steps.push({ kind: "observation", title: "Observation", body: `leu ${lectureLabel(data.document_id, data.page)}: “${data.heading}”, ${(data.passages ?? []).length} trechos citáveis`, t: event.t });
    } else if (event.type === "web_results") {
      steps.push({ kind: "observation", title: "Observation", body: `${(data.results ?? []).length} fontes da web via ${providerLabel(data.provider)}`, t: event.t });
    } else if (event.type === "answer_check") {
      steps.push({ kind: data.ok ? "observation" : "problem", title: data.ok ? "Verificação do servidor" : "Resposta recusada", body: data.message, t: event.t });
    } else if (event.type === "answer_ready") {
      steps.push({ kind: "answer", title: "Final answer", body: (data.blocks ?? []).map((block: { text: string }) => block.text).join(" "), t: event.t });
    } else if (event.type === "model_fallback") {
      steps.push({ kind: "problem", title: "Troca de modelo", body: data.message, t: event.t });
    } else if (event.type === "run_failed" || event.type === "insufficient_evidence") {
      steps.push({ kind: "problem", title: "Fim", body: data.message, t: event.t });
    }
  }
  return steps;
}

export function StageAgent({ run, onRun }: { run: LabRun; onRun: () => void }) {
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"prompt" | "tools">("prompt");
  useEffect(() => { labGet<AgentInfo>("/api/lab/agent").then(setInfo).catch((problem: Error) => setError(problem.message)); }, []);
  const steps = useMemo(() => reactSteps(run.events), [run.events]);

  return (
    <div className="agent-grid">
      <div className="lab-card">
        <div className="sheet-row">
          <div className="lab-segment compact">
            <button type="button" aria-pressed={tab === "prompt"} onClick={() => setTab("prompt")}>System prompt</button>
            <button type="button" aria-pressed={tab === "tools"} onClick={() => setTab("tools")}>Ferramentas ({info?.tools.length ?? 0})</button>
          </div>
        </div>
        {error && <p className="sheet-error">{error}</p>}
        {info && tab === "prompt" && (
          <>
            <p className="prompt-legend">{PARTS.map((part) => <span key={part.kind} className={`prompt-${part.kind}`}>{part.label}</span>)}</p>
            <pre className="prompt-text">{annotate(info.system_prompt)}</pre>
          </>
        )}
        {info && tab === "tools" && (
          <>
            <p className="lab-note">É assim que o function calling funciona (Aula 10, p. 13): o Aster declara cada ferramenta com nome, descrição e esquema JSON. O modelo não executa nada; ele devolve um JSON pedindo a chamada, e o servidor executa.</p>
            <ul className="tool-list">
              {info.tools.map((tool) => (
                <li key={tool.name}>
                  <strong>{tool.name}</strong>
                  <p>{tool.description}</p>
                  <pre>{JSON.stringify(tool.parameters, null, 2)}</pre>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="lab-card">
        <div className="sheet-row">
          <h3>Ciclo ReAct desta pergunta</h3>
          <button type="button" className="secondary-button" onClick={onRun} disabled={run.status === "running"}><Icon name="play" size={15} />{run.status === "running" ? "Rodando" : run.events.length ? "Rodar de novo" : "Rodar o agente"}</button>
        </div>
        <p className="lab-note">Pensamento, ação e observação se alternam até a resposta (Aula 10, p. 9). {run.events.length && !run.live ? "Mostrando a última consulta feita na tela Estudar." : ""} {info ? `Até ${info.max_steps} passos.` : ""}</p>
        {run.message && <p className="sheet-error">{run.message}</p>}
        {steps.length === 0 && run.status !== "running" && <p className="lab-note">Rode o agente para ver cada decisão dele com esta pergunta.</p>}
        <ol className="react-steps">
          {steps.map((step, index) => (
            <motion.li key={`${step.t}-${index}`} className={`react-${step.kind}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: run.live ? 0 : index * 0.07 }}>
              <span className="react-tag">{step.title}</span>
              <span className="react-body">{step.body}</span>
              <span className="react-time">{(step.t / 1000).toFixed(1).replace(".", ",")} s</span>
            </motion.li>
          ))}
          {run.status === "running" && <li className="react-thought"><span className="react-tag">Thought</span><span className="react-body shimmer">pensando</span></li>}
        </ol>
      </div>
    </div>
  );
}
