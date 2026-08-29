'use client';

import { useEffect, useRef, useState } from 'react';
import {
  RoomAudioRenderer,
  SessionProvider,
  useAgent,
  useDataChannel,
  useLocalParticipant,
  useMultibandTrackVolume,
  useSession,
  useSessionMessages,
} from '@livekit/components-react';
import { TokenSource, type LocalAudioTrack } from 'livekit-client';

const TOKEN_SOURCE = TokenSource.endpoint('/api/token');

// Same sqrt-compression + scale used for the mic pulse ring, so the noise meter's
// percentage tracks what that glow visually shows — one source of truth for "how loud".
const NOISE_LEVEL_SCALE = 1.8;
// "sustained for a debounce window" per architecture-decisions.md, to avoid a brief
// spike (a door slam) firing the over-threshold flag.
const NOISE_DEBOUNCE_MS = 700;
const DEFAULT_NOISE_THRESHOLD_PCT = 60;
// Time constants (ms) for the noise-floor tracker below — rise is damped far more than fall,
// so brief voice bursts barely move it while sustained noise still climbs. Fall can't be a
// true instant snap: real audio jitters up and down constantly even while "loud" overall, so
// an instant fall would reset to every downward blip and the floor would never accumulate a
// rise at all. A short fall time constant absorbs that jitter while still feeling immediate.
const NOISE_FLOOR_RISE_TAU_MS = 2000;
const NOISE_FLOOR_FALL_TAU_MS = 250;

// Mirrors LatencyPayload in agent/src/main.ts, published on the 'lk.metrics' data channel topic.
interface LatencyMetrics {
  eouMs?: number;
  llmTtftMs?: number;
  ttsTtfbMs?: number;
  e2eMs?: number;
  e2eAvgMs?: number;
}

const metricsDecoder = new TextDecoder();
const formatMs = (ms: number | undefined) => (ms === undefined ? '—' : `${ms}ms`);

const STATE_LABELS: Record<string, string> = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  'pre-connect-buffering': 'Connecting…',
  failed: 'Connection failed',
  initializing: 'Getting ready…',
  idle: 'Ready when you are',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

const ACTIVE_STATES = new Set(['listening', 'thinking', 'speaking']);

const STATE_DOT_COLORS: Record<string, string> = {
  listening: 'var(--state-listening)',
  thinking: 'var(--state-thinking)',
  speaking: 'var(--state-speaking)',
};

