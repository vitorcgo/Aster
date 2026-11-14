"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Studio } from "./Studio";

/**
 * Mantém a tela Estudar montada durante a navegação: ao ir para o Laboratório ou os
 * Simulados ela só fica escondida, e a conversa (inclusive uma resposta em andamento) continua.
 */
export function StudioHost() {
  const pathname = usePathname();
  const active = pathname === "/";
  // monta só no navegador e só depois da primeira visita ao Estudar
  const [visited, setVisited] = useState(false);

  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);

  if (!visited) return null;
  return (
    <div className="studio-host" hidden={!active}>
      <Studio active={active} />
    </div>
  );
}
