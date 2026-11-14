"use client";

import { AnimatePresence, motion, useSpring } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { announce, drawEase, DRAW_MS } from "@/lib/draw";

export type CursorGesture = "point" | "click" | "select" | "read" | "type" | "draw";
export type CursorState = { target: string; label: string; gesture: CursorGesture; key: number } | null;

const SPRING = { stiffness: 140, damping: 22, mass: 0.9 };

function rectOf(target: string) {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(`[data-cursor="${target}"]`)).filter((element) => element.offsetParent !== null || element.getClientRects().length);
  return elements.map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
}

function visible(rect: DOMRect) {
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

/**
 * Cursor colaborativo do Aster. É só desenho: não captura o ponteiro do aluno
 * (pointer-events: none) e segue elementos reais marcados com data-cursor.
 */
export function AsterCursor({ state }: { state: CursorState }) {
  // molas independentes: presas a outro valor animado, o salto inicial era desfeito
  const springX = useSpring(-80, SPRING);
  const springY = useSpring(-80, SPRING);
  const [clicks, setClicks] = useState<number[]>([]);
  const [arrived, setArrived] = useState(false);
  const started = useRef(0);
  const wake = useRef<HTMLCanvasElement>(null);
  const reduced = useRef(false);
  const size = useRef<HTMLSpanElement>(null);
  const [drawing, setDrawing] = useState(false);
  // perto da borda direita o rótulo passa para a esquerda do cursor, para não sair da tela
  const [flip, setFlip] = useState(false);
  useEffect(() => springX.on("change", (x) => setFlip(x > window.innerWidth - 300)), [springX]);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Ponto de partida: o mascote no topo, de onde o cursor "sai".
  useEffect(() => {
    if (!state) return;
    if (springX.get() < 0) {
      // surge perto do primeiro alvo, em vez de cruzar a tela (e o chat) vindo do canto
      const first = rectOf(state.target)[0] ?? rectOf("mascot")[0];
      springX.jump(first ? Math.max(8, first.left - 36) : window.innerWidth / 2);
      springY.jump(first ? Math.max(8, first.top - 30) : 40);
    }
  }, [state, springX, springY]);

  useEffect(() => {
    if (!state) return;
    started.current = performance.now();
    setArrived(false);
    let frame = 0;
    let clicked = false;
    let drawStart = 0;
    let drawEnded = false;
    setDrawing(false);
    // medir o alvo força layout; a cada 4 quadros basta para seguir o que se move na tela
    let rects: DOMRect[] = [];
    let frameCount = 0;
    const tick = (now: number) => {
      if (frameCount++ % 4 === 0 || !rects.length) rects = rectOf(state.target);
      if (rects.length) {
        const first = rects[0];
        const elapsed = now - started.current;
        // ponto de repouso: canto inferior direito, para a etiqueta não cobrir o conteúdo
        let targetX = Math.min(first.right - 14, first.left + first.width * 0.86);
        let targetY = Math.min(first.bottom - 10, first.top + Math.max(18, first.height * 0.8));
        if (state.gesture === "draw") {
          if (!drawStart) {
            targetX = first.left;
            targetY = first.top;
          } else {
            const progress = reduced.current ? 1 : drawEase(Math.min(1, (now - drawStart) / DRAW_MS));
            targetX = first.left + first.width * progress;
            targetY = first.top + first.height * progress;
            springX.jump(targetX); springY.jump(targetY);
            if (size.current) size.current.textContent = `${Math.round(first.width * progress)} × ${Math.round(first.height * progress)}`;
            if (progress >= 1 && !drawEnded) {
              drawEnded = true;
              setDrawing(false);
              announce("aster:drawn", state.target);
            }
            frame = requestAnimationFrame(tick);
            return;
          }
        } else if (state.gesture === "select") {
          // percorre as linhas do trecho destacado, da primeira à última
          const total = rects.reduce((sum, rect) => sum + rect.width, 0);
          const progress = reduced.current ? 1 : Math.min(1, Math.max(0, (elapsed - 650) / 1300));
          let distance = total * progress;
          let current = rects[rects.length - 1];
          let offset = current.width;
          for (const rect of rects) {
            if (distance <= rect.width) { current = rect; offset = distance; break; }
            distance -= rect.width;
          }
          targetX = current.left + offset;
          targetY = current.top + current.height * 0.55;
        } else if (state.gesture === "read") {
          const sweep = reduced.current ? 0.5 : (Math.sin(elapsed / 900) + 1) / 2;
          targetX = first.left + first.width * 0.72;
          targetY = first.top + 28 + Math.max(0, first.height - 56) * sweep;
        } else if (state.gesture === "type") {
          targetX = Math.min(first.right - 18, first.left + first.width * 0.82);
          targetY = first.bottom - 26;
        }
        if (!visible(first) && state.gesture !== "type") {
          targetX = Math.max(12, Math.min(window.innerWidth - 40, targetX));
          targetY = Math.max(12, Math.min(window.innerHeight - 40, targetY));
        }
        springX.set(targetX);
        springY.set(targetY);
        const near = Math.hypot(springX.get() - targetX, springY.get() - targetY) < (state.gesture === "draw" ? 3 : 6);
        if (near && !clicked) {
          clicked = true;
          setArrived(true);
          if (state.gesture === "click") setClicks((list) => [...list.slice(-3), now]);
          if (state.gesture === "draw") {
            drawStart = now;
            setDrawing(true);
            announce("aster:arrive", state.target);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state, springX, springY]);

  // Rastro curto de glifos atrás do cursor
  useEffect(() => {
    const surface = wake.current;
    if (!surface || !state || reduced.current) return;
    const context = surface.getContext("2d");
    if (!context) return;
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--lime").trim() || "#d5ff6e";
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      surface.width = window.innerWidth * ratio;
      surface.height = window.innerHeight * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const marks: { x: number; y: number; life: number; glyph: string }[] = [];
    const glyphs = ["*", "+", ":", "·"];
    let lastX = springX.get();
    let lastY = springY.get();
    let serial = 0;
    let last = performance.now();
    let frame = 0;
    let dirty = false;
    const draw = (now: number) => {
      const delta = Math.min(64, now - last);
      last = now;
      const currentX = springX.get();
      const currentY = springY.get();
      if (Math.hypot(currentX - lastX, currentY - lastY) > 11) {
        marks.push({ x: currentX - 2, y: currentY + 4, life: 1, glyph: glyphs[serial++ % glyphs.length] });
        lastX = currentX; lastY = currentY;
      }
      // sem marcas na tela não há o que limpar nem desenhar
      if (!marks.length && !dirty) { frame = requestAnimationFrame(draw); return; }
      dirty = marks.length > 0;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      context.font = "600 15px 'IBM Plex Mono', monospace";
      context.fillStyle = ink;
      for (let index = marks.length - 1; index >= 0; index--) {
        const mark = marks[index];
        mark.life -= delta / 700;
        if (mark.life <= 0) { marks.splice(index, 1); continue; }
        context.globalAlpha = mark.life * 0.85;
        context.fillText(mark.glyph, mark.x, mark.y);
      }
      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
  }, [state, springX, springY]);

  const gesture = state?.gesture ?? "point";

  return (
    <>
      <canvas ref={wake} className="cursor-wake" aria-hidden="true" />
      <AnimatePresence>
        {state && (
          <motion.div
            className="aster-cursor"
            data-gesture={gesture}
            data-flip={flip || undefined}
            style={{ x: springX, y: springY }}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.25 } }}
            aria-hidden="true"
          >
            {clicks.map((stamp) => (
              <motion.span key={stamp} className="cursor-ripple" initial={{ scale: 0.3, opacity: 0.9 }} animate={{ scale: 2.4, opacity: 0 }} transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }} onAnimationComplete={() => setClicks((list) => list.filter((item) => item !== stamp))} />
            ))}
            {gesture === "draw" ? (
              <svg className="cursor-cross" width="26" height="26" viewBox="0 0 26 26"><path d="M13 1v24M1 13h24" stroke="var(--cursor-outline)" strokeWidth="5" strokeLinecap="round" /><path d="M13 1v24M1 13h24" stroke="var(--lime)" strokeWidth="2.2" strokeLinecap="round" /></svg>
            ) : gesture === "select" || gesture === "type" ? (
              <svg className="cursor-beam" width="16" height="26" viewBox="0 0 16 26"><path d="M4 2h3.5M8.5 2H12M8 2v22M4 24h3.5M8.5 24H12" stroke="var(--cursor-outline)" strokeWidth="5" strokeLinecap="round" /><path d="M4 2h3.5M8.5 2H12M8 2v22M4 24h3.5M8.5 24H12" stroke="var(--lime)" strokeWidth="2.2" strokeLinecap="round" /></svg>
            ) : (
              <motion.svg className="cursor-arrow" width="28" height="32" viewBox="0 0 28 32" animate={arrived && gesture === "click" ? { scale: [1, 0.86, 1] } : { scale: 1 }} transition={{ duration: 0.28 }}>
                <path d="M3 2.5v23.2l6.3-5.9 4.5 9.4 4.6-2.2-4.5-9.3h8.7z" fill="var(--lime)" stroke="var(--cursor-outline)" strokeWidth="2.4" strokeLinejoin="round" />
              </motion.svg>
            )}
            {drawing && <span className="cursor-size" ref={size} />}
            <motion.span layout className="cursor-label" transition={{ type: "spring", stiffness: 380, damping: 30 }}>
              <span className="cursor-name">Aster</span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={state.label} className="cursor-action" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                  {state.label}
                </motion.span>
              </AnimatePresence>
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
