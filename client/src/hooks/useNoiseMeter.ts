import { useDataChannel } from '@livekit/components-react';
import { useEffect, useRef, useState } from 'react';

// Same scale used for the mic pulse ring, so the noise meter's percentage tracks what that
// glow visually shows — one source of truth for "how loud".
const NOISE_LEVEL_SCALE = 1.8;
// Sustained for this long before the over-threshold flag is sent, so a brief spike (a door
// slam) doesn't fire it.
const NOISE_DEBOUNCE_MS = 700;
const DEFAULT_NOISE_THRESHOLD_PCT = 60;
// Time constants (ms) for the noise-floor tracker: rise is damped far more than fall, so a
// brief voice burst barely moves it while sustained noise still climbs. Fall is smoothed
// rather than an instant snap — real audio jitters up and down constantly even while loud
// overall, and an instant fall would reset to every downward blip, so the floor could never
// accumulate a rise at all.
const NOISE_FLOOR_RISE_TAU_MS = 2000;
const NOISE_FLOOR_FALL_TAU_MS = 250;

export interface NoiseMeter {
  noiseLevelPct: number;
  noiseThresholdPct: number;
  isOverThreshold: boolean;
  noiseBarRef: React.RefObject<HTMLDivElement | null>;
  isDraggingThreshold: boolean;
  handleThresholdPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}

// Tracks ambient noise level from the mic's raw RMS, and reports sustained over-threshold
// state to the agent over the 'lk.noise' data channel. `isSpeaking` (from LiveKit's active
// speaker detection) freezes the floor while the visitor is talking, so their own voice isn't
// mistaken for ambient noise — only silence updates the estimate.
export function useNoiseMeter(micLevel: number, isSpeaking: boolean): NoiseMeter {
  const rawNoiseLevelPct = Math.round(Math.min(1, micLevel * NOISE_LEVEL_SCALE) * 100);
  const [noiseLevelPct, setNoiseLevelPct] = useState(0);

  // Ref-based dt tracking has to live in an effect, not render — render must stay a pure
  // function of props/state (no refs, no performance.now()).
  const lastFloorUpdateRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const now = performance.now();
    const dtMs = now - (lastFloorUpdateRef.current ?? now);
    lastFloorUpdateRef.current = now;
    // Reset the baseline but skip the update itself, so the gap while the visitor was
    // speaking isn't counted as elapsed time once tracking resumes on silence.
    if (isSpeaking) return;
    setNoiseLevelPct((floor) => {
      const tau = rawNoiseLevelPct < floor ? NOISE_FLOOR_FALL_TAU_MS : NOISE_FLOOR_RISE_TAU_MS;
      const next = floor + (rawNoiseLevelPct - floor) * (1 - Math.exp(-dtMs / tau));
      return Math.round(next);
    });
  }, [rawNoiseLevelPct, isSpeaking]);

  const [noiseThresholdPct, setNoiseThresholdPct] = useState(DEFAULT_NOISE_THRESHOLD_PCT);
  const isOverThreshold = noiseLevelPct > noiseThresholdPct;
  const noiseBarRef = useRef<HTMLDivElement>(null);
  const lastSentOverThresholdRef = useRef(false);
  const { send: sendNoiseFlag } = useDataChannel('lk.noise');

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isOverThreshold === lastSentOverThresholdRef.current) return;
      lastSentOverThresholdRef.current = isOverThreshold;
      void sendNoiseFlag(new TextEncoder().encode(JSON.stringify({ overThreshold: isOverThreshold })), {
        reliable: false,
      });
    }, NOISE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isOverThreshold, sendNoiseFlag]);

  const [isDraggingThreshold, setIsDraggingThreshold] = useState(false);

  const handleThresholdPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const bar = noiseBarRef.current;
    if (!bar) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingThreshold(true);

    const updateFromClientX = (clientX: number) => {
      const rect = bar.getBoundingClientRect();
      const pct = Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 100);
      setNoiseThresholdPct(pct);
    };
    updateFromClientX(e.clientX);

    const handleMove = (moveEvent: PointerEvent) => updateFromClientX(moveEvent.clientX);
    const handleUp = () => {
      setIsDraggingThreshold(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return {
    noiseLevelPct,
    noiseThresholdPct,
    isOverThreshold,
    noiseBarRef,
    isDraggingThreshold,
    handleThresholdPointerDown,
  };
}
