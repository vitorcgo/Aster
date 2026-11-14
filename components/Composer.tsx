"use client";

import { motion } from "motion/react";
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onStop: () => void;
  running: boolean;
  size?: "hero" | "dock";
  autoFocus?: boolean;
};

export function Composer({ value, onChange, onSubmit, onStop, running, size = "dock", autoFocus }: Props) {
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, size === "hero" ? 168 : 132)}px`;
  }, [value, size]);

  useEffect(() => {
    if (autoFocus) field.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (running) return;
    const text = value.trim();
    if (text.length < 3) return;
    onSubmit(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const ready = value.trim().length >= 3;

  return (
    <motion.form layoutId="composer" className={`composer composer-${size}`} onSubmit={send} transition={{ type: "spring", duration: 0.6, bounce: 0.12 }}>
      <label className="visually-hidden" htmlFor={`question-${size}`}>Sua pergunta para o Aster</label>
      <textarea
        id={`question-${size}`}
        ref={field}
        rows={1}
        value={value}
        maxLength={500}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={size === "hero" ? "Pergunte sobre qualquer aula, ou sobre IA em geral" : "Pergunte outra coisa"}
        data-cursor="composer"
      />
      {running ? (
        <button type="button" className="send-button is-stop" onClick={onStop} aria-label="Parar a pesquisa">
          <Icon name="stop" size={18} />
        </button>
      ) : (
        <button type="submit" className="send-button" disabled={!ready} aria-label="Enviar pergunta">
          <Icon name="arrowUp" size={20} strokeWidth={2.3} />
        </button>
      )}
    </motion.form>
  );
}
