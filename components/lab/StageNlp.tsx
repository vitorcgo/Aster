"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { labGet } from "@/lib/lab";

type Nlp = { original: string; lower: string; folded: string; tokens: string[]; short_removed: string[]; stopwords_removed: string[]; stems: { word: string; stem: string }[]; terms: string[] };

const appear = (index: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: index * 0.18, duration: 0.4, ease: [0.23, 1, 0.32, 1] as const } });

export function StageNlp({ question }: { question: string }) {
  const [data, setData] = useState<Nlp | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    labGet<Nlp>(`/api/lab/nlp?q=${encodeURIComponent(question)}`).then(setData).catch((problem: Error) => setError(problem.message));
  }, [question]);

  if (error) return <p className="sheet-error">{error}</p>;
  if (!data) return <p className="lab-note">Processando a pergunta.</p>;
  const removed = new Set([...data.short_removed, ...data.stopwords_removed]);

  return (
    <ol className="nlp-pipeline" key={question}>
      <motion.li {...appear(0)}>
        <span className="nlp-n">1</span>
        <div><h3>Texto original</h3><p className="nlp-text">{data.original}</p></div>
      </motion.li>
      <motion.li {...appear(1)}>
        <span className="nlp-n">2</span>
        <div><h3>Normalização: minúsculas e sem acentos</h3><p className="nlp-text mono">{data.folded}</p></div>
      </motion.li>
      <motion.li {...appear(2)}>
        <span className="nlp-n">3</span>
        <div>
          <h3>Tokenização</h3>
          <p className="lab-note">O texto vira uma sequência de tokens. O Aster quebra em sequências de letras e números.</p>
          <div className="token-row">{data.tokens.map((token, index) => <span key={`${token}-${index}`} className="token">{token}</span>)}</div>
        </div>
      </motion.li>
      <motion.li {...appear(3)}>
        <span className="nlp-n">4</span>
        <div>
          <h3>Stopwords e palavras curtas saem</h3>
          <p className="lab-note">Palavras comuns que não dizem o assunto, como “qual” e “que”, e tokens com menos de 3 letras.</p>
          <div className="token-row">{data.tokens.map((token, index) => <span key={`${token}-${index}`} className={`token ${removed.has(token) ? "is-removed" : ""}`}>{token}</span>)}</div>
        </div>
      </motion.li>
      <motion.li {...appear(4)}>
        <span className="nlp-n">5</span>
        <div>
          <h3>Stemming: cada palavra vira um radical</h3>
          <p className="lab-note">Plural e sufixos como “-ção” são aparados; assim “alucinação” e “alucinações” casam. O radical não precisa ser uma palavra.</p>
          <div className="stem-row">{data.stems.map((item, index) => <span key={`${item.word}-${index}`} className="stem"><span>{item.word}</span><i aria-hidden="true">→</i><strong>{item.stem}</strong></span>)}</div>
        </div>
      </motion.li>
      <motion.li {...appear(5)}>
        <span className="nlp-n">6</span>
        <div>
          <h3>Vetorização: o conjunto de termos da busca</h3>
          <p className="lab-note">Como no Bag-of-Words da p. 13, a ordem some e sobra quais termos aparecem. É isso que o Aster compara com cada trecho das aulas.</p>
          <div className="token-row">{data.terms.map((term) => <span key={term} className="token is-term">{term}</span>)}</div>
        </div>
      </motion.li>
    </ol>
  );
}
