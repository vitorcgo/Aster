"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Mascot, type MascotMood } from "./Mascot";

type Health = { mode: "gemini" | "local"; materials: number; passages: number; model: string | null } | null | "offline";

const routes = [
  { href: "/", label: "Estudar" },
  { href: "/simulados", label: "Simulados" },
];

function prettyModel(model: string) {
  return model.replace(/^gemini-/, "Gemini ").replace(/-/g, " ").replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

export function TopBar({ current, mood = "idle", onHome }: { current: "/" | "/simulados"; mood?: MascotMood; onHome?: () => void }) {
  const [health, setHealth] = useState<Health>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/health").then((response) => (response.ok ? response.json() : Promise.reject())).then((data) => alive && setHealth(data)).catch(() => alive && setHealth("offline"));
    load();
    const timer = window.setInterval(load, 30000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

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
        {health && health !== "offline" && (
          <>
            <span className="status-chip">{health.materials} aulas</span>
            <span className={`status-chip ${health.mode === "local" ? "is-warn" : "is-ai"}`}>{health.mode === "gemini" ? (health.model ? prettyModel(health.model) : "Gemini") : "Modo local, sem IA"}</span>
          </>
        )}
      </div>
    </header>
  );
}
