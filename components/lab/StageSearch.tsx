"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { lectureLabel } from "@/lib/aster";
import type { SearchResult } from "@/lib/lab";

function highlight(text: string, terms: string[]) {
  if (!terms.length) return text;
  const folded = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return text.split(/(\s+)/).map((word, index) => {
    const clean = folded(word).replace(/[^a-z0-9]/g, "");
    const hit = clean.length >= 3 && terms.some((term) => clean.startsWith(term.slice(0, Math.min(term.length, 5))));
    return hit ? <mark key={index} className="term-hit">{word}</mark> : word;
  });
}

export function StageSearch({ search, question }: { search: SearchResult | null; question: string }) {
  if (!search) return <p className="lab-note">Buscando.</p>;
  const top = Math.max(0.001, ...search.candidates.map((item) => item.score));
  return (
    <div className="stage-grid">
      <div className="search-summary">
        <div className="flow-step"><strong>{search.terms.length}</strong><span>termos na pergunta</span></div>
        <div className="flow-step"><strong>{search.matched.toLocaleString("pt-BR")}</strong><span>de {search.total.toLocaleString("pt-BR")} trechos têm algum termo</span></div>
        <div className="flow-step"><strong>{search.candidates.length}</strong><span>melhores viram candidatos</span></div>
      </div>
      <div className="formula-card">
        <span>Pontuação de cada trecho</span>
        <code>2,4 × termos no trecho ÷ √tamanho + 1,2 × termos no título ÷ termos da pergunta + cobertura</code>
        <p className="lab-note">Trechos curtos que concentram os termos sobem, um pouco como o TF-IDF da Aula 4, p. 14. Cada página entra no máximo duas vezes.</p>
      </div>
      <ol className="candidate-list" key={question}>
        {search.candidates.map((item, index) => (
          <motion.li key={item.id} className="candidate" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.06 }}>
            <span className="candidate-rank">{index + 1}</span>
            <div className="candidate-body">
              <div className="candidate-head">
                <Link className="chip chip-aula" href={`/?source=${item.document_id}&page=${item.page}&q=${encodeURIComponent(question)}`}>{lectureLabel(item.document_id, item.page)}</Link>
                <span className="candidate-heading">{item.heading}</span>
              </div>
              <p className="candidate-quote">{highlight(item.quote, item.content_terms)}</p>
              <p className="candidate-terms">
                <span>no trecho: {item.content_terms.join(", ") || "nenhum"}</span>
                <span>no título: {item.heading_terms.join(", ") || "nenhum"}</span>
                <span>cobertura {Math.round(item.coverage * 100)}%</span>
              </p>
            </div>
            <div className="candidate-score">
              <span className="score-track"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: item.score / top }} transition={{ delay: 0.2 + index * 0.06, duration: 0.5 }} /></span>
              <code>{item.score.toFixed(2).replace(".", ",")}</code>
            </div>
          </motion.li>
        ))}
      </ol>
      <p className="lab-insight is-warn">O Aster busca por palavras, com radicais. Esse é o “problema do lexical” da Aula 6, p. 24: se a aula usa um sinônimo que a pergunta não usa, o trecho não aparece. A próxima etapa compara com a busca por significado.</p>
    </div>
  );
}
