"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { Landscape } from "@/components/Landscape";
import { TopBar } from "@/components/TopBar";
import { StageAgent, type LabRun } from "@/components/lab/StageAgent";
import { StageEmbeddings } from "@/components/lab/StageEmbeddings";
import { StageEval } from "@/components/lab/StageEval";
import { StageIngest } from "@/components/lab/StageIngest";
import { StageNlp } from "@/components/lab/StageNlp";
import { StageReranker, type RQuery } from "@/components/lab/StageReranker";
import { StageSearch } from "@/components/lab/StageSearch";
import { StageStream } from "@/components/lab/StageStream";
import { lectureLabel, type RunEvent } from "@/lib/aster";
import { labGet, recallQuestion, recallRun, STAGES, TALK, type SearchResult, type StageId } from "@/lib/lab";

export default function Laboratorio() {
  const [stageId, setStageId] = useState<StageId>("ingestao");
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState("");
  const [run, setRun] = useState<LabRun>({ question: "", events: [], raw: [], status: "idle", live: false });
  const [neural, setNeural] = useState<((query: RQuery) => number | null) | null>(null);
  const [relevance, setRelevance] = useState<RQuery[] | null>(null);
  const runAbort = useRef<AbortController | null>(null);
  // roteiro de fala: fica ligado por padrão e a escolha é lembrada neste navegador
  const [script, setScript] = useState(true);

  useEffect(() => () => runAbort.current?.abort(), []);

  useEffect(() => {
    try { if (localStorage.getItem("aster:roteiro") === "0") setScript(false); } catch { /* sem armazenamento, fica ligado */ }
  }, []);

  const toggleScript = () => setScript((value) => {
    try { localStorage.setItem("aster:roteiro", value ? "0" : "1"); } catch { /* idem */ }
    return !value;
  });

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requested = parameters.get("etapa");
    if (requested && STAGES.some((stage) => stage.id === requested)) setStageId(requested as StageId);
    const initial = parameters.get("q") || recallQuestion();
    setQuestion(initial);
    setDraft(initial);
  }, []);

  useEffect(() => {
    if (!question) return;
    runAbort.current?.abort();
    setSearch(null);
    setSearchError("");
    labGet<SearchResult>(`/api/lab/search?q=${encodeURIComponent(question)}&limit=10`).then(setSearch).catch((problem: Error) => setSearchError(problem.message));
    const previous = recallRun();
    setRun(previous && previous.question === question ? { question, events: previous.events, raw: [], status: "done", live: false } : { question, events: [], raw: [], status: "idle", live: false });
  }, [question]);

  const select = (id: StageId) => {
    setStageId(id);
    window.history.replaceState(null, "", `/laboratorio?etapa=${id}`);
  };

  const analyze = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length >= 3) setQuestion(text);
  };

  // roda a pergunta no agente de verdade e guarda as linhas cruas do SSE
  const runAgent = useCallback(async () => {
    runAbort.current?.abort();
    const abort = new AbortController();
    runAbort.current = abort;
    setRun({ question, events: [], raw: [], status: "running", live: true });
    try {
      const response = await fetch("/api/tutor/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }), signal: abort.signal });
      if (!response.ok || !response.body) throw new Error("Não consegui falar com a API do Aster.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line) continue;
          const parsed = line.startsWith("data: ") ? (JSON.parse(line.slice(6)) as RunEvent) : null;
          setRun((current) => ({ ...current, raw: [...current.raw, line], events: parsed ? [...current.events, parsed] : current.events }));
        }
      }
      setRun((current) => ({ ...current, status: "done" }));
    } catch (problem) {
      if (abort.signal.aborted) return;
      setRun((current) => ({ ...current, status: "error", message: (problem as Error).message }));
    }
  }, [question]);

  const onModel = useCallback((rank: ((query: RQuery) => number | null) | null) => setNeural(() => rank), []);
  const onData = useCallback((queries: RQuery[]) => setRelevance(queries), []);

  const index = STAGES.findIndex((stage) => stage.id === stageId);
  const stage = STAGES[index];
  const next = STAGES[index + 1];
  const previous = STAGES[index - 1];
  const talk = TALK[stageId];

  // setas do teclado trocam de etapa, como num controle de slides
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      const target_stage = move ? STAGES[index + move] : null;
      if (target_stage) { event.preventDefault(); select(target_stage.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index]);

  return (
    <div className="lab">
      <Landscape dim />
      <TopBar current="/laboratorio" />
      <main className="lab-main xray">
        <h1 className="visually-hidden">Laboratório: por dentro do Aster</h1>
        <form className="xray-question" onSubmit={analyze}>
          <label htmlFor="xray-q">Pergunta em análise</label>
          <input id="xray-q" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} placeholder="Digite uma pergunta para ver o caminho dela no Aster" />
          <button type="submit" className="primary-button small" disabled={draft.trim().length < 3 || draft.trim() === question}>Analisar</button>
          <Link className="secondary-button" href="/">Perguntar no Estudar</Link>
        </form>

        <nav className="xray-track" aria-label="Etapas do caminho da pergunta">
          {STAGES.map((item, position) => (
            <button key={item.id} type="button" className="xray-step" aria-pressed={item.id === stageId} onClick={() => select(item.id)}>
              {item.id === stageId && <motion.span className="xray-pill" layoutId="xray-pill" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <span className="xray-n">{position + 1}</span>
              <span className="xray-text"><strong>{TALK[item.id].plain}</strong><small>{item.title}</small></span>
            </button>
          ))}
        </nav>

        <section className="lab-panel" aria-labelledby="stage-title">
          <header className="lab-head">
            <div>
              <p className="stage-kicker">Etapa {index + 1} de {STAGES.length} · {stage.title} · {stage.lecture}</p>
              <h2 id="stage-title">{stage.question}</h2>
            </div>
            <div className="lab-refs">
              {stage.refs.map((ref) => (
                <Link key={`${ref.document_id}-${ref.page}`} className="chip chip-aula" href={`/?source=${ref.document_id}&page=${ref.page}`} title={lectureLabel(ref.document_id, ref.page)}>
                  <Icon name="page" size={14} />{ref.label}
                </Link>
              ))}
            </div>
          </header>
          <AnimatePresence mode="wait" initial={false}>
            {script ? (
              <motion.aside key={`talk-${stageId}`} className="talk" aria-label="Roteiro de fala desta etapa" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <div className="talk-say">
                  <span className="talk-label">Em uma frase</span>
                  <p>{talk.say}</p>
                </div>
                <div className="talk-like">
                  <span className="talk-label">Comparação</span>
                  <p>{talk.like}</p>
                </div>
                <div className="talk-point">
                  <span className="talk-label">O que mostrar na tela</span>
                  <ol>{talk.point.map((item, position) => <li key={item}><span>{position + 1}</span>{item}</li>)}</ol>
                </div>
                <button type="button" className="talk-toggle" onClick={toggleScript} aria-label="Esconder o roteiro de fala"><Icon name="close" size={15} /></button>
              </motion.aside>
            ) : (
              <motion.button key="talk-off" type="button" className="talk-show" onClick={toggleScript} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Icon name="chat" size={15} />Mostrar o roteiro de fala
              </motion.button>
            )}
          </AnimatePresence>
          {searchError && <p className="sheet-error">{searchError}</p>}
          <AnimatePresence mode="wait">
            <motion.div key={stageId} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}>
              {stageId === "ingestao" && <StageIngest search={search} />}
              {stageId === "pln" && question && <StageNlp question={question} />}
              {stageId === "busca" && <StageSearch search={search} question={question} />}
              {stageId === "embeddings" && question && <StageEmbeddings question={question} />}
              {stageId === "reranker" && <StageReranker onModel={onModel} onData={onData} />}
              {stageId === "agente" && <StageAgent run={run} onRun={runAgent} />}
              {stageId === "streaming" && <StageStream run={run} onRun={runAgent} />}
              {stageId === "avaliacao" && <StageEval neural={neural} relevance={relevance} />}
            </motion.div>
          </AnimatePresence>
          <footer className="stage-nav">
            {previous ? <button type="button" className="secondary-button" onClick={() => select(previous.id)}><Icon name="left" size={16} />{TALK[previous.id].plain}</button> : <span />}
            <span className="stage-keys" aria-hidden="true">← → trocam de etapa</span>
            {next && <button type="button" className="primary-button small" onClick={() => select(next.id)}>Próxima: {TALK[next.id].plain}<Icon name="right" size={16} /></button>}
          </footer>
        </section>
      </main>
    </div>
  );
}
