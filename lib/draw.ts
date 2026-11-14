"use client";

import { useEffect, useState } from "react";

/**
 * Sincronia entre o cursor Aster e o que ele desenha.
 * O cursor avisa quando chega ao canto de partida (aster:arrive) e quando solta (aster:drawn);
 * o elemento cresce no mesmo intervalo e com a mesma curva.
 */
export const DRAW_MS = 640;
export const DRAW_EASE = [0.65, 0, 0.35, 1] as const;

export function drawEase(t: number) {
  // easeInOutCubic, a mesma curva de DRAW_EASE
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const drawn = new Set<string>();

export function markDrawn(target: string) {
  drawn.add(target);
}

export function forgetDrawn(match: (target: string) => boolean) {
  for (const target of Array.from(drawn)) if (match(target)) drawn.delete(target);
}

export function announce(type: "aster:arrive" | "aster:drawn", target: string) {
  window.dispatchEvent(new CustomEvent(type, { detail: { target } }));
}

export function waitForDrawn(target: string, timeout = 2600) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.removeEventListener("aster:drawn", onDrawn);
      window.clearTimeout(timer);
      resolve();
    };
    const onDrawn = (event: Event) => {
      if ((event as CustomEvent).detail?.target === target) finish();
    };
    const timer = window.setTimeout(finish, timeout);
    window.addEventListener("aster:drawn", onDrawn);
  });
}

export type DrawPhase = "wait" | "draw" | "done";

/** Fase de desenho de um elemento. Elementos já desenhados (ou sem cursor) aparecem prontos. */
export function useDrawPhase(target: string, enabled: boolean): DrawPhase {
  const [phase, setPhase] = useState<DrawPhase>(() => (enabled && !drawn.has(target) ? "wait" : "done"));

  useEffect(() => {
    if (phase === "done") { drawn.add(target); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPhase("done"); return; }
    if (phase === "draw") {
      const timer = window.setTimeout(() => setPhase("done"), DRAW_MS + 40);
      return () => window.clearTimeout(timer);
    }
    const onArrive = (event: Event) => {
      if ((event as CustomEvent).detail?.target === target) setPhase("draw");
    };
    // se o cursor não vier (fora da tela, aba em segundo plano), desenha sozinho
    const fallback = window.setTimeout(() => setPhase((current) => (current === "wait" ? "draw" : current)), 2400);
    window.addEventListener("aster:arrive", onArrive);
    return () => {
      window.removeEventListener("aster:arrive", onArrive);
      window.clearTimeout(fallback);
    };
  }, [phase, target]);

  return phase;
}
