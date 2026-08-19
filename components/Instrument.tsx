"use client";

import { useEffect, useRef, useState } from "react";
import { formatCu, formatInt, formatSol, formatTps } from "@/lib/format";
import { SLOT_WINDOW_S, type AnomalyKind, type SoundParams } from "@/lib/mapping";
import { pitchNorm } from "@/lib/visual";
import { createSession, type PlayedSlot } from "@/lib/session";
import { createLiveSource } from "@/lib/sources/live";
import { parseJsonl } from "@/lib/sources/replay";
import type { SlotRecord, SlotSource } from "@/lib/types";
import { encodeWav } from "@/lib/wav";
import type { Mode } from "./ModeToggle";
import { pushPulse } from "./pulse";
import Stage, { type FrameState, type Status } from "./Stage";
import TransportBar from "./TransportBar";

// Scheduling on the audio clock slightly ahead keeps events glitch-free
// regardless of when a source delivers them (buffer pacing or live polling).
const LOOKAHEAD_S = 0.15;
// Real mainnet tape first; the synthetic fixture covers fresh clones.
const FIXTURE_URLS = ["/data/mainnet.jsonl", "/data/sample.jsonl"];
const DEFAULT_VOLUME_DB = -6;
const SEEK_SLOTS = 75; // 30 seconds of chain time
// While paused, live keeps recording up to ~2 minutes of tape, then the
// fetcher idles so an abandoned tab stops burning RPC quota.
const MAX_BUFFER_AHEAD = 300;
// Live playback with nobody at the controls auto-pauses: every played slot
// is a paid RPC call, and an unattended tab would stream them forever.
const IDLE_LIMIT_MS = 10 * 60_000;
// WAV export renders this much of the tape ending at the playhead (~60s).
const EXPORT_SLOTS = 150;
// Live playback starts once this much tape is buffered (~6.4s): the pipeline
// then always has finalized windows ahead and the wave never stalls.
const MIN_START_BUFFER = 16;
// Live is the product and the default everywhere; without an RPC key it
// falls back to the recorded tape on its own.
const DEFAULT_MODE: Mode = "live";

type ToneModule = typeof import("tone");

// Ear-tunable mix, adjustable live via the ?debug=1 panel and persisted.
export const DEFAULT_MIX = {
  signal: -10,
  bass: -6,
  texture: -18,
  thud: -4,
  burst: -14,
  pad: -14,
  reverbWet: 0.12,
};
export type Mix = typeof DEFAULT_MIX;
export type MixKey = keyof Mix;

