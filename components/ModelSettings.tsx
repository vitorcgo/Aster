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
type AdminStatus = { configured: boolean; logged_in: boolean; needs_code: boolean };
type ConfigRow = { name: string; kind: "int" | "bool" | "choice"; label: string; value: number | boolean | string; default: number | boolean | string; source: "painel" | "env" | "padrão"; min?: number; max?: number; options?: string[] };

export const SETTINGS_EVENT = "aster:settings-changed";
const CHOICE_LABEL: Record<string, string> = { minimal: "Mínimo", low: "Baixo", medium: "Médio", high: "Alto" };

class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // o cabeçalho próprio prova que o pedido saiu do painel (um site de fora não consegue mandá-lo)
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Aster-Admin": "1", ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (data as { detail?: unknown }).detail;
    const code = typeof detail === "object" && detail ? (detail as { code?: string }).code : undefined;
    if (response.status === 401) throw new ApiError(typeof detail === "object" && detail && "message" in detail ? String((detail as { message: string }).message) : "Entre de novo.", 401, code);
    if (response.status === 404 && (!detail || detail === "Not Found" || (typeof detail === "object" && (detail as { code?: string }).code === "route_not_found"))) throw new Error("A API em execução é de uma versão antiga e não tem o painel de modelos. Reinicie o servidor da API.");
    const message = typeof detail === "object" && detail && "message" in detail ? String((detail as { message: string }).message) : typeof detail === "string" ? detail : "A API não respondeu.";
    throw new ApiError(message, response.status, code);
  }
  return data as T;
}

