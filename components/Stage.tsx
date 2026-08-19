"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatClock,
  formatCu,
  formatFailedShare,
  formatInt,
  formatSol,
} from "@/lib/format";
import type { PlayedSlot, Session } from "@/lib/session";
import { realTxCount } from "@/lib/types";

/** Mutable frame shared by the transport (writer) and the stage (reader). */
export interface FrameState {
  session: Session | null;
  lastEmit: { index: number; at: number } | null;
  playing: boolean;
}

export type Status = "idle" | "loading" | "playing" | "paused";

const SPACING = 9; // css px per slot on the tape
const PLAYHEAD_RATIO = 0.72;
const SLOT_MS = 400;
const FLASH_S = 0.35;
const TOOLTIP_W = 232;
const DRAG_THRESHOLD_PX = 4;

interface StageProps {
  frame: React.RefObject<FrameState>;
  status: Status;
  /** Land the playhead on this slot; playback continues from the next one. */
  onSeek: (position: number) => void;
  /** The user grabbed the tape, playback should hold its breath. */
  onScrubStart: () => void;
  /** Preview while dragging, lets the readout follow the user's hand. */
  onScrub: (position: number) => void;
  /** Drag finished: land at `position`, or null if the drag was cancelled. */
  onScrubEnd: (position: number | null) => void;
  /** Click on an idle stage = the start gesture. */
  onActivate: () => void;
}

