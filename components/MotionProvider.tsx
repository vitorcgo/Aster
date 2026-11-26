"use client";

import { MotionConfig } from "motion/react";

/** Quem pediu "reduzir movimento" no sistema recebe as animações do Motion sem deslocamento (só troca de opacidade),
 *  como o CSS já faz com as animações próprias. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
