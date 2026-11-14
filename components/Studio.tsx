"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AsterCursor, type CursorGesture, type CursorState } from "./AsterCursor";
import { Composer } from "./Composer";
import { DocumentDeck, pageTabId, type DocTab } from "./DocumentDeck";
import { Investigation } from "./Investigation";
import { Landscape } from "./Landscape";
import { Mascot, type MascotMood } from "./Mascot";
import { Thread } from "./Thread";
import { TopBar } from "./TopBar";
import { forgetDrawn, waitForDrawn } from "@/lib/draw";
import { rememberRun } from "@/lib/lab";
import { applyEvent, eventDwell, lectureLabel, newTurn, type LectureSource, type Material, type PagePayload, type RunEvent, type Source, type TraceNode, type Turn } from "@/lib/aster";

const SUGGESTIONS = [
  "Qual é o papel dos embeddings em um RAG?",
  "O que é overfitting e como evitar?",
  "Como funciona o Teste de Turing?",
  "O que é cold start em sistemas de recomendação?",
];

const MAX_TABS = 8;

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

const SESSION_KEY = "aster:studio";

type SavedSession = { turns: Turn[]; tabs: DocTab[]; activeTab: string | null; activeTurnId: string | null };

function readSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedSession;
    // uma resposta que estava chegando quando a página recarregou não volta sozinha
    saved.turns = saved.turns.map((turn) => (turn.status === "running" ? { ...turn, status: "failed", thinking: false, message: "A página recarregou antes de a resposta terminar. Pergunte de novo." } : turn));
    return saved;
  } catch {
    return null;
  }
}

function gate(ref: { current: (() => void) | null }, timeout: number) {
  return Promise.race([new Promise<void>((resolve) => { ref.current = resolve; }), sleep(timeout)]).finally(() => { ref.current = null; });
}

