"use client";

import { useEffect, useRef } from "react";
import { wavePulse } from "./pulse";

const CRESTS = [290.8, 302.8, 314.8, 326.8];
const VALLEYS = [284.8, 296.8, 308.8, 320.8, 332.8];
const VALLEY_Y = 96;
const CREST_Y = 47;
const PULSE_DECAY_MS = 300;

function wavePoints(crestY: number): string {
  const points: string[] = [];
  for (let i = 0; i < CRESTS.length; i++) {
    points.push(`${VALLEYS[i]},${VALLEY_Y}`, `${CRESTS[i]},${crestY}`);
  }
  points.push(`${VALLEYS[VALLEYS.length - 1]},${VALLEY_Y}`);
  return points.join(" ");
}

export default function Wordmark({ className }: { className?: string }) {
  const waveRef = useRef<SVGPolylineElement>(null);

  // The wave jumps with each slot's velocity and settles back to the brand
  // shape, so the logo doubles as the page's sign of life.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let lastLevel = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const level =
        wavePulse.at === 0
          ? 0
          : wavePulse.level *
            Math.exp(-(performance.now() - wavePulse.at) / PULSE_DECAY_MS);
      if (level < 0.005 && lastLevel < 0.005) return;
      lastLevel = level;
      waveRef.current?.setAttribute(
        "points",
        wavePoints(CREST_Y - (VALLEY_Y - CREST_Y) * 0.35 * level),
      );
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      viewBox="0 0 560 144"
      fill="none"
      role="img"
      aria-label="Slotwave"
      className={className}
    >
      <text
        x="280"
        y="98"
        textAnchor="end"
        fontSize="96"
        fill="#E2E8F0"
        className="font-mono"
      >
        slot
      </text>
      <polyline
        ref={waveRef}
        points={wavePoints(CREST_Y)}
        pathLength={100}
        stroke="#22E584"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-wave-in"
      />
      <text x="337.6" y="98" fontSize="96" fill="#E2E8F0" className="font-mono">
        ave
      </text>
    </svg>
  );
}
