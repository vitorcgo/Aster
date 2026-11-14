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
import { labGet, recallQuestion, recallRun, STAGES, type SearchResult, type StageId } from "@/lib/lab";

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

  useEffect(() => () => runAbort.current?.abort(), []);

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
              <span className="xray-text"><strong>{item.title}</strong><small>{item.lecture}</small></span>
            </button>
          ))}
        </nav>

        <section className="lab-panel" aria-labelledby="stage-title">
          <header className="lab-head">
            <div>
              <p className="stage-kicker">Etapa {index + 1} de {STAGES.length}</p>
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
            {previous ? <button type="button" className="secondary-button" onClick={() => select(previous.id)}><Icon name="left" size={16} />{previous.title}</button> : <span />}
            {next && <button type="button" className="primary-button small" onClick={() => select(next.id)}>Próxima: {next.title}<Icon name="right" size={16} /></button>}
          </footer>
        </section>
      </main>
    </div>
  );
}
