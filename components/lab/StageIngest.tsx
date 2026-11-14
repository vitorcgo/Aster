"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { lectureLabel } from "@/lib/aster";
import { labGet, type SearchResult } from "@/lib/lab";

type Overview = { documents: { id: string; subject: string; pages: number; passages: number }[]; totals: { documents: number; pages: number; passages: number; avg_chars: number }; rules: { min_chars: number; max_chars: number } };
type PageDetail = { document_id: string; page: number; heading: string; raw: string; clean: string; fixes: { from: string; to: string; count: number }[]; passages: { id: string; quote: string; chars: number }[] };

// sem a flag g: com ela, .test() guarda posição entre chamadas e erra metade das marcações
const IS_CORRUPTED = /^[őŐĄąŸŮŰŞŤÐłžś]$/;

function markRaw(text: string) {
  const parts = text.split(/([őŐĄąŸŮŰŞŤÐłžś])/);
  return parts.map((part, index) => (IS_CORRUPTED.test(part) ? <mark key={index} className="glyph-bad">{part}</mark> : <span key={index}>{part}</span>));
}

export function StageIngest({ search }: { search: SearchResult | null }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [target, setTarget] = useState<{ doc: string; page: number } | null>(null);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { labGet<Overview>("/api/lab/overview").then(setOverview).catch((problem: Error) => setError(problem.message)); }, []);
  useEffect(() => {
    const first = search?.candidates[0];
    if (first) setTarget({ doc: first.document_id, page: first.page });
  }, [search]);
  useEffect(() => {
    if (!target) return;
    labGet<PageDetail>(`/api/lab/page?doc=${target.doc}&page=${target.page}`).then(setDetail).catch((problem: Error) => setError(problem.message));
  }, [target]);

  const max = Math.max(1, ...(overview?.documents.map((doc) => doc.passages) ?? [1]));

  return (
    <div className="stage-grid">
      {error && <p className="sheet-error">{error}</p>}
      {overview && (
        <div className="ingest-flow">
          {[
            { value: overview.totals.documents, label: "PDFs das aulas" },
            { value: overview.totals.pages, label: "páginas lidas pelo PyMuPDF" },
            { value: overview.totals.passages, label: "trechos com id" },
            { value: overview.totals.avg_chars, label: "caracteres por trecho, em média" },
          ].map((item, index) => (
            <motion.div key={item.label} className="flow-step" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.12 }}>
              <strong>{item.value.toLocaleString("pt-BR")}</strong>
              <span>{item.label}</span>
            </motion.div>
          ))}
        </div>
      )}

      {overview && (
        <figure className="lab-card">
          <figcaption>Trechos por aula. Clique para inspecionar a primeira página com texto.</figcaption>
          <ul className="doc-bars">
            {overview.documents.map((doc, index) => (
              <li key={doc.id}>
                <button type="button" onClick={() => setTarget({ doc: doc.id, page: 3 })} aria-label={`Inspecionar ${doc.id}`}>
                  <span className="doc-bar-label">{lectureLabel(doc.id)}</span>
                  <span className="doc-bar-track"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: doc.passages / max }} transition={{ delay: 0.3 + index * 0.04, duration: 0.6, ease: [0.23, 1, 0.32, 1] }} /></span>
                  <span className="doc-bar-value">{doc.passages}</span>
                </button>
              </li>
            ))}
          </ul>
        </figure>
      )}

      {detail && (
        <div className="ingest-page">
          <div className="lab-card">
            <h3>{lectureLabel(detail.document_id, detail.page)}: texto extraído do PDF</h3>
            <p className="lab-note">Algumas aulas foram exportadas com fontes que trocam “fi” e “ê” por outros caracteres. {detail.fixes.length ? `Nesta página: ${detail.fixes.map((fix) => `${fix.from} → ${fix.to} (${fix.count}×)`).join(", ")}.` : "Esta página não tem caracteres corrompidos."}</p>
            <pre className="raw-text">{markRaw(detail.raw)}</pre>
          </div>
          <div className="lab-card">
            <h3>Depois da limpeza, em {detail.passages.length} trechos</h3>
            <p className="lab-note">Cada bloco do slide é dividido em frases; ficam as que têm entre 40 e 600 caracteres. O id é o que o agente cita na resposta.</p>
            <ol className="chunk-list">
              {detail.passages.map((passage, index) => (
                <motion.li key={passage.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.08 }}>
                  <code>{passage.id}</code>
                  <p>{passage.quote}</p>
                  <small>{passage.chars} caracteres</small>
                </motion.li>
              ))}
              {detail.passages.length === 0 && <li className="lab-note">Esta página não gerou trechos (título, figura ou texto curto demais).</li>}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
