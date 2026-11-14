"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Mascot, type MascotMood } from "./Mascot";
import { ModelSettings, SETTINGS_EVENT } from "./ModelSettings";
import { faviconUrl } from "@/lib/aster";

type Health = { mode: "ai" | "local"; materials: number; passages: number; model: string | null; provider: string | null } | null | "offline";

const PROVIDER_SITE: Record<string, string> = { gemini: "gemini.google.com", openai: "openai.com", nvidia: "nvidia.com" };

const routes = [
  { href: "/", label: "Estudar" },
  { href: "/laboratorio", label: "Laboratório" },
  { href: "/simulados", label: "Simulados" },
];

function prettyModel(model: string) {
  if (!model.startsWith("gemini-")) return model.split("/").pop() ?? model;
  return model.replace(/^gemini-/, "Gemini ").replace(/-/g, " ").replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

export function TopBar({ current, mood = "idle", onHome }: { current: "/" | "/simulados" | "/laboratorio"; mood?: MascotMood; onHome?: () => void }) {
  const [health, setHealth] = useState<Health>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback((attempt = 0) => {
    fetch("/api/health")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setHealth)
      .catch(() => {
        setHealth("offline");
        if (attempt < 10) window.setTimeout(() => load(attempt + 1), 3000);
      });
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(), 30000);
    const onChange = () => load();
    window.addEventListener(SETTINGS_EVENT, onChange);
    return () => { window.clearInterval(timer); window.removeEventListener(SETTINGS_EVENT, onChange); };
  }, [load]);

  return (
    <header className="topbar">
      <Link href="/" className="brand" onClick={onHome} aria-label="Aster, início">
        <span className="brand-mascot" data-cursor="mascot"><Mascot mood={mood} size={38} /></span>
        <span className="brand-name">Aster</span>
      </Link>
      <nav className="nav" aria-label="Navegação principal">
        {routes.map((route) => {
          const active = route.href === current;
          return (
            <Link key={route.href} href={route.href} className="nav-link" aria-current={active ? "page" : undefined}>
              {active && <motion.span className="nav-pill" layoutId="nav-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="nav-text">{route.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="status">
        {health === null && <span className="status-chip">Conectando</span>}
        {health === "offline" && <span className="status-chip is-bad">API desligada</span>}
        {health && health !== "offline" && <span className="status-chip status-count">{health.materials} aulas</span>}
        <button type="button" className={`status-chip status-model ${health && health !== "offline" ? (health.mode === "local" ? "is-warn" : "is-ai") : ""}`} onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">
          {health && health !== "offline" && health.provider && <img src={faviconUrl(PROVIDER_SITE[health.provider])} alt="" width="15" height="15" />}
          <span>{health && health !== "offline" ? (health.mode === "local" ? "Sem IA, configurar" : prettyModel(health.model ?? "")) : "Modelos"}</span>
          <Icon name="settings" size={15} />
        </button>
      </div>
      <ModelSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
