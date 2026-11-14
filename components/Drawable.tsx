"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { DRAW_EASE, DRAW_MS, useDrawPhase } from "@/lib/draw";

type Props = Omit<HTMLMotionProps<"div">, "animate" | "initial" | "children"> & {
  children?: React.ReactNode;
  target: string;
  enabled: boolean;
  radius?: number;
  tag?: "div" | "article";
};

/**
 * Elemento que o cursor Aster desenha: cresce a partir do canto superior esquerdo,
 * com moldura tracejada e alças de canto, e só depois mostra o conteúdo.
 */
export function Drawable({ target, enabled, radius = 18, tag = "div", className = "", children, ...rest }: Props) {
  const phase = useDrawPhase(target, enabled);
  const Tag = tag === "article" ? motion.article : motion.div;
  const closed = `inset(0% 100% 100% 0% round ${radius}px)`;
  const open = `inset(0% 0% 0% 0% round ${radius}px)`;
  return (
    <Tag
      {...rest}
      data-cursor={target}
      data-phase={phase}
      className={`drawable ${className}`}
      initial={false}
      animate={{ clipPath: phase === "wait" ? closed : open }}
      transition={{ duration: phase === "draw" ? DRAW_MS / 1000 : 0, ease: DRAW_EASE }}
    >
      {phase !== "done" && (
        <span className="draw-frame" aria-hidden="true" style={{ borderRadius: radius }}>
          <i /><i /><i /><i />
        </span>
      )}
      {children}
    </Tag>
  );
}