function createAudio(tone: ToneModule) {
  // A small shared room at the end of every chain: cohesion, not decoration.
  const room = new tone.Reverb({
    decay: 1.8,
    preDelay: 0.02,
    wet: DEFAULT_MIX.reverbWet,
  }).toDestination();

  // Stereo: notes spread by pitch, grains scatter, bursts alternate sides;
  // bass and the skip thud stay center, they are the gravity.
  // signal voice (green): clean triangle synth through a lowpass the
  // pressure mapping opens and closes.
  const signalPanner = new tone.Panner(0).connect(room);
  const signalFilter = new tone.Filter(2000, "lowpass").connect(signalPanner);
  const signalSynth = new tone.PolySynth(tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.005, decay: 0.09, sustain: 0, release: 0.06 },
  }).connect(signalFilter);
  signalSynth.volume.value = DEFAULT_MIX.signal;

  // bass voice: sine ground note per slot, weight from fees.
  const bassSynth = new tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.02, decay: 0.25, sustain: 0, release: 0.2 },
  }).connect(room);
  bassSynth.volume.value = DEFAULT_MIX.bass;

  // texture voice: filtered noise grains for failed transactions.
  const grainPanner = new tone.Panner(0).connect(room);
  const grainFilter = new tone.Filter(3000, "highpass").connect(grainPanner);
  const grainSynth = new tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.03, sustain: 0 },
  }).connect(grainFilter);
  grainSynth.volume.value = DEFAULT_MIX.texture;

  // event voice (violet): FM thud for skips, metallic burst for CU spikes,
  // a different timbre class, never decoration.
  const thudSynth = new tone.FMSynth({
    harmonicity: 0.5,
    modulationIndex: 8,
    envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.2 },
  }).connect(room);
  thudSynth.volume.value = DEFAULT_MIX.thud;
  const burstPanner = new tone.Panner(0).connect(room);
  const burstSynth = new tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.12, release: 0.05 },
  }).connect(burstPanner);
  burstSynth.volume.value = DEFAULT_MIX.burst;
  let burstSide = 1;

  // air voice: a slow pad breathing underneath, driven by overall activity.
  // It makes long listening comfortable and leaves a hole when a slot skips.
  const padFilter = new tone.Filter(600, "lowpass").connect(room);
  const padGain = new tone.Gain(0).connect(padFilter);
  const padLow = new tone.Oscillator("E3", "triangle").connect(padGain).start();
  const padHigh = new tone.Oscillator("B3", "sine").connect(padGain).start();
  padHigh.detune.value = 6;
  padLow.volume.value = DEFAULT_MIX.pad;
  padHigh.volume.value = DEFAULT_MIX.pad - 3;

  const updatePad = (events: SoundParams[]) => {
    const notes = events.filter((e) => e.voice === "signal");
    const activity = Math.min(1, notes.length / 4);
    const filterHz = notes[0]?.filterHz ?? 400;
    const utilization = Math.min(
      1,
      Math.max(0, Math.log(filterHz / 400) / Math.log(20)),
    );
    padGain.gain.rampTo(0.02 + 0.1 * activity, 2);
    padFilter.frequency.rampTo(250 + 1400 * utilization, 2.5);
  };

  const setPadActive = (active: boolean) => {
    if (!active) padGain.gain.rampTo(0, 0.4);
  };

  const setLevel = (voice: Exclude<MixKey, "reverbWet">, db: number) => {
    switch (voice) {
      case "signal": signalSynth.volume.value = db; break;
      case "bass": bassSynth.volume.value = db; break;
      case "texture": grainSynth.volume.value = db; break;
      case "thud": thudSynth.volume.value = db; break;
      case "burst": burstSynth.volume.value = db; break;
      case "pad":
        padLow.volume.value = db;
        padHigh.volume.value = db - 3;
        break;
    }
  };

  const setReverbWet = (wet: number) => {
    room.wet.value = Math.min(0.5, Math.max(0, wet));
  };

  const applyMix = (mix: Mix) => {
    for (const key of Object.keys(mix) as MixKey[]) {
      if (key === "reverbWet") setReverbWet(mix.reverbWet);
      else setLevel(key, mix[key]);
    }
  };

  // Mono synths reject a trigger scheduled before one they already hold
  // (seeks emit immediately, so times can land inside the previous slot's
  // tail). Each voice gets a monotonic clock that nudges stragglers forward.
  const monotonic = () => {
    let last = 0;
    return (time: number) => {
      last = Math.max(time, last + 0.001);
      return last;
    };
  };
  const bassTime = monotonic();
  const grainTime = monotonic();
  const thudTime = monotonic();
  const burstTime = monotonic();

  const playEvent = (event: SoundParams, time: number) => {
    switch (event.voice) {
      case "signal":
        signalFilter.frequency.setValueAtTime(event.filterHz, time);
        signalPanner.pan.setValueAtTime(
          (pitchNorm(event.notes[0] ?? "") - 0.5) * 0.9,
          time,
        );
        signalSynth.triggerAttackRelease(
          event.notes,
          event.duration,
          time,
          event.velocity,
        );
        break;
      case "bass":
        bassSynth.triggerAttackRelease(
          event.notes[0],
          event.duration,
          bassTime(time),
          event.velocity,
        );
        break;
      case "texture": {
        const at = grainTime(time);
        grainPanner.pan.setValueAtTime(
          (event.offset / SLOT_WINDOW_S - 0.5) * 0.8,
          at,
        );
        grainSynth.triggerAttackRelease(event.duration, at, event.velocity);
        break;
      }
      case "event":
        if (event.kind === "skip") {
          const at = thudTime(time);
          thudSynth.detune.cancelScheduledValues(at);
          thudSynth.detune.setValueAtTime(0, at);
          thudSynth.detune.linearRampToValueAtTime(-400, at + event.duration);
          thudSynth.triggerAttackRelease(
            event.notes[0],
            event.duration,
            at,
            event.velocity,
          );
        } else {
          const at = burstTime(time);
          burstSide = -burstSide;
          burstPanner.pan.setValueAtTime(0.35 * burstSide, at);
          burstSynth.triggerAttackRelease(
            event.notes[0],
            event.duration,
            at,
            event.velocity,
          );
        }
        break;
    }
  };

  const dispose = () => {
    signalSynth.dispose();
    signalFilter.dispose();
    signalPanner.dispose();
    bassSynth.dispose();
    grainSynth.dispose();
    grainFilter.dispose();
    grainPanner.dispose();
    thudSynth.dispose();
    burstSynth.dispose();
    burstPanner.dispose();
    padLow.dispose();
    padHigh.dispose();
    padGain.dispose();
    padFilter.dispose();
    room.dispose();
  };

  return {
    playEvent,
    updatePad,
    setPadActive,
    applyMix,
    // the reverb renders its impulse response asynchronously; offline
    // exports must wait for it or they come out dry
    ready: room.ready,
    dispose,
  };
}

