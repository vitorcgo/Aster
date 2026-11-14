/**
 * Um só vocabulário de movimento para o site inteiro: as mesmas curvas e molas em todas as telas.
 * Regra da casa: cada animação conta um acontecimento real e termina sozinha; nada fica piscando parado.
 */
export const ease = [0.23, 1, 0.32, 1] as const;
export const easeInOut = [0.77, 0, 0.175, 1] as const;

export const spring = {
  /** troca de aba, pílulas, coisas pequenas que precisam responder rápido */
  snappy: { type: "spring", stiffness: 480, damping: 38 },
  /** painéis e cartões entrando */
  soft: { type: "spring", duration: 0.6, bounce: 0.12 },
  /** reação do mascote, acerto, algo que "pula" */
  pop: { type: "spring", stiffness: 380, damping: 16 },
} as const;

export function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const FLY_EVENT = "aster:fly";

export type FlyRequest = {
  /** de onde sai: o trecho marcado no slide, o card da web, o selo "Guardei" */
  from: Element;
  /** onde pousa: o chip da citação, o botão Memória */
  to: Element;
  label: string;
  tone: "aula" | "web" | "memory";
  /** o destino fica invisível durante o voo, para parecer que o fantasma vira ele */
  hideTarget?: boolean;
};

/** Pede um voo de um elemento até outro. Sem movimento reduzido e com os dois visíveis, a camada Flight anima. */
export function fly(request: FlyRequest) {
  if (reducedMotion()) return;
  window.dispatchEvent(new CustomEvent<FlyRequest>(FLY_EVENT, { detail: request }));
}
