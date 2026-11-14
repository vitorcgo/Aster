"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

export type MascotMood = "idle" | "thinking" | "writing" | "success";

const labels: Record<MascotMood, string> = {
  idle: "Aster aguardando",
  thinking: "Aster pesquisando",
  writing: "Aster escrevendo",
  success: "Aster terminou",
};

/**
 * As quatro expressões fornecidas pelo usuário, em public/mascot.
 * Cada troca de estado remonta a imagem (key), e o CSS dá um pequeno "squash and stretch" de entrada.
 * `alert` faz ele balançar a cabeça uma vez, quando algo falhou.
 * Clicar nele faz ele pular feliz por um instante, mostrando a cara de sucesso.
 */
export function Mascot({ mood, size = 40, className = "", decorative = true, style, alert = false }: { mood: MascotMood; size?: number; className?: string; decorative?: boolean; style?: CSSProperties; alert?: boolean }) {
  const [poke, setPoke] = useState(0);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onPoke = () => {
    setPoke((value) => value + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPoke(0), 1600);
  };
  const shown: MascotMood = poke ? "success" : mood;
  const tone = poke ? "mascot-poke" : alert ? "mascot-alert" : "";
  return (
    // key força o reinício da animação interna do SVG a cada troca de estado (e a cada clique)
    <img
      key={`${shown}${alert ? "-alert" : ""}-${poke}`}
      src={`/mascot/${shown}.svg`}
      width={size}
      height={size}
      alt={decorative ? "" : labels[mood]}
      className={`mascot ${tone} ${className}`}
      style={style}
      draggable={false}
      onClick={onPoke}
    />
  );
}