export default function VoiceWidget() {
  const session = useSession(TOKEN_SOURCE, { agentName: 'agent' });
  const [isOpen, setIsOpen] = useState(false);

  // Only end the session on unmount if it was actually started — connecting is deferred
  // until the visitor opens the widget from the launcher, not on page load.
  useEffect(() => {
    return () => {
      session.end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    session.end();
    setIsOpen(false);
  };

  const handleOpen = () => {
    session.start();
    setIsOpen(true);
  };

  return (
    <SessionProvider session={session}>
      {isOpen ? <WidgetPanel onClose={handleClose} /> : <Launcher onOpen={handleOpen} />}
      <RoomAudioRenderer />
    </SessionProvider>
  );
}

function WidgetPanel({ onClose }: { onClose: () => void }) {
  const agent = useAgent();
  const { messages } = useSessionMessages();
  const { isMicrophoneEnabled, localParticipant, microphoneTrack } = useLocalParticipant();
  const micVolumes = useMultibandTrackVolume(microphoneTrack?.track as LocalAudioTrack | undefined, {
    bands: 5,
  });
  const micLevelRaw = micVolumes.length ? micVolumes.reduce((a, b) => a + b, 0) / micVolumes.length : 0;
  // sqrt compresses the curve so normal speaking volume (a small raw RMS) still reads as a strong pulse
  const micLevel = Math.sqrt(micLevelRaw);
  const [isCloseHovered, setIsCloseHovered] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [latency, setLatency] = useState<LatencyMetrics>({});
  useDataChannel('lk.metrics', (msg) => {
    try {
      setLatency(JSON.parse(metricsDecoder.decode(msg.payload)) as LatencyMetrics);
    } catch (err) {
      console.error('Failed to parse latency metrics payload:', err);
    }
  });

  // Client-side noise meter — a supporting UI signal, not the "please repeat" trigger
  // itself (that stays gated server-side on STT confidence, per architecture-decisions.md).
  // Raw mic RMS can't tell the user's own voice apart from background noise. This used to
  // freeze the reading while LiveKit's `isSpeaking` flag was true, but that flag round-trips
  // through the server's active-speaker system — it lags real audio by enough that voice
  // bursts leaked into the reading before the freeze engaged.
  //
  // Instead: a noise-floor tracker (fast fall, slow rise), computed locally with no server
  // dependency. Both directions are exponentially smoothed rather than the fall being a true
  // instant snap — real audio jitters up and down constantly even while sustained-loud, so an
  // instant fall would reset to every downward blip and the floor could never accumulate a
  // rise at all (this is what made a whole Instagram reel only creep the meter to 50%, since
  // it's constantly re-snapping to its own dips). Standard technique for estimating a noise
  // floor from a live signal.
  const rawNoiseLevelPct = Math.round(Math.min(1, micLevel * NOISE_LEVEL_SCALE) * 100);
  const [noiseLevelPct, setNoiseLevelPct] = useState(0);
  // Ref-based dt tracking has to live in an effect, not render — render must stay a pure
  // function of props/state (no refs, no performance.now()).
  const lastFloorUpdateRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const now = performance.now();
    const dtMs = now - (lastFloorUpdateRef.current ?? now);
    lastFloorUpdateRef.current = now;
    setNoiseLevelPct((floor) => {
      const tau = rawNoiseLevelPct < floor ? NOISE_FLOOR_FALL_TAU_MS : NOISE_FLOOR_RISE_TAU_MS;
      const next = floor + (rawNoiseLevelPct - floor) * (1 - Math.exp(-dtMs / tau));
      return Math.round(next);
    });
  }, [rawNoiseLevelPct]);
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

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages]);

  const stateLabel = STATE_LABELS[agent.state] ?? STATE_LABELS.idle;
  const isActive = ACTIVE_STATES.has(agent.state);
  const dotColor = STATE_DOT_COLORS[agent.state] ?? 'var(--text-muted)';

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-page)',
      }}
    >
      <div
        style={{
          width: 380,
          height: 640,
          borderRadius: 20,
          overflow: 'hidden',
          background: 'var(--panel-bg)',
          boxShadow: '0 24px 60px oklch(0 0 0 / 0.35), 0 2px 10px oklch(0 0 0 / 0.25)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 18px',
            background: 'var(--panel-bg-2)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"
                fill="var(--accent-ink)"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                fontSize: 16,
                color: 'var(--text)',
                letterSpacing: '-0.01em',
              }}
            >
              Meridian Academy
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Book a training demo</div>
          </div>
          <div style={{ flexGrow: 1 }} />
          <button
            onClick={onClose}
            onMouseEnter={() => setIsCloseHovered(true)}
            onMouseLeave={() => setIsCloseHovered(false)}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              border: 'none',
              background: isCloseHovered ? 'oklch(0.62 0.19 25 / 0.22)' : 'transparent',
              transition: 'background-color 200ms',
            }}
            aria-label="End conversation"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke={isCloseHovered ? 'var(--warn)' : 'var(--text-muted)'}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Status row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            background: 'var(--panel-bg)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
            {isActive && (
              <>
                <div
                  className="ring-pulse"
                  style={{
                    position: 'absolute',
                    inset: -5,
                    borderRadius: '50%',
                    background: `color-mix(in oklch, ${dotColor} 35%, transparent)`,
                  }}
                />
                <div
                  className="ring-pulse-delayed"
                  style={{
                    position: 'absolute',
                    inset: -2,
                    borderRadius: '50%',
                    background: `color-mix(in oklch, ${dotColor} 50%, transparent)`,
                  }}
                />
              </>
            )}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: dotColor,
              }}
            />
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{stateLabel}</div>
          <div style={{ flexGrow: 1 }} />
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)' }}>
            {formatMs(latency.e2eAvgMs)} AVG E2E
          </div>
        </div>

        {/* Latency breakdown */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            padding: '9px 18px',
            background: 'var(--panel-bg-2)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {[
            // All four are per-turn, replaced each turn. The running average lives in the
            // header stat above instead (formatMs(latency.e2eAvgMs), labeled "AVG E2E").
            ['EOU', formatMs(latency.eouMs), 'var(--text-muted)', 'var(--text)'],
            ['LLM TTFT', formatMs(latency.llmTtftMs), 'var(--text-muted)', 'var(--text)'],
            ['TTS TTFB', formatMs(latency.ttsTtfbMs), 'var(--text-muted)', 'var(--text)'],
            ['E2E', formatMs(latency.e2eMs), 'var(--accent)', 'var(--accent)'],
          ].map(([label, value, labelColor, valueColor]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: labelColor,
                }}
              >
                {label}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: valueColor }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Transcript */}
        <div
          ref={transcriptRef}
          className="no-scrollbar"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: 'var(--panel-bg)',
          }}
        >
          {messages
            .filter((m) => m.type === 'userTranscript' || m.type === 'agentTranscript')
            .map((m) => {
              const isUser = m.type === 'userTranscript';
              const text = 'message' in m ? m.message : '';
              return (
                <div
                  key={m.id}
                  style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}
                >
                  <div
                    style={{
                      maxWidth: '78%',
                      padding: '10px 13px',
                      fontSize: 13.5,
                      lineHeight: 1.45,
                      background: isUser ? 'var(--accent)' : 'var(--surface)',
                      color: isUser ? 'var(--accent-ink)' : 'var(--text)',
                      borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    }}
                  >
                    {text}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Noise meter (real) + mic control (real) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            padding: '14px 18px',
            background: 'var(--panel-bg-2)',
            borderTop: '1px solid var(--border)',
          }}
        >
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                Noise level
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: isOverThreshold ? 'var(--warn)' : 'var(--accent)',
                }}
              >
                {noiseLevelPct}% · {isOverThreshold ? 'Too noisy' : 'Quiet'}
              </div>
            </div>
            <div
              ref={noiseBarRef}
              style={{
                position: 'relative',
                height: 8,
                margin: '6px 0 2px',
                borderRadius: 999,
                background: 'var(--surface-2)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  borderRadius: 999,
                  width: `${noiseLevelPct}%`,
                  background: isOverThreshold ? 'var(--warn)' : 'var(--accent)',
                  transition: 'width 90ms linear',
                }}
              />
              {isDraggingThreshold && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${noiseThresholdPct}%`,
                    bottom: '100%',
                    marginBottom: 8,
                    transform: 'translateX(-50%)',
                    padding: '2px 7px',
                    borderRadius: 6,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: 'var(--text)',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  }}
                >
                  {noiseThresholdPct}%
                </div>
              )}
              <div
                onPointerDown={handleThresholdPointerDown}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: `${noiseThresholdPct}%`,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: 'var(--text)',
                  border: '2px solid var(--panel-bg-2)',
                  transform: 'translate(-50%, -50%)',
                  cursor: 'grab',
                  touchAction: 'none',
                }}
              />
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Alert threshold <strong style={{ color: 'var(--text)', fontWeight: 700 }}>{noiseThresholdPct}%</strong> — drag the knob to adjust
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 5,
              width: 76,
              flexShrink: 0,
            }}
          >
            <div style={{ position: 'relative', width: 48, height: 48 }}>
              {isMicrophoneEnabled && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      inset: -4,
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      filter: 'blur(3px)',
                      opacity: 0.1 + 0.22 * Math.min(1, micLevel * 1.8),
                      transform: `scale(${1 + Math.min(1, micLevel * 1.8) * 0.3})`,
                      transition: 'transform 90ms ease-out, opacity 90ms ease-out',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      filter: 'blur(1.5px)',
                      opacity: 0.15 + 0.3 * Math.min(1, micLevel * 1.8),
                      transform: `scale(${1 + Math.min(1, micLevel * 1.8) * 0.45})`,
                      transition: 'transform 90ms ease-out, opacity 90ms ease-out',
                      pointerEvents: 'none',
                    }}
                  />
                </>
              )}
            <button
              onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
              style={{
                position: 'relative',
                width: 48,
                height: 48,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                border: 'none',
                background: isMicrophoneEnabled ? 'var(--accent)' : 'var(--surface-2)',
                boxShadow: isMicrophoneEnabled
                  ? '0 0 0 6px oklch(0.74 0.15 55 / 0.16)'
                  : 'none',
                outline: isMicrophoneEnabled ? 'none' : '1.5px solid var(--warn)',
              }}
              aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect
                  x="9"
                  y="2"
                  width="6"
                  height="12"
                  rx="3"
                  stroke={isMicrophoneEnabled ? 'var(--accent-ink)' : 'var(--warn)'}
                  strokeWidth="1.8"
                />
                <path
                  d="M5 11a7 7 0 0 0 14 0"
                  stroke={isMicrophoneEnabled ? 'var(--accent-ink)' : 'var(--warn)'}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M12 18v3"
                  stroke={isMicrophoneEnabled ? 'var(--accent-ink)' : 'var(--warn)'}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M9 21h6"
                  stroke={isMicrophoneEnabled ? 'var(--accent-ink)' : 'var(--warn)'}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                {!isMicrophoneEnabled && (
                  <path d="M4 4l16 16" stroke="var(--warn)" strokeWidth="2.2" strokeLinecap="round" />
                )}
              </svg>
            </button>
            </div>
            <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap' }}>
              {isMicrophoneEnabled ? 'Tap to mute' : 'Tap to unmute'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Launcher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label="Open Meridian Academy voice assistant"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 64,
        height: 64,
        border: 'none',
        cursor: 'pointer',
        background: 'transparent',
      }}
    >
      <div
        style={{ position: 'relative', width: 64, height: 64, borderRadius: '50%', color: 'var(--accent)' }}
      >
        <div
          className="ring-pulse"
          style={{
            position: 'absolute',
            inset: -14,
            borderRadius: '50%',
            background: 'oklch(0.74 0.15 55 / 0.14)',
          }}
        />
        <div
          className="ring-pulse-delayed"
          style={{
            position: 'absolute',
            inset: -6,
            borderRadius: '50%',
            background: 'oklch(0.74 0.15 55 / 0.20)',
          }}
        />
        <div
          style={{
            position: 'relative',
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'var(--panel-bg)',
            boxShadow: '0 12px 28px oklch(0 0 0 / 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"
              fill="var(--accent)"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </button>
  );
}