/** Porta do painel: criar a senha (primeira vez) ou entrar. */
function AdminGate({ status, onDone }: { status: AdminStatus; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const creating = !status.configured;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (creating && password !== repeat) { setError("As duas senhas não são iguais."); return; }
    setBusy(true);
    try {
      await api(creating ? "/api/admin/setup" : "/api/admin/login", { method: "POST", body: JSON.stringify(creating ? { password, code } : { password }) });
      setPassword(""); setRepeat("");
      onDone();
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="admin-gate" onSubmit={submit}>
      <span className="admin-lock" aria-hidden="true"><Icon name="shield" size={26} /></span>
      <h3>{creating ? "Crie a senha de administrador" : "Área do administrador"}</h3>
      <p>{creating
        ? "Só quem tiver esta senha pode ver e trocar as chaves de IA, a fila de modelos e os limites. Use pelo menos 10 caracteres; uma frase é ótima."
        : "As chaves de IA, a fila de modelos e os limites do site ficam protegidos por senha."}</p>
      {creating && status.needs_code && (
        <label className="admin-field">
          <span>Código de configuração</span>
          <input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" spellCheck={false} placeholder="Ex.: 3F2A-9C1B-77DE" required />
          <small>Aparece no terminal da API do Aster e no arquivo data/codigo-de-configuracao.txt. Prova que quem cria a senha é o dono do site.</small>
        </label>
      )}
      <label className="admin-field">
        <span>{creating ? "Nova senha" : "Senha"}</span>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={creating ? "new-password" : "current-password"} minLength={creating ? 10 : 1} required autoFocus />
      </label>
      {creating && (
        <label className="admin-field">
          <span>Repita a senha</span>
          <input type="password" value={repeat} onChange={(event) => setRepeat(event.target.value)} autoComplete="new-password" minLength={10} required />
        </label>
      )}
      {error && <p className="sheet-error" role="alert">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy || !password}>{busy ? "Conferindo" : creating ? "Criar senha e entrar" : "Entrar"}</button>
    </form>
  );
}

/** Limites e opções que antes vinham do .env, agora salvos pelo painel. */
function SecurityTab({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [rows, setRows] = useState<ConfigRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, number | boolean | string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  useEffect(() => { api<{ config: ConfigRow[] }>("/api/admin/config").then((data) => setRows(data.config)).catch((problem: Error) => setError(problem.message)); }, []);
  const changed = Object.keys(draft).length > 0;
  const save = async () => {
    setError(""); setMessage("");
    try {
      const data = await api<{ config: ConfigRow[] }>("/api/admin/config", { method: "PUT", body: JSON.stringify({ values: draft }) });
      setRows(data.config); setDraft({}); setMessage("Configurações salvas. Já valem para as próximas perguntas.");
    } catch (problem) { setError((problem as Error).message); }
  };
  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError(""); setMessage("");
    try {
      await api("/api/admin/password", { method: "POST", body: JSON.stringify({ current, password: next }) });
      setCurrent(""); setNext(""); setMessage("Senha trocada. As outras sessões abertas foram encerradas.");
    } catch (problem) { setError((problem as Error).message); }
  };
  const logout = async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    onLoggedOut();
  };
  return (
    <>
      {error && <p className="sheet-error" role="alert">{error}</p>}
      {message && <p className="sheet-ok" role="status">{message}</p>}
      <section className="sheet-section" aria-labelledby="limits-title">
        <h3 id="limits-title">Limites e opções</h3>
        <p className="sheet-note">Cada pergunta gasta a sua chave de IA. Os limites protegem a cota quando o site estiver no ar.</p>
        <ul className="config-list">
          {rows?.map((row) => {
            const value = draft[row.name] ?? row.value;
            return (
              <li key={row.name} className="config-row">
                <span className="config-label">{row.label}<small>{row.source === "painel" ? "salvo no painel" : row.source === "env" ? "vindo do .env" : "valor padrão"}</small></span>
                {row.kind === "int" && <input type="number" inputMode="numeric" min={row.min} max={row.max} value={String(value)} onChange={(event) => setDraft((current) => ({ ...current, [row.name]: Number(event.target.value) }))} aria-label={row.label} />}
                {row.kind === "bool" && (
                  <button type="button" role="switch" aria-checked={!!value} className={`switch ${value ? "is-on" : ""}`} onClick={() => setDraft((current) => ({ ...current, [row.name]: !value }))} aria-label={row.label}><i /></button>
                )}
                {row.kind === "choice" && (
                  <select value={String(value)} onChange={(event) => setDraft((current) => ({ ...current, [row.name]: event.target.value }))} aria-label={row.label}>
                    {row.options?.map((option) => <option key={option} value={option}>{CHOICE_LABEL[option] ?? option}</option>)}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
        <div className="sheet-row">
          <button type="button" className="primary-button small" onClick={save} disabled={!changed}>Salvar limites</button>
          {changed && <button type="button" className="text-button" onClick={() => setDraft({})}>Desfazer</button>}
        </div>
      </section>
      <section className="sheet-section" aria-labelledby="password-title">
        <h3 id="password-title">Senha de administrador</h3>
        <form className="password-form" onSubmit={changePassword}>
          <input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} placeholder="Senha atual" autoComplete="current-password" required aria-label="Senha atual" />
          <input type="password" value={next} onChange={(event) => setNext(event.target.value)} placeholder="Nova senha (10+ caracteres)" autoComplete="new-password" minLength={10} required aria-label="Nova senha" />
          <button type="submit" className="secondary-button" disabled={!current || next.length < 10}>Trocar senha</button>
        </form>
      </section>
      <section className="sheet-section">
        <button type="button" className="secondary-button" onClick={logout}><Icon name="close" size={15} />Sair da área do administrador</button>
      </section>
    </>
  );
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

export function ModelSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [view, setView] = useState<"modelos" | "seguranca">("modelos");
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

  const refresh = useCallback(async () => {
    setError("");
    try {
      const next = await api<AdminStatus>("/api/admin/status");
      setStatus(next);
      if (next.logged_in) setSettings(await api<Settings>("/api/settings"));
      else setSettings(null);
    } catch (problem) {
      setError((problem as Error).message);
    }
  }, []);

  // sessão vencida no meio do uso: volta para a tela de senha em vez de mostrar erro solto
  const guard = useCallback((problem: unknown) => {
    if (problem instanceof ApiError && problem.status === 401) { void refresh(); return; }
    setError((problem as Error).message);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, refresh]);

  const unlocked = !!status?.logged_in;
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
    if (open && unlocked && provider?.configured && !models[provider.id]) void loadModels(provider.id);
  }, [open, unlocked, provider, models, loadModels]);

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
      guard(problem);
    } finally {
      setSaving(false);
    }
  };

  const importKey = async () => {
    if (!provider) return;
    try {
      apply(await api<Settings>(`/api/settings/keys/${provider.id}/import`, { method: "POST" }));
    } catch (problem) {
      guard(problem);
    }
  };

  const removeKey = async () => {
    if (!provider) return;
    try {
      apply(await api<Settings>(`/api/settings/keys/${provider.id}`, { method: "DELETE" }));
      setModels((current) => { const next = { ...current }; delete next[provider.id]; return next; });
    } catch (problem) {
      guard(problem);
    }
  };

  const saveChain = async (chain: ChainEntry[]) => {
    try {
      apply(await api<Settings>("/api/settings/chain", { method: "PUT", body: JSON.stringify({ chain: chain.map(({ provider: id, model }) => ({ provider: id, model })) }) }));
    } catch (problem) {
      guard(problem);
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
                <h2 id="models-title">{unlocked ? "Administração" : "Modelos de IA"}</h2>
                <p>{unlocked ? "Chaves, fila de modelos e limites do site. Tudo fica salvo no servidor, sem precisar do .env." : "Configurações do Aster, protegidas por senha."}</p>
              </div>
              <button ref={closeButton} type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
            </header>

            {error && <p className="sheet-error" role="alert">{error}</p>}

            {status && !unlocked && <AdminGate status={status} onDone={refresh} />}
            {unlocked && (
              <div className="admin-tabs" role="tablist" aria-label="Seções da administração">
                {(["modelos", "seguranca"] as const).map((item) => (
                  <button key={item} type="button" role="tab" aria-selected={view === item} className={`admin-tab ${view === item ? "is-on" : ""}`} onClick={() => setView(item)}>
                    <Icon name={item === "modelos" ? "settings" : "shield"} size={15} />{item === "modelos" ? "Modelos e chaves" : "Limites e segurança"}
                  </button>
                ))}
              </div>
            )}
            {unlocked && view === "seguranca" && <SecurityTab onLoggedOut={refresh} />}

            {unlocked && view === "modelos" && <>
            <section className="sheet-section" aria-labelledby="chain-title">
              <div className="sheet-row">
                <h3 id="chain-title">Fila do agente</h3>
                {settings?.custom_chain && <button type="button" className="text-button" onClick={() => saveChain([])}>Voltar à fila padrão</button>}
              </div>
              {!settings?.custom_chain && <p className="sheet-note">Usando a fila padrão. Adicione um modelo abaixo para montar a sua.</p>}
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
                    {provider.source === "page" && <>Guardada cifrada no servidor <code>{provider.masked}</code></>}
                    {provider.source === "env" && <>Vindo do arquivo .env <code>{provider.masked}</code></>}
                    {!provider.source && <>Nenhuma chave cadastrada.</>}
                    <a href={provider.keys_url} target="_blank" rel="noreferrer">Gerar chave<Icon name="external" size={13} /></a>
                  </p>
                  <form className="key-form" onSubmit={saveKey}>
                    <label className="visually-hidden" htmlFor="provider-key">Chave da API {provider.label}</label>
                    <input id="provider-key" type="password" autoComplete="off" spellCheck={false} value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder={provider.configured ? "Colar outra chave" : `Cole a chave da API ${provider.label}`} />
                    <button type="submit" className="primary-button small" disabled={saving || draftKey.trim().length < 8}>{saving ? "Salvando" : "Salvar"}</button>
                  </form>
                  {provider.source === "env" && (
                    <div className="key-import">
                      <p>Guarde esta chave no painel para gerenciar tudo por aqui. Depois você pode apagá-la do .env.</p>
                      <button type="button" className="secondary-button" onClick={importKey}>Guardar no painel</button>
                    </div>
                  )}
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
            <p className="sheet-foot">As chaves ficam cifradas no servidor (data/settings.json, fora do Git). O navegador nunca recebe a chave inteira, só o final mascarado.</p>
            </>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
