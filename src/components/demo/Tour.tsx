"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface TourStep {
  title: string;
  body: string;
  /** Value of the data-tour attribute to spotlight. Omit for a centered card. */
  target?: string;
  /** Demo tab that must be showing for this step. */
  tab?: string;
  /** Short instruction shown above the buttons, e.g. "Click Members". */
  action?: string;
  /** When true, clicking the spotlighted element also advances the tour. */
  advanceOnClick?: boolean;
  /** When true, submitting the spotlighted form advances the tour. */
  advanceOnSubmit?: boolean;
  /** Custom buttons on the final card. */
  final?: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 8;

export default function Tour({
  steps,
  onTab,
  onClose,
  renderFinal,
}: {
  steps: TourStep[];
  onTab: (tab: string) => void;
  onClose: () => void;
  renderFinal: () => React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: 1200, h: 800 });
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), [steps.length]);
  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  const measure = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    if (!step.target) return setRect(null);
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, [step.target]);

  // Switch tabs, then wait for the target to render, bring it into view and measure it.
  useLayoutEffect(() => {
    if (step.tab) onTab(step.tab);
    let frames = 0;
    let raf = 0;
    const settle = () => {
      const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
      if (step.target && !el && frames++ < 20) {
        raf = requestAnimationFrame(settle);
        return;
      }
      if (el) {
        const r = el.getBoundingClientRect();
        const offscreen = r.top < 70 || r.bottom > window.innerHeight - 40;
        if (offscreen) {
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ block: window.innerWidth < 640 ? "start" : "center", behavior: reduce ? "auto" : "smooth" });
        }
      }
      measure();
      // Smooth scrolling changes the rect over time; re-measure shortly after.
      setTimeout(measure, 350);
    };
    raf = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(raf);
  }, [index, step.tab, step.target, onTab, measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  // Clicking the highlighted element (e.g. a nav tab) moves on, after the app's own handler runs.
  useEffect(() => {
    if ((!step.advanceOnClick && !step.advanceOnSubmit) || !step.target) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;
    const evt = step.advanceOnSubmit ? "submit" : "click";
    el.addEventListener(evt, next);
    return () => el.removeEventListener(evt, next);
  }, [step, next, rect]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onClose]);

  const small = vp.w < 640;
  const cardW = Math.min(380, vp.w - 32);
  let cardStyle: React.CSSProperties;
  if (!rect) {
    cardStyle = { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: cardW };
  } else if (small) {
    // Keep the sheet on the opposite half of the screen from the spotlighted element.
    const targetLow = rect.y + rect.h / 2 > vp.h / 2;
    cardStyle = targetLow ? { left: 16, right: 16, top: 12 } : { left: 16, right: 16, bottom: 16 };
  } else {
    const below = rect.y + rect.h + PAD + 16;
    const fitsBelow = below + 240 < vp.h;
    const top = fitsBelow ? below : Math.max(16, rect.y - PAD - 16 - 230);
    const left = Math.min(Math.max(16, rect.x), vp.w - cardW - 16);
    cardStyle = { left, top, width: cardW };
  }

  const hole = rect
    ? {
        x: Math.max(rect.x - PAD, 0),
        y: Math.max(rect.y - PAD, 0),
        w: rect.w + PAD * 2,
        h: rect.h + PAD * 2,
      }
    : null;
  // Even-odd style cut-out: the polygon traces the screen, then the hole; hit-testing follows
  // the clip so clicks inside the hole reach the real element underneath.
  const clip = hole
    ? `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${hole.x}px ${hole.y}px, ${hole.x}px ${hole.y + hole.h}px, ${hole.x + hole.w}px ${hole.y + hole.h}px, ${hole.x + hole.w}px ${hole.y}px, ${hole.x}px ${hole.y}px)`
    : undefined;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/65" style={{ clipPath: clip }} aria-hidden="true" />
      {hole && (
        <div
          className="pointer-events-none fixed z-[61] rounded-xl border-2 border-plate-yellow shadow-[0_0_0_4px_rgba(232,185,35,0.25)]"
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
          aria-hidden="true"
        />
      )}

      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-live="polite"
        aria-label={`Tour step ${index + 1} of ${steps.length}: ${step.title}`}
        className="fixed z-[62] rounded-2xl border border-neutral-700 bg-neutral-900 p-5 text-white shadow-2xl outline-none"
        style={cardStyle}
      >
        <div className="mb-3 flex items-center justify-between text-xs text-neutral-400">
          <span>
            Step {index + 1} of {steps.length}
          </span>
          <button onClick={onClose} className="rounded px-1 hover:text-white">
            Skip tour
          </button>
        </div>
        <h2 className="font-display text-xl font-semibold">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-300">{step.body}</p>
        {step.action && (
          <p className="mt-3 rounded-lg bg-plate-yellow/15 px-3 py-2 text-sm font-medium text-plate-yellow">{step.action}</p>
        )}

        {last ? (
          <div className="mt-5">
            {renderFinal()}
            <button onClick={back} className="mt-3 text-xs text-neutral-500 hover:text-neutral-300">
              ← Back to the last step
            </button>
          </div>
        ) : (
          <div className="mt-5 flex items-center gap-4">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-700" aria-hidden="true">
              <div
                className="h-full rounded-full bg-plate-yellow transition-[width] duration-300"
                style={{ width: `${((index + 1) / steps.length) * 100}%` }}
              />
            </div>
            <div className="flex shrink-0 gap-2">
              {index > 0 && (
                <button onClick={back} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800">
                  Back
                </button>
              )}
              <button onClick={next} className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                {index === 0 ? "Start the tour" : "Next"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
