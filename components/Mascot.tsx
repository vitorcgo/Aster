import type { CSSProperties } from "react";

export type MascotMood = "idle" | "thinking" | "writing" | "success";

const labels: Record<MascotMood, string> = {
  idle: "Aster aguardando",
  thinking: "Aster pesquisando",
  writing: "Aster escrevendo",
  success: "Aster terminou",
};

/** As quatro expressões fornecidas pelo usuário, em public/mascot. */
export function Mascot({ mood, size = 40, className = "", decorative = true, style }: { mood: MascotMood; size?: number; className?: string; decorative?: boolean; style?: CSSProperties }) {
  return (
    // key força o reinício da animação interna do SVG a cada troca de estado
    <img key={mood} src={`/mascot/${mood}.svg`} width={size} height={size} alt={decorative ? "" : labels[mood]} className={`mascot ${className}`} style={style} draggable={false} />
  );
}
