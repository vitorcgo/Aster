"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { FLY_EVENT, ease, type FlyRequest } from "@/lib/motion";

type Box = { left: number; top: number; width: number; height: number };
type Trip = { id: number; from: Box; to: Box; label: string; tone: FlyRequest["tone"]; target: Element; hide: boolean };

/** A caixa só conta se está à vista: dentro da tela e dentro de cada painel com rolagem acima dela. */
function visibleBox(element: Element): Box | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return null;
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll|hidden)/.test(style.overflowY + style.overflowX)) {
      const clip = parent.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const midY = rect.top + rect.height / 2;
      if (midX < clip.left || midX > clip.right || midY < clip.top || midY > clip.bottom) return null;
    }
    parent = parent.parentElement;
  }
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

let counter = 0;

/**
 * Camada dos voos: o trecho marcado no slide se solta e vira o chip da citação; o fato guardado voa até
 * o botão Memória. Fica acima dos painéis e abaixo do cursor do Aster, sem pegar cliques.
 */
export function Flight() {
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    const onFly = (event: Event) => {
      const request = (event as CustomEvent<FlyRequest>).detail;
      const from = visibleBox(request.from);
      const to = visibleBox(request.to);
      // se uma das pontas está fora de vista, o voo não explicaria nada: o destino só aparece
      if (!from || !to) return;
      const hide = request.hideTarget ?? false;
      if (hide) request.to.classList.add("is-incoming");
      // o fantasma nasce do tamanho do trecho, mas sem passar de uma linha larga
      const start = { ...from, width: Math.min(from.width, 320), height: Math.min(from.height, 44) };
      setTrips((list) => [...list, { id: ++counter, from: start, to, label: request.label, tone: request.tone, target: request.to, hide }]);
    };
    window.addEventListener(FLY_EVENT, onFly);
    return () => window.removeEventListener(FLY_EVENT, onFly);
  }, []);

  const land = (trip: Trip) => {
    trip.target.classList.remove("is-incoming");
    trip.target.classList.remove("is-landed");
    // força o navegador a reiniciar a animação de pouso se ela acabou de rodar
    void (trip.target as HTMLElement).offsetWidth;
    trip.target.classList.add("is-landed");
    window.setTimeout(() => trip.target.classList.remove("is-landed"), 800);
    setTrips((list) => list.filter((item) => item.id !== trip.id));
  };

  return (
    <div className="flight-layer" aria-hidden="true">
      <AnimatePresence>
        {trips.map((trip) => {
          const { from, to } = trip;
          const distance = Math.hypot(to.left - from.left, to.top - from.top);
          // arco para cima: sobe um pouco no meio do caminho, como algo jogado de um painel ao outro
          const lift = Math.min(140, 40 + distance * 0.18);
          const midLeft = (from.left + to.left) / 2;
          const midTop = Math.min(from.top, to.top) - lift;
          return (
            <motion.div
              key={trip.id}
              className={`flight flight-${trip.tone}`}
              initial={{ left: from.left, top: from.top, width: from.width, height: from.height, opacity: 0.2 }}
              animate={{
                left: [from.left, midLeft - (from.width + to.width) / 4, to.left],
                top: [from.top, midTop, to.top],
                width: [from.width, (from.width + to.width) / 2, to.width],
                height: [from.height, Math.max(from.height, to.height), to.height],
                opacity: [0.2, 1, 1],
              }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: Math.min(0.95, 0.55 + distance / 2800), ease, times: [0, 0.5, 1] }}
              onAnimationComplete={() => land(trip)}
            >
              <span>{trip.label}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