type Audio = ReturnType<typeof createAudio>;

const MIX_LABELS: Record<MixKey, string> = {
  signal: "notes",
  bass: "bass",
  texture: "crackle",
  thud: "thud",
  burst: "burst",
  pad: "air",
  reverbWet: "reverb",
};

function loadStoredMix(): Mix {
  const mix = { ...DEFAULT_MIX };
  try {
    const stored = JSON.parse(localStorage.getItem("slotwave:mix") ?? "{}");
    for (const key of Object.keys(DEFAULT_MIX) as MixKey[]) {
      const value = stored?.[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      mix[key] =
        key === "reverbWet"
          ? Math.min(0.5, Math.max(0, value))
          : Math.min(0, Math.max(-40, value));
    }
  } catch {
    // corrupt storage reads as defaults
  }
  return mix;
}

export default function Instrument() {
  const frameRef = useRef<FrameState>({
    session: null,
    lastEmit: null,
    playing: false,
  });
  const scrubbingRef = useRef(false);
  const lastInteractionRef = useRef(0);
  // Every seek/scrub/teardown starts a new generation; Tone.Draw callbacks
  // from the old one must not move the playhead or readout back afterwards.
  const emitGenRef = useRef(0);
  const playheadRef = useRef(0);
  const toneRef = useRef<ToneModule | null>(null);
  const audioRef = useRef<Audio | null>(null);
  const sourceRef = useRef<SlotSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRef = useRef(false);
  const fixtureRef = useRef<SlotRecord[] | null>(null);
  const volumeRef = useRef(DEFAULT_VOLUME_DB);
  const statusRef = useRef<Status>("idle");
  const modeRef = useRef<Mode>(DEFAULT_MODE);

  const startAtRef = useRef<number | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [volume, setVolume] = useState(DEFAULT_VOLUME_DB);
  const [notice, setNotice] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<
    {
      index: number;
      slot: number;
      kind: AnomalyKind;
      count: number;
      lastSlot: number;
    }[]
  >([]);
  const [exporting, setExporting] = useState(false);
  // Screen readers hear anomalies announced; the product is audio-first anyway.
  const [announcement, setAnnouncement] = useState("");
  const mixRef = useRef<Mix>({ ...DEFAULT_MIX });
  const [mix, setMixState] = useState<Mix>({ ...DEFAULT_MIX });
  const [debugPanel, setDebugPanel] = useState(false);
  // Inside a Farcaster client this holds the mini app SDK; null on the web.
  const miniAppRef = useRef<
    typeof import("@farcaster/miniapp-sdk").sdk | null
  >(null);

  // Farcaster mini app handshake: ready() dismisses the host's splash
  // screen. Outside a Farcaster client this resolves to a no-op.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        if (!(await sdk.isInMiniApp()) || cancelled) return;
        miniAppRef.current = sdk;
        await sdk.actions.ready();
      } catch {
        // not a mini app context
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One-time post-mount sync with the outside world: stored preferences
  // first, then the ?slot deep link (which wins and forces live mode).
  // SSR renders the defaults, so this must wait for the client.
  useEffect(() => {
    const storedVolume = localStorage.getItem("slotwave:volume");
    const parsedVolume = Number(storedVolume);
    if (
      storedVolume !== null &&
      Number.isFinite(parsedVolume) &&
      parsedVolume >= -40 &&
      parsedVolume <= 0
    ) {
      volumeRef.current = parsedVolume;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time preference restore
      setVolume(parsedVolume);
    }
    // the page always opens in live; the source is a choice per visit
    localStorage.removeItem("slotwave:mode");
    const param = new URLSearchParams(window.location.search).get("slot");
    if (param && /^\d{1,12}$/.test(param)) {
      startAtRef.current = Number(param);
      modeRef.current = "live";
       
      setMode("live");
    }
    mixRef.current = loadStoredMix();
     
    setMixState(mixRef.current);
    if (new URLSearchParams(window.location.search).has("debug")) {
       
      setDebugPanel(true);
    }
  }, []);

  // Readouts update imperatively, 2.5 slots/sec must not re-render the tree.
  const slotRef = useRef<HTMLSpanElement>(null);
  const tpsRef = useRef<HTMLSpanElement>(null);
  const cuRef = useRef<HTMLSpanElement>(null);
  const feeRef = useRef<HTMLSpanElement>(null);
  const lagRef = useRef<HTMLSpanElement>(null);

  // Notices come in two kinds: confirmations fade on their own, while
  // errors and fallbacks stay until the user acts on them.
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = (text: string, options?: { sticky?: boolean }) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
    setNotice(text);
    if (!options?.sticky) {
      noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
    }
  };

  const clearNotice = () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
    setNotice(null);
  };

  const setStatusBoth = (next: Status) => {
    statusRef.current = next;
    frameRef.current.playing = next === "playing";
    setStatus(next);
  };

  const updateReadout = (played: PlayedSlot) => {
    const { record } = played;
    if (slotRef.current)
      slotRef.current.textContent = formatInt(record.slot);
    if (tpsRef.current) tpsRef.current.textContent = formatTps(record);
    if (cuRef.current)
      cuRef.current.textContent = record.skipped ? "—" : formatCu(record.computeUnits);
    if (feeRef.current)
      feeRef.current.textContent = record.skipped ? "—" : formatSol(record.totalFees);
    document.title = `▶ ${formatInt(record.slot)} · slotwave`;
  };

  // Same-kind anomalies close together are one congestion episode, not
  // three near-identical log lines: collapse them into a single entry.
  const EPISODE_GAP_SLOTS = 8;

  const recordAnomaly = (played: PlayedSlot) => {
    const anomaly = played.events.find((e) => e.voice === "event");
    if (!anomaly?.kind) return;
    const kind = anomaly.kind;
    const slot = played.record.slot;
    setAnomalies((previous) => {
      if (previous.some((a) => a.index === played.index)) return previous;
      const [head, ...rest] = previous;
      if (head && head.kind === kind && slot - head.lastSlot <= EPISODE_GAP_SLOTS) {
        return [{ ...head, count: head.count + 1, lastSlot: slot }, ...rest];
      }
      setAnnouncement(
        kind === "skip"
          ? `slot ${formatInt(slot)} skipped`
          : `compute spike at slot ${formatInt(slot)}`,
      );
      return [
        { index: played.index, slot, kind, count: 1, lastSlot: slot },
        ...previous,
      ].slice(0, 3);
    });
  };

  const updateLag = () => {
    const session = frameRef.current.session;
    if (!lagRef.current || !session) return;
    const behind = session.slots.length - playheadRef.current;
    lagRef.current.textContent =
      statusRef.current === "loading"
        ? "buffering…"
        : modeRef.current === "live"
          ? behind <= 0
            ? "buffering…"
            : behind <= 1
              ? "at the tip"
              : `${behind} slots behind`
          : `tape ${Math.min(playheadRef.current, session.slots.length)} / ${session.slots.length}`;
  };

  const emit = (played: PlayedSlot) => {
    const tone = toneRef.current;
    const audio = audioRef.current;
    if (!tone || !audio) return;
    const generation = emitGenRef.current;
    const t0 = tone.now() + LOOKAHEAD_S;
    for (const event of played.events) {
      try {
        audio.playEvent(event, t0 + event.offset);
      } catch (err) {
        // one bad audio event must never take the whole player down
        console.error("audio event failed", event.voice, err);
      }
    }
    audio.updatePad(played.events);
    // Visual playhead + readout advance at the same audio-clock instant the
    // slot sounds, one clock, no drift.
    tone.getDraw().schedule(() => {
      // a seek happened in the 150ms between scheduling and sounding:
      // this callback describes a position that no longer exists
      if (generation !== emitGenRef.current) return;
      played.playedAt = performance.now();
      frameRef.current.lastEmit = { index: played.index, at: performance.now() };
      pushPulse(Math.max(0, ...played.events.map((e) => e.velocity)));
      updateReadout(played);
      recordAnomaly(played);
    }, t0);
  };

  const tick = () => {
    const phase = statusRef.current;
    if (phase !== "playing" && phase !== "loading") return;
    // eslint-disable-next-line react-hooks/purity -- tick only runs from timers, never during render
    const idleMs = performance.now() - lastInteractionRef.current;
    if (
      phase === "playing" &&
      modeRef.current === "live" &&
      idleMs > IDLE_LIMIT_MS
    ) {
      pause();
      showNotice("paused after 10 idle minutes to save rpc quota", { sticky: true });
      return;
    }
    timerRef.current = setTimeout(tick, SLOT_WINDOW_S * 1000);
    const session = frameRef.current.session;
    if (!session) return;
    if (phase === "loading") {
      // hold the music until a comfortable cushion exists
      if (
        modeRef.current === "live" &&
        session.slots.length < MIN_START_BUFFER
      ) {
        updateLag();
        return;
      }
      setStatusBoth("playing");
    }
    // the user is holding the tape, stay silent until they let go
    if (scrubbingRef.current) return;
    if (playheadRef.current >= session.slots.length) {
      // replay loops its tape; live waits for the chain to catch us up
      if (modeRef.current === "replay" && session.slots.length > 0) {
        playheadRef.current = 0;
      } else {
        updateLag();
        return;
      }
    }
    const played = session.slots[playheadRef.current];
    playheadRef.current += 1;
    emit(played);
    updateLag();
  };

  const teardown = () => {
    emitGenRef.current += 1;
    document.title = "Slotwave";
    setAnomalies([]);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    sourceRef.current?.stop();
    sourceRef.current = null;
    audioRef.current?.dispose();
    audioRef.current = null;
    frameRef.current.session = null;
    frameRef.current.lastEmit = null;
    scrubbingRef.current = false;
    playheadRef.current = 0;
    startingRef.current = false;
    setStatusBoth("idle");
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup
  useEffect(() => teardown, []);

  const loadFixture = async (): Promise<SlotRecord[]> => {
    if (fixtureRef.current) return fixtureRef.current;
    for (const url of FIXTURE_URLS) {
      const response = await fetch(url);
      if (!response.ok) continue;
      try {
        fixtureRef.current = parseJsonl(await response.text());
        return fixtureRef.current;
      } catch {
        // corrupt tape: fall through to the next one
      }
    }
    throw new Error("no replay tape available");
  };

  const start = async (startMode: Mode) => {
    if (statusRef.current !== "idle" || startingRef.current) return;
    if (!("AudioContext" in window) && !("webkitAudioContext" in window)) {
      showNotice("audio is not supported in this browser", { sticky: true });
      return;
    }
    startingRef.current = true;
    try {
      // Tone.js touches AudioContext at import time, client, post-gesture only.
      const tone = await import("tone");
      await tone.start();
      toneRef.current = tone;
      tone.getDestination().volume.value = volumeRef.current;

      const audio = createAudio(tone);
      audio.applyMix(mixRef.current);
      await audio.ready;
      audioRef.current = audio;
      const session = createSession();
      frameRef.current.session = session;
      frameRef.current.lastEmit = null;
      playheadRef.current = 0;

      if (startMode === "live") {
        const source = createLiveSource({
          startAt: startAtRef.current,
          hold: () => {
            const current = frameRef.current.session;
            if (!current) return false;
            const backlog = current.slots.length - playheadRef.current;
            if (backlog > MAX_BUFFER_AHEAD) return true;
            return document.hidden && statusRef.current !== "playing";
          },
          onError: () => {
            setNotice(
              "live unavailable, playing the captured tape instead (tap live to retry)",
            );
            setMode("replay");
            modeRef.current = "replay";
            teardown();
            void start("replay");
          },
        });
        source.start((record) => session.ingest(record));
        sourceRef.current = source;
      } else {
        for (const record of await loadFixture()) session.ingest(record);
      }

      setStatusBoth("loading"); // the tick loop flips to playing once buffered
      tick();
    } catch (err) {
      console.error(err);
      showNotice("could not start audio", { sticky: true });
      teardown();
    } finally {
      startingRef.current = false;
    }
  };

  const pause = () => {
    if (statusRef.current !== "playing") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    audioRef.current?.setPadActive(false);
    document.title = document.title.replace("▶", "❚❚");
    setStatusBoth("paused");
  };

  const resume = () => {
    if (statusRef.current !== "paused") return;
    audioRef.current?.setPadActive(true);
    setStatusBoth("playing");
    tick();
  };

  const playPause = () => {
    if (statusRef.current === "idle") void start(modeRef.current);
    else if (statusRef.current === "playing") pause();
    else resume();
  };

  /**
   * Land the playhead: `position` becomes the slot sitting under the line
   * (readout shows it), playback continues from the next one, immediately
   * when playing, so every jump answers with sound instead of dead air.
   */
  const seekTo = (position: number) => {
    const session = frameRef.current.session;
    if (!session || session.slots.length === 0) return;
    emitGenRef.current += 1;
    const pos = Math.max(-1, Math.min(position, session.slots.length - 1));
    playheadRef.current = pos + 1;
    const current = pos >= 0 ? session.slots[pos] : null;
    frameRef.current.lastEmit = current
      ? { index: pos, at: performance.now() }
      : null;
    updateReadout(current ?? session.slots[0]);
    updateLag();
    if (statusRef.current === "playing") {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      tick();
    }
  };

  const seekBy = (slots: number) => seekTo(playheadRef.current - 1 + slots);
  const toEdge = () => {
    const session = frameRef.current.session;
    if (session) seekTo(session.slots.length - 1);
  };

  /** Readout preview while the tape is being dragged. */
  const scrubPreview = (position: number) => {
    const session = frameRef.current.session;
    const slot = session?.slots[position];
    if (slot) {
      updateReadout(slot);
      updateLag();
    }
  };

  const scrubStart = () => {
    scrubbingRef.current = true;
    // pending draws must not overwrite the readout while the user drags
    emitGenRef.current += 1;
  };

  const scrubEnd = (position: number | null) => {
    scrubbingRef.current = false;
    if (position !== null) seekTo(position);
  };

  const changeMode = (next: Mode) => {
    if (next === mode) return;
    clearNotice();
    const wasActive = statusRef.current !== "idle";
    teardown();
    setMode(next);
    modeRef.current = next;
    if (wasActive) void start(next);
  };

  const copySlotLink = () => {
    const session = frameRef.current.session;
    const emitted = frameRef.current.lastEmit;
    if (!session || !emitted) return;
    const slot = session.slots[emitted.index]?.record.slot;
    if (!slot) return;
    const url = `${window.location.origin}/?slot=${slot}`;
    // inside Farcaster, sharing means casting; on the web, the clipboard
    if (miniAppRef.current) {
      void miniAppRef.current.actions
        .composeCast({
          text: `listening to solana at slot ${formatInt(slot)}`,
          embeds: [url],
        })
        .then(() => showNotice("cast composer opened"))
        .catch(() => showNotice("could not open the cast composer", { sticky: true }));
      return;
    }
    void navigator.clipboard
      ?.writeText(url)
      .then(() => showNotice("link copied, it lands the tape on this slot"));
  };

  // The tape is deterministic data, so the export is a pure re-render of the
  // stored events into an offline context — no re-recording, no RPC.
  const exportWav = async () => {
    const tone = toneRef.current;
    const session = frameRef.current.session;
    const emitted = frameRef.current.lastEmit;
    if (!tone || !session || !emitted || exporting) return;
    const end = emitted.index + 1;
    const slice = session.slots.slice(Math.max(0, end - EXPORT_SLOTS), end);
    if (slice.length === 0) return;
    setExporting(true);
    showNotice(`rendering ${Math.round(slice.length * SLOT_WINDOW_S)}s of tape`);
    try {
      const buffer = await tone.Offline(async () => {
        const offline = createAudio(tone);
        offline.applyMix(mixRef.current);
        await offline.ready;
        let t = 0.05;
        for (const played of slice) {
          for (const event of played.events) {
            offline.playEvent(event, t + event.offset);
          }
          t += SLOT_WINDOW_S;
        }
      }, slice.length * SLOT_WINDOW_S + 1);
      const raw = buffer.toArray();
      const channels = Array.isArray(raw) ? raw : [raw];
      const wav = encodeWav(channels, buffer.sampleRate);
      const name = `slotwave-${slice[0].record.slot}.wav`;
      const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      showNotice(`saved ${name}`);
    } catch (err) {
      console.error(err);
      showNotice("could not render the export", { sticky: true });
    } finally {
      setExporting(false);
    }
  };

  const changeVolume = (db: number) => {
    volumeRef.current = db;
    setVolume(db);
    localStorage.setItem("slotwave:volume", String(db));
    const tone = toneRef.current;
    if (tone) tone.getDestination().volume.value = db;
  };

  const applyMixEverywhere = (next: Mix) => {
    mixRef.current = next;
    setMixState(next);
    localStorage.setItem("slotwave:mix", JSON.stringify(next));
    audioRef.current?.applyMix(next);
  };

  const changeMix = (key: MixKey, value: number) => {
    applyMixEverywhere({ ...mixRef.current, [key]: value });
  };

  const copyMix = () => {
    void navigator.clipboard
      ?.writeText(JSON.stringify(mixRef.current))
      .then(() => showNotice("mix copied, paste it to me"));
  };

  // Laptops sleep mid-listen: the AudioContext wakes up suspended. Try to
  // resume it; if the browser refuses, pause cleanly instead of playing air.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      const tone = toneRef.current;
      if (!tone || statusRef.current !== "playing") return;
      const context = tone.getContext();
      if (context.state !== "running") {
        void Promise.resolve(context.resume()).catch(() => {
          pause();
          showNotice("audio was suspended by the browser, press play to continue", { sticky: true });
        });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and stable handlers only
  }, []);

  // First impression: paint the recorded tape, dimmed and still, behind the
  // start button. Local file, zero RPC; a real start replaces the session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const records = await loadFixture();
        if (cancelled || statusRef.current !== "idle") return;
        if (frameRef.current.session) return;
        const preview = createSession();
        for (const record of records) preview.ingest(record);
        frameRef.current.session = preview;
        frameRef.current.lastEmit = {
          index: Math.min(120, preview.slots.length - 1),
          at: performance.now(),
        };
      } catch {
        // no tape available: the stage stays empty until start
      }
    })();
    return () => {
      cancelled = true;
    };
     
  }, []);

  // Any pointer or key counts as someone being at the controls.
  useEffect(() => {
    const touch = () => {
      lastInteractionRef.current = performance.now();
    };
    touch();
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, []);

  // Space toggles playback, arrows scrub ±30s, hands-free, from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["BUTTON", "INPUT", "A"].includes(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        playPause();
        return;
      }
      // shift+arrows belong to the tape inspector (Stage listens for them)
      if (event.shiftKey) return;
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        seekBy(-SEEK_SLOTS);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        seekBy(SEEK_SLOTS);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex w-full flex-col">
      <div className="grid w-full grid-cols-1 items-end gap-x-12 gap-y-4 py-6 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] lowercase tracking-[0.25em] text-muted">
            slot
          </span>
          <button
            type="button"
            onClick={copySlotLink}
            title="copy a link that lands the tape on this slot"
            className="cursor-pointer text-left"
          >
            <span
              ref={slotRef}
              data-testid="slot-readout"
              className="font-mono text-4xl tabular-nums text-ink transition-colors hover:text-signal sm:text-5xl"
            >
              —
            </span>
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4 sm:justify-end">
          {(
            [
              ["throughput", tpsRef, "tps", "min-w-[9ch]"],
              ["compute", cuRef, "", "min-w-[15ch]"],
              ["fees", feeRef, "", "min-w-[9ch]"],
            ] as const
          ).map(([label, ref, unit, width]) => (
            <div key={label} className={`flex flex-col gap-1 ${width}`}>
              <span className="font-mono text-[10px] lowercase tracking-[0.25em] text-muted">
                {label}
              </span>
              <span className="font-mono text-sm tabular-nums whitespace-nowrap text-ink">
                <span ref={ref}>—</span>
                {unit && <span className="text-muted"> {unit}</span>}
              </span>
            </div>
          ))}
          <div className="flex min-w-[26ch] flex-col gap-1">
            <span className="font-mono text-[10px] lowercase tracking-[0.25em] text-muted">
              anomalies
            </span>
            {/* height reserved for three entries: the readout never reflows */}
            <div className="flex min-h-[3.75rem] flex-col">
            {anomalies.length === 0 ? (
              <span className="font-mono text-sm text-muted">—</span>
            ) : (
              anomalies.map((anomaly) => (
                <button
                  key={anomaly.index}
                  type="button"
                  onClick={() => seekTo(anomaly.index)}
                  title="jump the tape to this anomaly"
                  className="cursor-pointer text-left font-mono text-sm tabular-nums whitespace-nowrap text-event transition-opacity hover:opacity-70"
                >
                  {formatInt(anomaly.slot)}{" "}
                  {anomaly.kind === "skip" ? "skip" : "spike"}
                  {anomaly.count > 1 ? ` ×${anomaly.count}` : ""}
                </button>
              ))
            )}
            </div>
          </div>
        </div>
      </div>

      <Stage
        frame={frameRef}
        status={status}
        onSeek={seekTo}
        onScrubStart={scrubStart}
        onScrub={scrubPreview}
        onScrubEnd={scrubEnd}
        onActivate={() => void start(modeRef.current)}
      />

      {status !== "idle" && (
        <p className="flex justify-end pt-1 font-mono text-[10px] lowercase text-muted/60">
          drag the tape to scrub · click to jump · hover to inspect a slot
        </p>
      )}

      <TransportBar
        status={status}
        mode={mode}
        volume={volume}
        lagRef={lagRef}
        onMode={changeMode}
        onPlayPause={playPause}
        onBack={() => seekBy(-SEEK_SLOTS)}
        onForward={() => seekBy(SEEK_SLOTS)}
        onToEdge={toEdge}
        onVolume={changeVolume}
        onExport={() => void exportWav()}
        exporting={exporting}
        onShare={copySlotLink}
      />
      {debugPanel && (
        <div className="mt-4 w-full border border-muted/30 p-4">
          <div className="flex items-center justify-between pb-3">
            <span className="font-mono text-[10px] lowercase tracking-[0.25em] text-muted">
              mix (debug)
            </span>
            <div className="flex gap-4 font-mono text-xs lowercase">
              <button
                type="button"
                onClick={copyMix}
                className="text-muted transition-colors hover:text-signal"
              >
                copy mix
              </button>
              <button
                type="button"
                onClick={() => applyMixEverywhere({ ...DEFAULT_MIX })}
                className="text-muted transition-colors hover:text-signal"
              >
                reset
              </button>
            </div>
          </div>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(DEFAULT_MIX) as MixKey[]).map((key) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 font-mono text-xs lowercase text-muted"
              >
                <span className="w-14">{MIX_LABELS[key]}</span>
                <input
                  type="range"
                  min={key === "reverbWet" ? 0 : -40}
                  max={key === "reverbWet" ? 0.5 : 0}
                  step={key === "reverbWet" ? 0.01 : 1}
                  value={mix[key]}
                  onChange={(e) => changeMix(key, Number(e.target.value))}
                  className="w-24 accent-signal"
                />
                <span className="w-10 text-right tabular-nums text-ink">
                  {key === "reverbWet" ? mix.reverbWet.toFixed(2) : mix[key]}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      {notice && (
        <p className="pt-3 font-mono text-xs lowercase text-muted">{notice}</p>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
