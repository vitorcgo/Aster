"use client";

import { useEffect } from "react";

/** Se algum pedaço da tela quebrar, o aluno vê isto em vez de uma página em branco, e um clique recupera. */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[aster] erro na tela:", error);
  }, [error]);

  const clearAndReload = () => {
    // uma conversa salva com formato antigo é a causa mais comum: limpa só a conversa, não a chave nem a memória
    try {
      sessionStorage.removeItem("aster:studio");
    } catch {}
    window.location.reload();
  };

  return (
    <main className="error-screen" role="alert">
      <img src="/mascot/thinking.svg" alt="" width="96" height="96" />
      <h1>Algo deu errado nesta tela.</h1>
      <p>A pesquisa não foi perdida por causa disso. Tente de novo; se continuar, comece uma conversa nova.</p>
      <div className="error-actions">
        <button type="button" className="primary-button" onClick={reset}>Tentar de novo</button>
        <button type="button" className="ghost-button" onClick={clearAndReload}>Começar conversa nova</button>
      </div>
    </main>
  );
}
