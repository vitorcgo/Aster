"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { faviconUrl } from "@/lib/aster";

type Provider = { id: string; label: string; site: string; keys_url: string; configured: boolean; source: "page" | "env" | null; masked: string | null };
type ChainEntry = { provider: string; model: string; available?: boolean; paused?: boolean };
type Settings = { providers: Provider[]; chain: ChainEntry[]; custom_chain: boolean; default_chain: ChainEntry[] };
type ModelInfo = { id: string; name: string; context?: number | null };
type TestResult = { state: "running" } | { state: "done"; ok: boolean; latency_ms?: number; tools?: boolean; message?: string };

export const SETTINGS_EVENT = "aster:settings-changed";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (data as { detail?: unknown }).detail;
    if (response.status === 404 && (!detail || detail === "Not Found")) throw new Error("A API em execução é de uma versão antiga e não tem o painel de modelos. Reinicie o servidor da API.");
    const message = typeof detail === "object" && detail && "message" in detail ? String((detail as { message: string }).message) : typeof detail === "string" ? detail : "A API não respondeu.";
    throw new Error(message);
  }
  return data as T;
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

export function ModelSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("gemini");
  const [draftKey, setDraftKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<Record<string, ModelInfo[] | "loading" | { error: string }>>({});
  const [filter, setFilter] = useState("");
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const closeButton = useRef<HTMLButtonElement>(null);

  const apply = useCallback((next: Settings) => {
    setSettings(next);
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
  }, []);

  useEffect(() => {
    if (!open) return;
    setError("");
    api<Settings>("/api/settings").then(setSettings).catch((problem: Error) => setError(problem.message));
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const provider = settings?.providers.find((item) => item.id === tab) ?? null;

  const loadModels = useCallback(async (id: string) => {
    setModels((current) => ({ ...current, [id]: "loading" }));
    try {
      const data = await api<{ models: ModelInfo[] }>(`/api/providers/${id}/models`);
      setModels((current) => ({ ...current, [id]: data.models }));
    } catch (problem) {
      setModels((current) => ({ ...current, [id]: { error: (problem as Error).message } }));
    }
  }, []);

  useEffect(() => {
    if (open && provider?.configured && !models[provider.id]) void loadModels(provider.id);
  }, [open, provider, models, loadModels]);

  useEffect(() => { setDraftKey(""); setFilter(""); }, [tab]);

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!provider || draftKey.trim().length < 8) return;
    setSaving(true);
    setError("");
    try {
      apply(await api<Settings>(`/api/settings/keys/${provider.id}`, { method: "PUT", body: JSON.stringify({ key: draftKey.trim() }) }));
      setDraftKey("");
      setModels((current) => { const next = { ...current }; delete next[provider.id]; return next; });
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    if (!provider) return;
    try {
      apply(await api<Settings>(`/api/settings/keys/${provider.id}`, { method: "DELETE" }));
      setModels((current) => { const next = { ...current }; delete next[provider.id]; return next; });
    } catch (problem) {
      setError((problem as Error).message);
    }
  };

  const saveChain = async (chain: ChainEntry[]) => {
    try {
      apply(await api<Settings>("/api/settings/chain", { method: "PUT", body: JSON.stringify({ chain: chain.map(({ provider: id, model }) => ({ provider: id, model })) }) }));
    } catch (problem) {
      setError((problem as Error).message);
    }
  };

  const runTest = async (id: string, model: string) => {
    const key = `${id}:${model}`;
    setTests((current) => ({ ...current, [key]: { state: "running" } }));
    try {
      const result = await api<{ ok: boolean; latency_ms?: number; tools?: boolean; message?: string }>(`/api/providers/${id}/test`, { method: "POST", body: JSON.stringify({ model }) });
      setTests((current) => ({ ...current, [key]: { state: "done", ...result } }));
    } catch (problem) {
      setTests((current) => ({ ...current, [key]: { state: "done", ok: false, message: (problem as Error).message } }));
    }
  };

  const chain = settings?.chain ?? [];
  const inChain = (id: string, model: string) => chain.some((item) => item.provider === id && item.model === model);
  const move = (index: number, delta: number) => {
    const next = [...chain];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    void saveChain(next);
  };

  const list = provider ? models[provider.id] : undefined;
  const visible = useMemo(() => (Array.isArray(list) ? list.filter((item) => item.id.toLowerCase().includes(filter.trim().toLowerCase())) : []), [list, filter]);
  const providerOf = (id: string) => settings?.providers.find((item) => item.id === id);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // portal: o painel precisa ficar acima de qualquer camada da página
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="models-title"
            initial={{ x: "104%" }}
            animate={{ x: 0 }}
            exit={{ x: "104%" }}
            transition={{ type: "spring", duration: 0.5, bounce: 0.08 }}
          >
            <header className="sheet-head">
              <div>
                <h2 id="models-title">Modelos de IA</h2>
                <p>O Aster usa o primeiro modelo da fila. Se ele falhar ou ficar sem cota, passa ao próximo.</p>
              </div>
              <button ref={closeButton} type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
            </header>

            {error && <p className="sheet-error" role="alert">{error}</p>}

            <section className="sheet-section" aria-labelledby="chain-title">
              <div className="sheet-row">
                <h3 id="chain-title">Fila do agente</h3>
                {settings?.custom_chain && <button type="button" className="text-button" onClick={() => saveChain([])}>Voltar ao padrão do .env</button>}
              </div>
              {!settings?.custom_chain && <p className="sheet-note">Usando a ordem do arquivo .env. Adicione um modelo abaixo para montar a sua.</p>}
              <ol className="chain">
                <AnimatePresence initial={false}>
                  {chain.map((item, index) => {
                    const owner = providerOf(item.provider);
                    return (
                      <motion.li key={`${item.provider}:${item.model}`} layout className={`chain-item ${item.available === false ? "is-off" : ""}`} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}>
                        <span className="chain-rank">{index + 1}</span>
                        <img src={faviconUrl(owner?.site)} alt="" width="18" height="18" />
                        <span className="chain-name">
                          <strong>{item.model}</strong>
                          <small>{owner?.label ?? item.provider}{item.available === false ? ", sem chave" : item.paused ? ", pausado por 10 min após falha" : ""}</small>
                        </span>
                        <span className="chain-actions">
                          <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Subir ${item.model}`}><Icon name="arrowUp" size={16} /></button>
                          <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === chain.length - 1} aria-label={`Descer ${item.model}`}><Icon name="arrowUp" size={16} className="flip" /></button>
                          <button type="button" className="icon-button" onClick={() => saveChain(chain.filter((_, position) => position !== index))} disabled={chain.length === 1} aria-label={`Tirar ${item.model} da fila`}><Icon name="close" size={16} /></button>
                        </span>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ol>
            </section>

            <section className="sheet-section" aria-label="Provedores">
              <div className="provider-tabs" role="tablist" aria-label="Provedores">
                {settings?.providers.map((item) => (
                  <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className="provider-tab" onClick={() => setTab(item.id)}>
                    {tab === item.id && <motion.span className="provider-pill" layoutId="provider-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                    <img src={faviconUrl(item.site)} alt="" width="16" height="16" />
                    <span>{item.label}</span>
                    <i className={`provider-state ${item.configured ? "is-on" : ""}`} aria-label={item.configured ? "com chave" : "sem chave"} />
                  </button>
                ))}
              </div>

              {provider && (
                <div className="provider-panel" role="tabpanel">
                  <p className="key-status">
                    {provider.source === "page" && <>Chave salva aqui <code>{provider.masked}</code></>}
                    {provider.source === "env" && <>Usando a chave do arquivo .env <code>{provider.masked}</code></>}
                    {!provider.source && <>Nenhuma chave cadastrada.</>}
                    <a href={provider.keys_url} target="_blank" rel="noreferrer">Gerar chave<Icon name="external" size={13} /></a>
                  </p>
                  <form className="key-form" onSubmit={saveKey}>
                    <label className="visually-hidden" htmlFor="provider-key">Chave da API {provider.label}</label>
                    <input id="provider-key" type="password" autoComplete="off" spellCheck={false} value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder={provider.configured ? "Colar outra chave" : `Cole a chave da API ${provider.label}`} />
                    <button type="submit" className="primary-button small" disabled={saving || draftKey.trim().length < 8}>{saving ? "Salvando" : "Salvar"}</button>
                  </form>
                  {provider.source === "page" && <button type="button" className="text-button danger" onClick={removeKey}>Remover chave salva</button>}

                  {provider.configured && (
                    <div className="model-picker">
                      <div className="sheet-row">
                        <input className="model-filter" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar modelos" aria-label="Filtrar modelos" />
                        <button type="button" className="icon-button" onClick={() => loadModels(provider.id)} aria-label="Recarregar lista"><Icon name="replay" size={16} /></button>
                      </div>
                      {list === "loading" && <p className="sheet-note">Buscando os modelos disponíveis para esta chave.</p>}
                      {list && typeof list === "object" && !Array.isArray(list) && <p className="sheet-error">{list.error}</p>}
                      {Array.isArray(list) && (
                        <ul className="model-list">
                          {visible.length === 0 && <li className="sheet-note">Nenhum modelo com esse nome.</li>}
                          {visible.map((model) => {
                            const result = tests[`${provider.id}:${model.id}`];
                            const added = inChain(provider.id, model.id);
                            return (
                              <li key={model.id} className="model-row">
                                <span className="model-id">{model.id}</span>
                                <span className="model-result" aria-live="polite">
                                  {result?.state === "running" && <span className="test-badge">Testando</span>}
                                  {result?.state === "done" && result.ok && result.tools && <span className="test-badge is-good">{seconds(result.latency_ms ?? 0)}, usa ferramentas</span>}
                                  {result?.state === "done" && result.ok && !result.tools && <span className="test-badge is-warn">Responde, sem ferramentas</span>}
                                  {result?.state === "done" && !result.ok && <span className="test-badge is-bad" title={result.message}>{result.message ?? "Falhou"}</span>}
                                </span>
                                <span className="model-actions">
                                  <button type="button" className="ghost-button small" onClick={() => runTest(provider.id, model.id)} disabled={result?.state === "running"}>Testar</button>
                                  <button type="button" className="ghost-button small" onClick={() => saveChain([...chain, { provider: provider.id, model: model.id }])} disabled={added || chain.length >= 6}>{added ? "Na fila" : "Adicionar"}</button>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
            <p className="sheet-foot">As chaves ficam no servidor, em data/settings.json, fora do Git. O navegador só vê o final mascarado.</p>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
