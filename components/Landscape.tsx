"use client";

import { useEffect, useRef } from "react";

/**
 * Fundo vivo: a paisagem fornecida pelo usuário, com glifos que derivam pelo céu
 * e vaga-lumes sobre os morros. Tudo em um canvas leve, pausado com movimento reduzido.
 */
export function Landscape({ dim = false, paused = false }: { dim?: boolean; paused?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // profundidade: na tela inicial, a paisagem acompanha o mouse de leve (os glifos do céu, mais perto, andam mais)
  useEffect(() => {
    const element = root.current;
    if (!element || dim || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      frame = 0;
      element.style.setProperty("--px", x.toFixed(3));
      element.style.setProperty("--py", y.toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      x = event.clientX / window.innerWidth - 0.5;
      y = event.clientY / window.innerHeight - 0.5;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
      element.style.setProperty("--px", "0");
      element.style.setProperty("--py", "0");
    };
  }, [dim, paused]);

  useEffect(() => {
    const surface = canvas.current;
    if (!surface || paused) return;
    const context = surface.getContext("2d");
    if (!context) return;
    // com a sessão aberta os painéis cobrem quase todo o céu: um quadro parado basta, e o vidro desfocado
    // não precisa ser recalculado a cada quadro
    const reduced = dim || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const styles = getComputedStyle(document.documentElement);
    const skyInk = styles.getPropertyValue("--glyph-sky").trim() || "#cfe6ff";
    const fireflyInk = styles.getPropertyValue("--lime").trim() || "#d5ff6e";
    const glyphs = ["+", "·", "*", ":", "°", "."];
    let width = 0;
    let height = 0;
    let frame = 0;
    type Mote = { x: number; y: number; speed: number; glyph: string; size: number; phase: number; firefly: boolean };
    let motes: Mote[] = [];

    const seed = () => {
      const count = Math.round((width * height) / 26000);
      motes = Array.from({ length: count }, (_, index) => {
        const firefly = index % 5 === 0;
        return {
          x: Math.random() * width,
          y: firefly ? height * (0.68 + Math.random() * 0.3) : Math.random() * height * 0.58,
          speed: firefly ? 0.05 + Math.random() * 0.08 : 0.06 + Math.random() * 0.16,
          glyph: firefly ? "·" : glyphs[index % glyphs.length],
          size: firefly ? 18 + Math.random() * 8 : 10 + Math.random() * 7,
          phase: Math.random() * Math.PI * 2,
          firefly,
        };
      });
    };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = surface.clientWidth;
      height = surface.clientHeight;
      surface.width = width * ratio;
      surface.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      seed();
      if (reduced) draw(0);
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      for (const mote of motes) {
        if (!reduced) {
          mote.x += mote.speed;
          if (mote.firefly) mote.y += Math.sin(time / 1400 + mote.phase) * 0.12;
          if (mote.x > width + 20) mote.x = -20;
        }
        const twinkle = 0.5 + 0.5 * Math.sin(time / (mote.firefly ? 700 : 1900) + mote.phase);
        context.globalAlpha = mote.firefly ? 0.25 + twinkle * 0.7 : 0.12 + twinkle * 0.32;
        context.fillStyle = mote.firefly ? fireflyInk : skyInk;
        context.font = `${mote.size}px "IBM Plex Mono", monospace`;
        context.fillText(mote.glyph, mote.x, mote.y);
      }
      context.globalAlpha = 1;
    };

    const loop = (time: number) => {
      draw(time);
      frame = requestAnimationFrame(loop);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    if (!reduced) frame = requestAnimationFrame(loop);
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !reduced) frame = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paused, dim]);

  return (
    <div className={`landscape ${dim ? "is-dim" : ""}`} aria-hidden="true" ref={root}>
      <div className="landscape-depth is-far">
        <img className="landscape-image" src="/backgrounds/aster-landscape.png" alt="" />
      </div>
      <div className="landscape-depth is-near">
        <canvas ref={canvas} className="landscape-glyphs" />
      </div>
      <div className="landscape-veil" />
    </div>
  );
}