export default function Stage({
  frame,
  status,
  onSeek,
  onScrubStart,
  onScrub,
  onScrubEnd,
  onActivate,
}: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<{ x: number; index: number } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startHead: number;
    moved: boolean;
  } | null>(null);
  const lastScrubRef = useRef(-1);
  const scrubRef = useRef<number | null>(null);
  // touch has no hover: a long-press opens the slot inspector instead
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const downClientXRef = useRef(0);
  const reducedRef = useRef(false);
  const [hoverSlot, setHoverSlot] = useState<PlayedSlot | null>(null);
  const [hoverLeft, setHoverLeft] = useState(0);
  const [dragging, setDragging] = useState(false);
  // the draw loop lives in a []-effect; it reads status through this ref,
  // synced after commit (writing refs during render breaks React's rules)
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const playheadFloat = (): number => {
    const f = frame.current;
    if (!f) return -Infinity;
    if (scrubRef.current !== null) return scrubRef.current;
    const length = f.session?.slots.length ?? 0;
    if (length === 0) return -Infinity;
    // seeked to the very start, or nothing emitted yet: park just before slot 0
    if (!f.lastEmit) return -0.5;
    const progress =
      f.playing && !reducedRef.current
        ? Math.min(1, (performance.now() - f.lastEmit.at) / SLOT_MS)
        : 0;
    // never glide past the newest buffered slot (waiting at the live tip)
    return Math.min(f.lastEmit.index + progress, length - 1);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    reducedRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    const colors = {
      signal: token("--color-signal", "#22e584"),
      event: token("--color-event", "#8b5cf6"),
      muted: token("--color-muted", "#94a3b8"),
      ink: token("--color-ink", "#e2e8f0"),
    };
    const monoFamily =
      token("--font-jetbrains-mono", "") || "'JetBrains Mono', monospace";

    // When nothing animates (paused, no hover, no drag, flashes decayed)
    // the last frame simply stays on screen; a few settle frames erase
    // leftovers like the crosshair, then the loop goes dormant. Saves
    // battery on phones left paused.
    let settleFrames = 0;
    let lastSession: Session | null = null;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      settleFrames = 0;
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;

      const f = frame.current;
      // a new session (idle preview arriving, or a start) needs fresh frames
      if (f && f.session !== lastSession) {
        lastSession = f.session;
        settleFrames = 0;
      }
      const animating = !!(
        f &&
        (f.playing ||
          scrubRef.current !== null ||
          hoverRef.current !== null ||
          dragRef.current ||
          (f.lastEmit && performance.now() - f.lastEmit.at < 2000))
      );
      if (animating) settleFrames = 0;
      else if (settleFrames > 2) return;
      else settleFrames += 1;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      ctx.clearRect(0, 0, width, height);

      const baselineY = height - 36;
      const playheadX = width * PLAYHEAD_RATIO;
      const now = performance.now();
      const session = frame.current?.session ?? null;
      const head = playheadFloat();
      // before the first gesture the tape sits dimmed behind the start button
      const calm = statusRef.current === "idle" ? 0.45 : 1;

      // hairline baseline
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3 * calm;
      ctx.strokeStyle = colors.muted;
      ctx.beginPath();
      ctx.moveTo(0, baselineY);
      ctx.lineTo(width, baselineY);
      ctx.stroke();

      // graph-paper midline: a height reference for reading tick heights
      ctx.globalAlpha = 0.05 * calm;
      ctx.beginPath();
      const midY = baselineY - (baselineY - 16) * 0.5;
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();

      if (session && Number.isFinite(head)) {
        const slots = session.slots;
        const iMin = Math.max(0, Math.floor(head - playheadX / SPACING) - 1);
        const iMax = Math.min(
          slots.length - 1,
          Math.ceil(head + (width - playheadX) / SPACING) + 1,
        );

        ctx.font = `10px ${monoFamily}`;
        ctx.textAlign = "center";

        for (let i = iMin; i <= iMax; i++) {
          const played = slots[i];
          const x = playheadX + (i - head) * SPACING;
          // buffered but not yet played (after a rewind, or live running ahead)
          const ghost = i > head + 0.5;
          const dim = (ghost ? 0.22 : 1) * calm;
          const age =
            played.playedAt === null ? Infinity : (now - played.playedAt) / 1000;
          const flash = age === Infinity ? 0 : Math.exp(-age / FLASH_S);

          // graph-paper verticals every 25 slots, behind everything
          if (played.record.slot % 25 === 0) {
            ctx.globalAlpha = 0.06 * calm;
            ctx.strokeStyle = colors.muted;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, baselineY);
            ctx.stroke();
          }

          // leader rotations (every 4 slots) get a faint boundary mark
          if (i > iMin) {
            const previous = slots[i - 1].record.leader;
            const current = played.record.leader;
            if (current && previous && current !== previous) {
              ctx.globalAlpha = 0.25 * dim;
              ctx.strokeStyle = colors.muted;
              ctx.beginPath();
              ctx.moveTo(x - SPACING / 2, 0);
              ctx.lineTo(x - SPACING / 2, 12);
              ctx.stroke();
            }
          }

          // ruler: calibrated to real slot numbers
          const slotNo = played.record.slot;
          if (slotNo % 10 === 0) {
            ctx.globalAlpha = 0.35 * dim;
            ctx.strokeStyle = colors.muted;
            ctx.beginPath();
            ctx.moveTo(x, baselineY + 19);
            ctx.lineTo(x, baselineY + 23);
            ctx.stroke();
          }
          if (slotNo % 50 === 0) {
            ctx.globalAlpha = 0.5 * dim;
            ctx.fillStyle = colors.muted;
            ctx.fillText(formatInt(slotNo), x, height - 6);
          }

          for (const vp of played.visuals) {
            const subX = x + (vp.offset / 0.4) * SPACING * 0.9;
            if (vp.form === "ground") {
              // fees get their own lane just under the baseline
              ctx.globalAlpha = (0.2 + 0.6 * vp.brightness) * dim;
              ctx.strokeStyle = colors.signal;
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.moveTo(x - SPACING / 2 + 1, baselineY + 4);
              ctx.lineTo(x + SPACING / 2 - 1, baselineY + 4);
              ctx.stroke();
              ctx.lineWidth = 1;
            } else if (vp.form === "grain") {
              // failure static falls in its own band beneath the fee lane
              ctx.globalAlpha = (0.35 + 0.5 * vp.height) * dim;
              ctx.fillStyle = colors.signal;
              ctx.fillRect(subX - 1, baselineY + 9 + (vp.offset / 0.4) * 7, 2, 2);
            } else if (vp.form === "column") {
              ctx.globalAlpha = (0.55 + 0.35 * flash) * dim;
              ctx.strokeStyle = colors.event;
              ctx.fillStyle = colors.event;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(subX, 6);
              ctx.lineTo(subX, baselineY + 6);
              ctx.stroke();
              ctx.fillRect(subX - 2, 2, 4, 4); // flat cap, echoes the playhead
              ctx.lineWidth = 1;
            } else {
              const tickHeight = (0.15 + 0.85 * vp.height) * (baselineY - 16);
              ctx.globalAlpha =
                Math.min(1, 0.3 + 0.45 * vp.brightness + 0.25 * flash) * dim;
              ctx.strokeStyle = colors.signal;
              ctx.beginPath();
              ctx.moveTo(subX, baselineY);
              ctx.lineTo(subX, baselineY - tickHeight);
              ctx.stroke();
            }
          }
        }

        // fixed playhead
        ctx.globalAlpha = 0.7 * calm;
        ctx.strokeStyle = colors.ink;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, baselineY + 8);
        ctx.stroke();
        ctx.fillStyle = colors.ink;
        ctx.fillRect(playheadX - 2, 0, 5, 2);
      }

      // hover crosshair (hidden while dragging)
      const hover = hoverRef.current;
      if (hover && !dragRef.current?.moved) {
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = colors.muted;
        ctx.beginPath();
        ctx.moveTo(hover.x, 0);
        ctx.lineTo(hover.x, baselineY + 8);
        ctx.stroke();
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slotAt = (clientX: number): { index: number; x: number } | null => {
    const canvas = canvasRef.current;
    const session = frame.current?.session;
    if (!canvas || !session || session.slots.length === 0) return null;
    const head = playheadFloat();
    if (!Number.isFinite(head)) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const index = Math.round(head + (x - rect.width * PLAYHEAD_RATIO) / SPACING);
    if (index < 0 || index >= session.slots.length) return null;
    return { index, x };
  };

  const endDrag = (seekTarget: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const target = scrubRef.current;
    scrubRef.current = null;
    if (drag?.moved) {
      setDragging(false);
      onScrubEnd(seekTarget && target !== null ? Math.round(target) : null);
      return true;
    }
    return false;
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const session = frame.current?.session;
    if (!canvas || !session || session.slots.length === 0) return;
    const head = playheadFloat();
    if (!Number.isFinite(head)) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX - rect.left,
      startHead: Math.max(0, head),
      moved: false,
    };
    if (e.pointerType === "touch") {
      // tapping anywhere dismisses an open inspector first
      hoverRef.current = null;
      setHoverSlot(null);
      downClientXRef.current = e.clientX;
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        dragRef.current = null; // holding still means inspect, not drag
        longPressFiredRef.current = true;
        const hit = slotAt(downClientXRef.current);
        if (!hit) return;
        hoverRef.current = hit;
        const slot = frame.current?.session?.slots[hit.index] ?? null;
        setHoverSlot(slot);
        setHoverLeft(
          Math.max(
            0,
            Math.min(hit.x + 14, canvas.getBoundingClientRect().width - TOOLTIP_W),
          ),
        );
      }, 450);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const drag = dragRef.current;
    const f = frame.current;
    const session = f?.session;

    if (drag && f && session && session.slots.length > 0) {
      if (!drag.moved && Math.abs(x - drag.startX) < DRAG_THRESHOLD_PX) return;
      if (!drag.moved) {
        clearLongPress(); // it moved, so it is a drag after all
        drag.moved = true;
        setDragging(true);
        setHoverSlot(null);
        hoverRef.current = null;
        lastScrubRef.current = -1;
        onScrubStart();
      }
      // grab the tape: dragging left pulls the future under the playhead
      const head = Math.max(
        0,
        Math.min(
          drag.startHead + (drag.startX - x) / SPACING,
          session.slots.length - 1,
        ),
      );
      scrubRef.current = head;
      const index = Math.round(head);
      if (index !== lastScrubRef.current) {
        lastScrubRef.current = index;
        onScrub(index);
      }
      return;
    }

    const hit = slotAt(e.clientX);
    if (!hit) {
      hoverRef.current = null;
      if (hoverSlot) setHoverSlot(null);
      return;
    }
    hoverRef.current = hit;
    const slot = session ? session.slots[hit.index] : null;
    if (slot !== hoverSlot) setHoverSlot(slot);
    setHoverLeft(Math.max(0, Math.min(hit.x + 14, rect.width - TOOLTIP_W)));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    clearLongPress();
    if (longPressFiredRef.current) {
      // lifting the finger after inspecting must not jump the tape
      longPressFiredRef.current = false;
      return;
    }
    if (endDrag(true)) return;
    // plain click: land the playhead on the clicked slot
    const hit = slotAt(e.clientX);
    if (hit) onSeek(hit.index);
  };

  const handlePointerCancel = () => {
    clearLongPress();
    longPressFiredRef.current = false;
    endDrag(false);
    hoverRef.current = null;
    setHoverSlot(null);
  };

  const handleLeave = () => {
    if (dragRef.current?.moved) return; // pointer capture keeps the drag alive
    hoverRef.current = null;
    setHoverSlot(null);
  };

  // Keyboard inspection: shift+arrows step the inspector along the tape,
  // escape dismisses it. Plain arrows stay reserved for seeking.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        hoverRef.current = null;
        setHoverSlot(null);
        return;
      }
      if (
        !event.shiftKey ||
        (event.code !== "ArrowLeft" && event.code !== "ArrowRight")
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && target.tagName === "INPUT") return;
      const session = frame.current?.session;
      const canvas = canvasRef.current;
      if (
        !session ||
        session.slots.length === 0 ||
        !canvas ||
        statusRef.current === "idle"
      ) {
        return;
      }
      const head = playheadFloat();
      if (!Number.isFinite(head)) return;
      event.preventDefault();
      const current =
        hoverRef.current?.index ?? Math.round(Math.max(0, head));
      const next = Math.max(
        0,
        Math.min(
          session.slots.length - 1,
          current + (event.code === "ArrowRight" ? 1 : -1),
        ),
      );
      const rect = canvas.getBoundingClientRect();
      const x = rect.width * PLAYHEAD_RATIO + (next - head) * SPACING;
      hoverRef.current = { x, index: next };
      setHoverSlot(session.slots[next]);
      setHoverLeft(Math.max(0, Math.min(x + 14, rect.width - TOOLTIP_W)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters only
  }, []);

  const spiked = hoverSlot?.events.some((ev) => ev.kind === "cuSpike") ?? false;

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        className={`h-70 w-full touch-pan-y sm:h-85 ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onMouseLeave={handleLeave}
      />
      {status === "idle" && (
        <button
          type="button"
          onClick={onActivate}
          className="absolute inset-0 flex flex-col items-center justify-center gap-3"
        >
          <span className="border border-muted/40 bg-background px-8 py-3 font-mono text-sm lowercase text-signal transition-colors hover:border-signal">
            start listening
          </span>
          <span className="bg-background px-3 py-1 font-mono text-[11px] lowercase text-muted">
            or press space. the browser needs one click before it allows audio
          </span>
        </button>
      )}
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
          <svg viewBox="0 0 64 64" className="h-10 w-10" aria-hidden>
            <polyline
              points="4,57 11,7 18,57 25,7 32,57 39,7 46,57 53,7 60,57"
              pathLength={100}
              fill="none"
              stroke="var(--color-signal)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="100"
              className="animate-wave-draw"
            />
          </svg>
          <span className="font-mono text-[11px] lowercase text-muted">
            tuning in
          </span>
        </div>
      )}
      {hoverSlot && status !== "idle" && !dragging && (
        <div
          className="pointer-events-none absolute top-3 z-10 border border-muted/30 bg-background p-3 font-mono text-[11px] leading-relaxed"
          style={{ left: hoverLeft, width: TOOLTIP_W }}
        >
          <div className="flex justify-between gap-2">
            <span className="text-ink">slot {formatInt(hoverSlot.record.slot)}</span>
            <span className="text-muted">{formatClock(hoverSlot.record.blockTime)}</span>
          </div>
          {hoverSlot.record.skipped ? (
            <div className="text-event">no block, the leader skipped it</div>
          ) : (
            <>
              <div className="text-muted">
                {formatInt(realTxCount(hoverSlot.record))} txs ·{" "}
                {formatInt(hoverSlot.record.voteTxCount ?? 0)} votes ·{" "}
                {formatFailedShare(hoverSlot.record)}
              </div>
              <div className="text-muted">
                {formatCu(hoverSlot.record.computeUnits)} ·{" "}
                {formatSol(hoverSlot.record.totalFees)}
              </div>
            </>
          )}
          {spiked && <div className="text-event">compute spike · z &gt; 2.5</div>}
          {hoverSlot.record.leader && (
            <div className="text-muted/70">
              leader {hoverSlot.record.leader.slice(0, 4)}…
              {hoverSlot.record.leader.slice(-4)}
            </div>
          )}
          <div className="mt-1 text-[10px] text-muted/70">
            click to jump here · drag to scrub
          </div>
        </div>
      )}
    </div>
  );
}
