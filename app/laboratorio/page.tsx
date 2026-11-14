"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { Landscape } from "@/components/Landscape";
import { TopBar } from "@/components/TopBar";
import { ConvLab } from "@/components/lab/ConvLab";
import { EmbeddingLab } from "@/components/lab/EmbeddingLab";
import { NeuralLab } from "@/components/lab/NeuralLab";
import { OverfitLab } from "@/components/lab/OverfitLab";
import { DEMOS, type DemoId } from "@/lib/demos";

const ICONS: Record<DemoId, IconName> = { rede: "network", convolucao: "expand", embeddings: "globe", overfitting: "flag" };

export default function Laboratorio() {
  const [active, setActive] = useState<DemoId>("rede");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("demo");
    if (requested && DEMOS.some((demo) => demo.id === requested)) setActive(requested as DemoId);
  }, []);

  const select = (id: DemoId) => {
    setActive(id);
    window.history.replaceState(null, "", `/laboratorio?demo=${id}`);
  };

  const demo = DEMOS.find((item) => item.id === active)!;

  return (
    <div className="lab">
      <Landscape dim />
      <TopBar current="/laboratorio" />
      <main className="lab-main">
        <h1 className="visually-hidden">Laboratório do Aster</h1>
        <nav className="lab-tabs" aria-label="Demonstrações">
          {DEMOS.map((item) => (
            <button key={item.id} type="button" className="lab-tab" aria-pressed={active === item.id} onClick={() => select(item.id)}>
              {active === item.id && <motion.span className="lab-tab-pill" layoutId="lab-tab-pill" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <span className="lab-tab-icon"><Icon name={ICONS[item.id]} size={18} /></span>
              <span className="lab-tab-text"><strong>{item.title}</strong><small>{item.lecture}</small></span>
            </button>
          ))}
        </nav>
        <section className="lab-panel" aria-labelledby="lab-title">
          <header className="lab-head">
            <div>
              <h2 id="lab-title">{demo.title}</h2>
              <p>{demo.summary}</p>
            </div>
            <div className="lab-refs">
              {demo.pages.map((page) => (
                <Link key={`${page.document_id}-${page.page}`} className="chip chip-aula" href={`/?source=${page.document_id}&page=${page.page}&q=${encodeURIComponent(page.query)}`}>
                  <Icon name="page" size={14} />{page.label}
                </Link>
              ))}
            </div>
          </header>
          <AnimatePresence mode="wait">
            <motion.div key={active} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}>
              {active === "rede" && <NeuralLab />}
              {active === "convolucao" && <ConvLab />}
              {active === "embeddings" && <EmbeddingLab />}
              {active === "overfitting" && <OverfitLab />}
            </motion.div>
          </AnimatePresence>
        </section>
      </main>
    </div>
  );
}
