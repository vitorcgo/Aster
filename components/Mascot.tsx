import type { CSSProperties } from "react";

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
 */
export function Mascot({ mood, size = 40, className = "", decorative = true, style, alert = false }: { mood: MascotMood; size?: number; className?: string; decorative?: boolean; style?: CSSProperties; alert?: boolean }) {
  return (
    // key força o reinício da animação interna do SVG a cada troca de estado
    <img key={`${mood}${alert ? "-alert" : ""}`} src={`/mascot/${mood}.svg`} width={size} height={size} alt={decorative ? "" : labels[mood]} className={`mascot ${alert ? "mascot-alert" : ""} ${className}`} style={style} draggable={false} />
  );
}
