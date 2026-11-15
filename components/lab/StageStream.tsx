"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { Icon } from "../Icon";
import type { LabRun } from "./StageAgent";

const COLORS: Record<string, string> = {
  run_started: "#9db8de", agent_thinking: "#9db8de", agent_thought: "#9db8de", tool_call: "#d5ff6e", search_results: "#d5ff6e", page_read: "#d5ff6e",
  web_results: "#ff9b57", answer_check: "#7ee08f", answer_ready: "#7ee08f", model_fallback: "#ffd66b", run_failed: "#ff9d92", insufficient_evidence: "#ff9d92",
};

const PYDANTIC = `class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    context: list[ConversationTurn] = Field(default_factory=list, max_length=8)
    memory: list[str] = Field(default_factory=list, max_length=12)`;

const ENDPOINT = `@app.post("/api/tutor/runs")
async def run_tutor(request: AskRequest):
    async def events():
        yield emit("run_started", {...})
        async for chunk in run_agent(request, emit):
            yield chunk          # "data: {json}\\n\\n"
    return StreamingResponse(with_heartbeat(events()),
                             media_type="text/event-stream")`;

export function StageStream({ run, onRun, deep = false }: { run: LabRun; onRun: () => void; deep?: boolean }) {
  const terminal = useRef<HTMLPreElement>(null);
  const lines = useMemo(() => (run.raw.length ? run.raw : run.events.map((event) => `data: ${JSON.stringify(event)}`)), [run.raw, run.events]);
  const total = Math.max(1, ...run.events.map((event) => event.t));

  useEffect(() => { terminal.current?.scrollTo({ top: terminal.current.scrollHeight }); }, [lines.length]);

  // simples: só a linha do tempo, com legenda em português; o código e o fluxo cru ficam em "por dentro"
  if (!deep) {
    const seconds = run.events.length ? (total / 1000).toFixed(1).replace(".", ",") : "0";
    return (
      <div className="lab-card stream-simple">
        <div className="sheet-row">
          <h3>{run.events.length ? `${run.events.length} mensagens em ${seconds} s, todas pela mesma conexão` : "Rode uma pergunta e veja as mensagens chegando"}</h3>
          <button type="button" className="secondary-button" onClick={onRun} disabled={run.status === "running"}><Icon name="play" size={15} />{run.status === "running" ? "Recebendo" : "Rodar ao vivo"}</button>
        </div>
        <div className="timeline is-big" aria-label="Mensagens ao longo do tempo">
          {run.events.map((event) => (
            <motion.span key={event.seq} className="timeline-tick" style={{ left: `${(event.t / total) * 100}%`, background: COLORS[event.type] ?? "#9db8de" }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} />
          ))}
        </div>
        <ul className="stream-legend">
          <li><i style={{ background: "#9db8de" }} />pensando</li>
          <li><i style={{ background: "#d5ff6e" }} />pesquisando nas aulas</li>
          <li><i style={{ background: "#ff9b57" }} />pesquisando na web</li>
          <li><i style={{ background: "#7ee08f" }} />resposta pronta</li>
        </ul>
        <p className="lab-note">Cada risco é uma mensagem que chegou na tela. Os espaços vazios são a IA pensando: por isso a tela mostra cada passo na hora, em vez de deixar você esperando no escuro.</p>
      </div>
    );
  }

  return (
    <div className="stream-grid">
      <div className="stream-code">
        <div className="lab-card">
          <h3>Pydantic valida a pergunta (Aula 7, p. 16)</h3>
          <pre className="code-block">{PYDANTIC}</pre>
          <p className="lab-note">Pergunta vazia ou com mais de 500 caracteres volta com erro 400 e uma mensagem em português, antes de chegar ao modelo.</p>
        </div>
        <div className="lab-card">
          <h3>StreamingResponse com um gerador assíncrono (p. 22)</h3>
          <pre className="code-block">{ENDPOINT}</pre>
          <p className="lab-note">Enquanto o modelo pensa, o servidor manda “: ping” a cada 6 s para a conexão não cair.</p>
        </div>
      </div>
      <div className="lab-card">
        <div className="sheet-row">
          <h3>Linha do tempo da consulta</h3>
          <button type="button" className="secondary-button" onClick={onRun} disabled={run.status === "running"}><Icon name="play" size={15} />{run.status === "running" ? "Recebendo" : "Rodar ao vivo"}</button>
        </div>
        <div className="timeline" aria-label="Eventos ao longo do tempo">
          {run.events.map((event) => (
            <motion.span key={event.seq} className="timeline-tick" style={{ left: `${(event.t / total) * 100}%`, background: COLORS[event.type] ?? "#9db8de" }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} title={`${event.type} em ${event.t} ms`} />
          ))}
        </div>
        <p className="lab-note">Cada risco é um evento enviado pela mesma conexão HTTP. Os vazios são o tempo do modelo pensando: o desafio da latência da p. 18, e o motivo de mostrar cada passo assim que acontece.</p>
        <pre className="terminal" ref={terminal}>
          {lines.length === 0 && <span className="dim">Nenhum evento ainda. Rode a consulta para ver o fluxo cru.</span>}
          {lines.map((line, index) => <span key={index} className={line.startsWith(":") ? "dim" : ""}>{line.length > 220 ? `${line.slice(0, 220)}…` : line}{"\n"}</span>)}
        </pre>
        {!run.live && run.events.length > 0 && <p className="lab-note">Eventos da última consulta feita em Estudar. Para ver também os “: ping”, rode ao vivo.</p>}
      </div>
    </div>
  );
}