export function Studio({ active = true }: { active?: boolean }) {
  const [restored] = useState(readSession);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>(() => restored?.turns ?? []);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(() => restored?.activeTurnId ?? null);
  const [tabs, setTabs] = useState<DocTab[]>(() => restored?.tabs ?? []);
  const [activeTab, setActiveTab] = useState<string | null>(() => restored?.activeTab ?? null);
  const [focus, setFocus] = useState<{ sourceId: string; turnId: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cursor, setCursor] = useState<CursorState>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [drawTab, setDrawTab] = useState<string | null>(null);
  const [stagingId, setStagingId] = useState<string | null>(null);

  const turnsRef = useRef<Turn[]>([]);
  const controller = useRef<AbortController | null>(null);
  const queue = useRef<{ event: RunEvent; turnId: string; token: number }[]>([]);
  const draining = useRef(false);
  const token = useRef(0);
  const renderGate = useRef<(() => void) | null>(null);
  const evidenceGate = useRef<(() => void) | null>(null);
  const cursorKey = useRef(0);
  const renderedKey = useRef<string | null>(null);
  const tabsRef = useRef<DocTab[]>([]);
  const evidenceSeen = useRef(false);
  const replayPoll = useRef(0);

  useEffect(() => () => { window.clearInterval(replayPoll.current); controller.current?.abort(); }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ turns: turns.slice(-12), tabs, activeTab, activeTurnId } satisfies SavedSession));
    } catch {
      // sem armazenamento a sessão ainda sobrevive à navegação, só não a um recarregamento
    }
  }, [turns, tabs, activeTab, activeTurnId]);

  turnsRef.current = turns;
  tabsRef.current = tabs;

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = (attempt: number) => {
      fetch("/api/materials")
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((list: Material[]) => { if (alive) setMaterials(list); })
        .catch(() => { if (alive && attempt < 20) timer = window.setTimeout(() => load(attempt + 1), 3000); });
    };
    load(0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);

  // Link vindo dos simulados ou do laboratório: /?source=aula-6&page=23&q=...
  useEffect(() => {
    if (!active) return;
    const parameters = new URLSearchParams(window.location.search);
    const documentId = parameters.get("source");
    const page = Number(parameters.get("page"));
    if (!documentId || !Number.isInteger(page) || page < 1) return;
    // limpa o endereço para a revisão não se repetir na próxima visita
    window.history.replaceState(null, "", "/");
    fetch(`/api/materials/${encodeURIComponent(documentId)}/pages/${page}?query=${encodeURIComponent(parameters.get("q") ?? "")}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: PagePayload | null) => {
        if (!payload) return;
        const id = pageTabId(payload.document_id, payload.page);
        openTab({ id, kind: "page", page: payload });
        const passage = payload.passages[0];
        const pseudo = newTurn(`review-${Date.now()}`, parameters.get("q") ? `Revisão: ${parameters.get("q")}` : `Revisão de ${lectureLabel(payload.document_id, payload.page)}`);
        if (passage) {
          setFocus({ sourceId: passage.id, turnId: pseudo.id });
          const review: Turn = { ...pseudo, status: "answered", thinking: false, mode: null, chat: true, blocks: [{ text: `Abri ${lectureLabel(payload.document_id, payload.page)} para você revisar. O trecho marcado é o que sustenta a resposta. Pergunte o que quiser sobre ele.`, citation_ids: [passage.id] }], sources: [passage], seen: { [passage.id]: passage } };
          turnsRef.current = [...turnsRef.current, review];
          setTurns(turnsRef.current);
        }
      })
      .catch(() => {});
    // openTab é estável; o efeito roda a cada vez que o Estudar volta a ficar visível
  }, [active]);

  const point = useCallback((target: string, label: string, gesture: CursorGesture = "point") => {
    cursorKey.current += 1;
    setCursor({ target, label, gesture, key: cursorKey.current });
  }, []);

  const updateTurn = useCallback((turnId: string, update: (turn: Turn) => Turn) => {
    setTurns((list) => list.map((turn) => (turn.id === turnId ? update(turn) : turn)));
  }, []);

  const openTab = useCallback((tab: DocTab) => {
    setTabs((list) => {
      const exists = list.some((item) => item.id === tab.id);
      const next = exists ? list.map((item) => (item.id === tab.id ? tab : item)) : [...list, tab];
      return next.slice(-MAX_TABS);
    });
    setActiveTab(tab.id);
  }, []);

  const pageFor = useCallback(async (source: LectureSource, turn?: Turn): Promise<PagePayload | null> => {
    const read = turn?.nodes.find((node) => node.kind === "read" && node.aula === source.document_id && node.page === source.page && node.payload) as Extract<TraceNode, { kind: "read" }> | undefined;
    if (read?.payload) return read.payload;
    const open = tabs.find((tab) => tab.id === pageTabId(source.document_id, source.page));
    if (open?.kind === "page") return open.page;
    try {
      const response = await fetch(`/api/materials/${encodeURIComponent(source.document_id)}/pages/${source.page}`);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }, [tabs]);

  /** Encena um evento real: atualiza o estado e o cursor constrói o que mudou. Resolve quando a cena termina. */
  const stage = useCallback(async (event: RunEvent, turnId: string, myToken: number) => {
    const alive = () => myToken === token.current;
    const before = turnsRef.current.find((turn) => turn.id === turnId);
    if (!before) return;
    const after = applyEvent(before, event);
    turnsRef.current = turnsRef.current.map((turn) => (turn.id === turnId ? after : turn));
    updateTurn(turnId, () => after);
    const data = event.data;

    // um bloco novo na investigação: o cursor desenha
    const drawNode = async (nodeId: string, label: string) => {
      await sleep(30);
      point(`node-${nodeId}`, label, "draw");
      await waitForDrawn(`node-${nodeId}`);
    };
    // uma fonte nova no painel de documentos: o cursor desenha a moldura
    const drawSheet = async (tab: DocTab, label: string) => {
      setDrawTab(tab.id);
      openTab(tab);
      await sleep(40);
      point(`sheet-${tab.id}`, label, "draw");
      await waitForDrawn(`sheet-${tab.id}`);
    };

    switch (event.type) {
      case "run_started":
        await drawNode(`${turnId}-q`, "Anotando sua pergunta");
        break;
      case "agent_thinking":
        setScanning(false);
        point("thinking", data.step > 1 ? "Decidindo o próximo passo" : "Pensando");
        break;
      case "tool_call": {
        if (data.tool === "conversar") break;
        const label = data.tool === "buscar_nas_aulas" ? "Montando a busca" : data.tool === "ler_pagina" ? `Vou abrir ${lectureLabel(String(data.args?.aula ?? ""), Number(data.args?.pagina ?? 0))}` : data.tool === "pesquisar_na_web" ? "Montando a pesquisa na web" : data.tool === "responder" ? "Conferindo citações" : "Respondendo";
        await drawNode(String(data.call_id), label);
        break;
      }
      case "search_results": {
        const count = (data.hits ?? []).length;
        point(`node-${data.call_id}`, count ? `${count} trechos encontrados` : "Nada aqui, vou reformular");
        break;
      }
      case "page_read": {
        const node = after.nodes.find((item) => item.id === data.call_id && item.kind === "read") as Extract<TraceNode, { kind: "read" }> | undefined;
        if (!node?.payload) break;
        const id = pageTabId(node.payload.document_id, node.payload.page);
        setFocus(null);
        await drawSheet({ id, kind: "page", page: node.payload }, `Abrindo ${lectureLabel(node.payload.document_id, node.payload.page)}`);
        if (!alive()) return;
        if (renderedKey.current !== id) await gate(renderGate, 2400);
        if (!alive()) return;
        setScanning(true);
        point("doc-page", `Lendo ${lectureLabel(node.payload.document_id, node.payload.page)}`, "read");
        break;
      }
      case "web_results": {
        const node = after.nodes.find((item) => item.id === data.call_id && item.kind === "web") as Extract<TraceNode, { kind: "web" }> | undefined;
        const results = node?.results ?? [];
        setScanning(false);
        await drawSheet({ id: String(data.call_id), kind: "web", query: String(data.query ?? ""), provider: String(data.provider ?? "wikipedia"), results }, "Abrindo a pesquisa");
        if (!alive()) return;
        point(results.length ? `web-${results[0].id}` : "doc", results.length ? `Lendo ${results.length} fontes da web` : "A web não trouxe nada", "read");
        break;
      }
      case "answer_check":
        point(`node-${data.call_id}`, data.ok ? "Fontes conferidas" : "Recusada, corrigindo");
        break;
      case "model_fallback": {
        const fallback = after.nodes.findLast((node) => node.kind === "fallback");
        // se a troca só atualizou o bloco de troca já desenhado, o cursor apenas aponta para ele
        if (fallback && fallback.id !== `fb-${event.seq}`) point(`node-${fallback.id}`, `Tentando ${String(data.model ?? "o reserva")}`);
        else await drawNode(`fb-${event.seq}`, "Trocando para o modelo reserva");
        break;
      }
      case "answer_ready": {
        setScanning(false);
        setHoldId(turnId);
        await drawNode(`${turnId}-a`, after.chat ? "Respondendo" : "Montando a resposta");
        if (!alive()) return;
        if (after.chat || after.sources.length === 0) {
          setHoldId(null);
          setRevealId(turnId);
          point(`answer-${turnId}`, "Escrevendo", "type");
          return;
        }
        const lecture = after.sources.find((source): source is LectureSource => source.kind === "aula");
        const web = after.sources.find((source) => source.kind === "web");
        setCompact(true);
        await sleep(560);
        if (!alive()) return;
        if (lecture) {
          const payload = await pageFor(lecture, after);
          if (!alive()) return;
          if (payload) {
            const id = pageTabId(payload.document_id, payload.page);
            evidenceSeen.current = false;
            setFocus({ sourceId: lecture.id, turnId });
            const known = tabsRef.current.some((tab) => tab.id === id);
            if (known) openTab({ id, kind: "page", page: payload });
            else await drawSheet({ id, kind: "page", page: payload }, "Voltando à fonte");
            if (!alive()) return;
            // o trecho pode ter sido marcado antes de começarmos a esperar
            if (!evidenceSeen.current) await gate(evidenceGate, 3200);
            if (!alive()) return;
            point("evidence", "Selecionando o trecho", "select");
            await sleep(2300);
          }
        } else if (web) {
          const node = after.nodes.find((item) => item.kind === "web" && item.results?.some((result) => result.id === web.id)) as Extract<TraceNode, { kind: "web" }> | undefined;
          if (node?.results) openTab({ id: node.id, kind: "web", query: node.query, provider: node.provider ?? "wikipedia", results: node.results });
          setFocus({ sourceId: web.id, turnId });
          await sleep(350);
          point(`web-${web.id}`, "Marcando a fonte", "click");
          await sleep(1300);
        }
        if (!alive()) return;
        setHoldId(null);
        setRevealId(turnId);
        point(`answer-${turnId}`, "Escrevendo", "type");
        return;
      }
      case "insufficient_evidence":
      case "run_failed":
        setScanning(false);
        await drawNode(`${turnId}-stop`, event.type === "run_failed" ? "Algo falhou" : "Sem base");
        setCursor(null);
        setStagingId(null);
        return;
    }
    await sleep(eventDwell(event));
  }, [openTab, pageFor, point, updateTurn]);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (queue.current.length) {
        const item = queue.current.shift()!;
        if (item.token !== token.current) continue;
        await stage(item.event, item.turnId, item.token);
      }
    } finally {
      draining.current = false;
    }
  }, [stage]);

  const enqueue = useCallback((event: RunEvent, turnId: string, myToken: number) => {
    queue.current.push({ event, turnId, token: myToken });
    void drain();
  }, [drain]);

  const ask = useCallback(async (question: string) => {
    controller.current?.abort();
    const myToken = ++token.current;
    queue.current = [];
    const abort = new AbortController();
    controller.current = abort;
    const turnId = `t${Date.now()}`;
    const context = turnsRef.current
      .filter((turn) => turn.status === "answered" && !turn.id.startsWith("review"))
      .slice(-3)
      .map((turn) => ({ question: turn.question, answer: turn.blocks.map((block) => block.text).join(" ").slice(0, 1800) }));
    const fresh = newTurn(turnId, question);
    turnsRef.current = [...turnsRef.current, fresh];
    setTurns(turnsRef.current);
    setActiveTurnId(turnId);
    setStagingId(turnId);
    setDrawTab(null);
    setDraft("");
    setFocus(null);
    setRevealId(null);
    setHoldId(null);
    setCompact(false);
    setReplaying(false);
    let runId = "";
    try {
      const response = await fetch("/api/tutor/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        // a API responde erros como { detail: { code, message } }; mostra a mensagem dela quando houver
        const body = await response.json().catch(() => null) as { detail?: { message?: string } | string } | null;
        const detail = body?.detail;
        throw new Error(typeof detail === "object" && detail?.message ? detail.message : typeof detail === "string" ? detail : "Não consegui falar com a API do Aster.");
      }
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
          const line = part.split("\n").find((row) => row.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as RunEvent;
          if (!runId) runId = event.run_id;
          if (event.run_id !== runId) continue;
          updateTurn(turnId, (turn) => ({ ...turn, events: [...turn.events, event] }));
          turnsRef.current = turnsRef.current.map((turn) => (turn.id === turnId ? { ...turn, events: [...turn.events, event] } : turn));
          enqueue(event, turnId, myToken);
        }
      }
      // o Laboratório reaproveita esta consulta sem chamar o modelo de novo
      rememberRun(question, turnsRef.current.find((turn) => turn.id === turnId)?.events ?? []);
    } catch (error) {
      if (abort.signal.aborted) return;
      // se a resposta final já chegou, uma queda depois disso não importa
      const finished = turnsRef.current.find((turn) => turn.id === turnId)?.events.some((event) => ["answer_ready", "insufficient_evidence", "run_failed"].includes(event.type));
      if (finished) return;
      const message = error instanceof TypeError ? "A conexão com a API caiu no meio da pesquisa. Tente de novo." : error instanceof Error ? error.message : "A consulta falhou.";
      enqueue({ run_id: runId || "local", seq: 999, t: 0, type: "run_failed", data: { code: "network", message } }, turnId, myToken);
    }
  }, [enqueue, point, updateTurn]);

  const stop = useCallback(() => {
    controller.current?.abort();
    token.current++;
    queue.current = [];
    const running = turnsRef.current.find((turn) => turn.status === "running");
    if (running) updateTurn(running.id, (turn) => ({ ...turn, status: "failed", thinking: false, message: "Você interrompeu a pesquisa." }));
    setCursor(null);
    setScanning(false);
    setHoldId(null);
    setStagingId(null);
  }, [updateTurn]);

  const replay = useCallback(async () => {
    const turn = turnsRef.current.find((item) => item.id === activeTurnId);
    if (!turn || !turn.events.length || turn.status === "running") return;
    const myToken = ++token.current;
    queue.current = [];
    setReplaying(true);
    setCompact(false);
    setFocus(null);
    setRevealId(null);
    forgetDrawn((target) => target.startsWith("node-") || target.startsWith("sheet-"));
    setStagingId(turn.id);
    setDrawTab(null);
    const reset = { ...newTurn(turn.id, turn.question), events: turn.events };
    turnsRef.current = turnsRef.current.map((item) => (item.id === turn.id ? reset : item));
    setTurns(turnsRef.current);
    for (const event of turn.events) enqueue(event, turn.id, myToken);
    const finish = () => { if (myToken === token.current) setReplaying(false); };
    window.clearInterval(replayPoll.current);
    replayPoll.current = window.setInterval(() => { if (!queue.current.length && !draining.current) { window.clearInterval(replayPoll.current); finish(); } }, 400);
  }, [activeTurnId, enqueue]);

  const onRevealDone = useCallback((id: string) => {
    setRevealId((current) => (current === id ? null : current));
    setStagingId((current) => (current === id ? null : current));
    setCursor(null);
  }, []);

  const openSource = useCallback(async (source: Source, turn: Turn) => {
    if (source.kind === "aula") {
      const payload = await pageFor(source, turn);
      if (!payload) return;
      openTab({ id: pageTabId(payload.document_id, payload.page), kind: "page", page: payload });
      setFocus({ sourceId: source.id, turnId: turn.id });
    } else {
      const node = turn.nodes.find((item) => item.kind === "web" && item.results?.some((result) => result.id === source.id)) as Extract<TraceNode, { kind: "web" }> | undefined;
      openTab({ id: node?.id ?? `web-${source.id}`, kind: "web", query: node?.query ?? source.title, provider: node?.provider ?? source.provider, results: node?.results ?? [source] });
      setFocus({ sourceId: source.id, turnId: turn.id });
    }
    setCompact(true);
  }, [openTab, pageFor]);

  const openNode = useCallback(async (node: TraceNode) => {
    const turn = turnsRef.current.find((item) => item.nodes.some((candidate) => candidate.id === node.id));
    if (node.kind === "read" && node.payload) {
      openTab({ id: pageTabId(node.payload.document_id, node.payload.page), kind: "page", page: node.payload });
      setFocus(null);
    } else if (node.kind === "web" && node.results) {
      openTab({ id: node.id, kind: "web", query: node.query, provider: node.provider ?? "wikipedia", results: node.results });
    } else if (node.kind === "search" && node.hits?.length && turn) {
      void openSource(node.hits[0], turn);
    }
  }, [openTab, openSource]);

  const activeTurn = turns.find((turn) => turn.id === activeTurnId) ?? null;
  const running = turns.some((turn) => turn.status === "running");
  const session = turns.length > 0;

  const highlights = useMemo(() => {
    const tab = tabs.find((item) => item.id === activeTab);
    if (!tab || tab.kind !== "page") return [];
    const onPage = (source: Source): source is LectureSource => source.kind === "aula" && source.document_id === tab.page.document_id && source.page === tab.page.page;
    if (focus) {
      const turn = turns.find((item) => item.id === focus.turnId);
      const source = turn?.seen[focus.sourceId] ?? turn?.sources.find((item) => item.id === focus.sourceId);
      if (source && onPage(source)) {
        const others = (turn?.sources ?? []).filter((item) => onPage(item) && item.id !== source.id);
        return [source, ...others].map((item) => ({ id: item.id, quote: (item as LectureSource).quote }));
      }
    }
    if (activeTurn?.status === "answered") return activeTurn.sources.filter(onPage).map((item) => ({ id: item.id, quote: item.quote }));
    return [];
  }, [tabs, activeTab, focus, turns, activeTurn]);

  const focusWebId = focus && turns.find((turn) => turn.id === focus.turnId)?.seen[focus.sourceId]?.kind === "web" ? focus.sourceId : null;

  const mood: MascotMood = running || holdId ? "thinking" : revealId ? "writing" : activeTurn?.status === "answered" ? "success" : "idle";

  const reset = useCallback(() => {
    if (running) return;
    token.current++;
    queue.current = [];
    window.clearInterval(replayPoll.current);
    setRevealId(null);
    setHoldId(null);
    setStagingId(null);
    setCompact(false);
    setReplaying(false);
    setScanning(false);
    setTurns([]);
    turnsRef.current = [];
    setTabs([]);
    setActiveTab(null);
    setActiveTurnId(null);
    setFocus(null);
    setCursor(null);
  }, [running]);

  return (
    <div className={`studio ${session ? "is-session" : "is-landing"}`}>
      <Landscape dim={session} paused={!active} />
      <TopBar current="/" mood={mood} onHome={reset} />
      <LayoutGroup>
        <AnimatePresence mode="popLayout" initial={false}>
          {!session ? (
            <motion.main key="hero" className="hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}>
              <h1 className="visually-hidden">Aster, agente de estudos</h1>
              <motion.div className="hero-mascot" initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", duration: 0.8, bounce: 0.3 }}>
                <Mascot mood={draft.trim() ? "writing" : "idle"} size={132} />
              </motion.div>
              <motion.p className="hero-title" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.6, ease: [0.23, 1, 0.32, 1] }}>O que você quer entender hoje?</motion.p>
              <motion.p className="hero-lede" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.6, ease: [0.23, 1, 0.32, 1] }}>
                O Aster pesquisa nas {materials.length || 12} aulas, abre a página certa e complementa com a web, mostrando cada fonte.
              </motion.p>
              <Composer value={draft} onChange={setDraft} onSubmit={ask} onStop={stop} running={running} size="hero" autoFocus />
              <motion.ul className="suggestions" initial="hidden" animate="shown" variants={{ shown: { transition: { staggerChildren: 0.05, delayChildren: 0.3 } } }} aria-label="Sugestões de perguntas">
                {SUGGESTIONS.map((suggestion) => (
                  <motion.li key={suggestion} variants={{ hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0 } }}>
                    <button type="button" className="suggestion" onClick={() => ask(suggestion)}>{suggestion}</button>
                  </motion.li>
                ))}
              </motion.ul>
            </motion.main>
          ) : (
            <motion.main key="session" className="session" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
              <h1 className="visually-hidden">Estudar com o Aster</h1>
              <motion.section className="chat" aria-label="Conversa com o Aster" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", duration: 0.7, bounce: 0.12 }}>
                <Thread
                  turns={turns}
                  revealId={revealId}
                  holdId={holdId}
                  onRevealDone={onRevealDone}
                  onOpenSource={openSource}
                  onRetry={ask}
                  onShowTrace={(turn) => { setActiveTurnId(turn.id); setCompact(false); }}
                  activeTurnId={activeTurnId}
                />
                <div className="chat-dock">
                  <Composer value={draft} onChange={setDraft} onSubmit={ask} onStop={stop} running={running} size="dock" />
                </div>
              </motion.section>
              <div className={`work ${compact ? "is-compact" : ""}`}>
                <motion.div className="work-trace" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: "spring", duration: 0.7, bounce: 0.1 }}>
                  <Investigation turn={activeTurn} materials={materials} compact={compact} replaying={replaying} live={!!activeTurn && activeTurn.id === stagingId} onToggleCompact={() => setCompact((value) => !value)} onReplay={replay} onOpenNode={openNode} />
                </motion.div>
                <motion.div className="work-doc" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, type: "spring", duration: 0.8, bounce: 0.1 }}>
                  <DocumentDeck
                    tabs={tabs}
                    activeId={activeTab}
                    drawId={stagingId ? drawTab : null}
                    onSelect={(id) => { setActiveTab(id); }}
                    highlights={highlights}
                    focusWebId={focusWebId}
                    scanning={scanning}
                    onRendered={() => { renderedKey.current = activeTab; renderGate.current?.(); }}
                    onEvidence={() => { evidenceSeen.current = true; evidenceGate.current?.(); }}
                  />
                </motion.div>
              </div>
            </motion.main>
          )}
        </AnimatePresence>
      </LayoutGroup>
      <AsterCursor state={cursor} />
    </div>
  );
}
