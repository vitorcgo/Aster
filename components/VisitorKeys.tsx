"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import { faviconUrl } from "@/lib/aster";
import { loadAI, maskKey, saveAI, type VisitorAI } from "@/lib/ai";
import { apiFetch, readJson } from "@/lib/errors";

const PROVIDERS = [
  { id: "gemini", label: "Gemini", site: "gemini.google.com", keysUrl: "https://aistudio.google.com/apikey", hint: "Tem plano gratuito. É a melhor opção para começar." },
  { id: "openai", label: "ChatGPT", site: "openai.com", keysUrl: "https://platform.openai.com/api-keys", hint: "Precisa de créditos na conta da OpenAI." },
  { id: "nvidia", label: "NVIDIA", site: "nvidia.com", keysUrl: "https://build.nvidia.com/settings/api-keys", hint: "Gratuito com limite por minuto." },
];

type ModelInfo = { id: string; name: string };
type TestResult = { state: "running" } | { state: "done"; ok: boolean; latency_ms?: number; tools?: boolean; message?: string };

async function post<T>(path: string, body: unknown): Promise<T> {
  // erros chegam com o número: "400 · A chave foi recusada pelo provedor...", "502 · A API do Aster não está rodando..."
  return readJson<T>(await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

/** Chaves e fila de modelos de quem está usando o site. Tudo fica só neste navegador. */
export function VisitorKeys() {
  const [ai, setAI] = useState<VisitorAI>({ keys: {}, chain: [] });
  const [tab, setTab] = useState("gemini");
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<Record<string, ModelInfo[] | "loading" | { error: string }>>({});
  const [filter, setFilter] = useState("");
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  useEffect(() => setAI(loadAI()), []);
  const update = useCallback((next: VisitorAI) => { setAI(next); saveAI(next); }, []);
  const provider = PROVIDERS.find((item) => item.id === tab)!;
  const key = ai.keys[tab] ?? "";

  const loadModels = useCallback(async (id: string, value: string) => {
    setModels((current) => ({ ...current, [id]: "loading" }));
    try {
      const data = await post<{ models: ModelInfo[] }>("/api/ai/models", { provider: id, key: value });
      setModels((current) => ({ ...current, [id]: data.models }));
    } catch (problem) {
      setModels((current) => ({ ...current, [id]: { error: (problem as Error).message } }));
    }
  }, []);

  useEffect(() => { setDraft(""); setFilter(""); }, [tab]);
  useEffect(() => { if (key && !models[tab]) void loadModels(tab, key); }, [tab, key, models, loadModels]);

  const saveKey = (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (value.length < 8 || /\s/.test(value)) return;
    update({ ...ai, keys: { ...ai.keys, [tab]: value } });
    setDraft("");
    setModels((current) => { const next = { ...current }; delete next[tab]; return next; });
  };
  const removeKey = () => {
    const keys = { ...ai.keys };
    delete keys[tab];
    update({ keys, chain: ai.chain.filter((item) => item.provider !== tab) });
  };
  const runTest = async (model: string) => {
    const id = `${tab}:${model}`;
    setTests((current) => ({ ...current, [id]: { state: "running" } }));
    try {
      const result = await post<{ ok: boolean; latency_ms?: number; tools?: boolean; message?: string }>("/api/ai/test", { provider: tab, key, model });
      setTests((current) => ({ ...current, [id]: { state: "done", ...result } }));
    } catch (problem) {
      setTests((current) => ({ ...current, [id]: { state: "done", ok: false, message: (problem as Error).message } }));
    }
  };
  const move = (index: number, delta: number) => {
    const chain = [...ai.chain];
    const [item] = chain.splice(index, 1);
    chain.splice(index + delta, 0, item);
    update({ ...ai, chain });
  };

  const list = models[tab];
  const visible = useMemo(() => (Array.isArray(list) ? list.filter((item) => item.id.toLowerCase().includes(filter.trim().toLowerCase())) : []), [list, filter]);
  const hasKeys = Object.keys(ai.keys).length > 0;

  return (
    <>
      <div className="visitor-intro">
        <Icon name="shield" size={18} />
        <p>Use a <b>sua</b> chave de IA. Ela fica guardada só neste navegador e vai junto com cada pergunta. O servidor do Aster usa a chave só durante a consulta e não guarda.</p>
      </div>

      <section className="sheet-section" aria-labelledby="visitor-chain-title">
        <div className="sheet-row"><h3 id="visitor-chain-title">Sua fila de modelos</h3></div>
        {!hasKeys && <p className="sheet-note">Coloque uma chave abaixo para começar. Sem chave, o Aster só mostra trechos copiados das aulas, sem IA.</p>}
        {hasKeys && !ai.chain.length && <p className="sheet-note">{ai.keys.gemini ? "Usando os modelos padrão do Gemini. Adicione um modelo abaixo para escolher." : "Escolha um modelo na lista abaixo para usar a sua chave."}</p>}
        <ol className="chain">
          <AnimatePresence initial={false}>
            {ai.chain.map((item, index) => {
              const owner = PROVIDERS.find((entry) => entry.id === item.provider);
              const missing = !ai.keys[item.provider];
              return (
                <motion.li key={`${item.provider}:${item.model}`} layout className={`chain-item ${missing ? "is-off" : ""}`} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}>
                  <span className="chain-rank">{index + 1}</span>
                  <img src={faviconUrl(owner?.site)} alt="" width="18" height="18" />
                  <span className="chain-name"><strong>{item.model}</strong><small>{owner?.label ?? item.provider}{missing ? ", sem chave" : ""}</small></span>
                  <span className="chain-actions">
                    <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Subir ${item.model}`}><Icon name="arrowUp" size={16} /></button>
                    <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === ai.chain.length - 1} aria-label={`Descer ${item.model}`}><Icon name="arrowUp" size={16} className="flip" /></button>
                    <button type="button" className="icon-button" onClick={() => update({ ...ai, chain: ai.chain.filter((_, position) => position !== index) })} aria-label={`Tirar ${item.model} da fila`}><Icon name="close" size={16} /></button>
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      </section>

      <section className="sheet-section" aria-label="Provedores">
        <div className="provider-tabs" role="tablist" aria-label="Provedores">
          {PROVIDERS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className="provider-tab" onClick={() => setTab(item.id)}>
              {tab === item.id && <motion.span className="provider-pill" layoutId="visitor-provider-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <img src={faviconUrl(item.site)} alt="" width="16" height="16" />
              <span>{item.label}</span>
              <i className={`provider-state ${ai.keys[item.id] ? "is-on" : ""}`} aria-label={ai.keys[item.id] ? "com chave" : "sem chave"} />
            </button>
          ))}
        </div>
        <div className="provider-panel" role="tabpanel">
          <p className="key-status">
            {key ? <>Sua chave, guardada neste navegador <code>{maskKey(key)}</code></> : <>{provider.hint}</>}
            <a href={provider.keysUrl} target="_blank" rel="noreferrer">Gerar chave<Icon name="external" size={13} /></a>
          </p>
          <form className="key-form" onSubmit={saveKey}>
            <label className="visually-hidden" htmlFor="visitor-key">Sua chave da API {provider.label}</label>
            <input id="visitor-key" type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={key ? "Colar outra chave" : `Cole a sua chave da API ${provider.label}`} />
            <button type="submit" className="primary-button small" disabled={draft.trim().length < 8}>Salvar</button>
          </form>
          {key && <button type="button" className="text-button danger" onClick={removeKey}>Apagar minha chave deste navegador</button>}
          {key && (
            <div className="model-picker">
              <div className="sheet-row">
                <input className="model-filter" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar modelos" aria-label="Filtrar modelos" />
                <button type="button" className="icon-button" onClick={() => loadModels(tab, key)} aria-label="Recarregar lista"><Icon name="replay" size={16} /></button>
              </div>
              {list === "loading" && <p className="sheet-note">Buscando os modelos que a sua chave enxerga.</p>}
              {list && typeof list === "object" && !Array.isArray(list) && <p className="sheet-error">{list.error}</p>}
              {Array.isArray(list) && (
                <ul className="model-list">
                  {visible.length === 0 && <li className="sheet-note">Nenhum modelo com esse nome.</li>}
                  {visible.map((model) => {
                    const result = tests[`${tab}:${model.id}`];
                    const added = ai.chain.some((item) => item.provider === tab && item.model === model.id);
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
                          <button type="button" className="ghost-button small" onClick={() => runTest(model.id)} disabled={result?.state === "running"}>Testar</button>
                          <button type="button" className="ghost-button small" onClick={() => update({ ...ai, chain: [...ai.chain, { provider: tab, model: model.id }] })} disabled={added || ai.chain.length >= 6}>{added ? "Na fila" : "Adicionar"}</button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
