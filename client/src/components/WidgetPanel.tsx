'use client';

import { useEffect, useRef, useState } from 'react';
import { useAgent, useLocalParticipant, useMultibandTrackVolume, useSessionMessages } from '@livekit/components-react';
import { type LocalAudioTrack } from 'livekit-client';
import { useConfidenceThreshold } from '../hooks/useConfidenceThreshold';
import { useLatencyMetrics } from '../hooks/useLatencyMetrics';
import { useNoiseMeter } from '../hooks/useNoiseMeter';
import { messageKey, useTranscriptConfidence } from '../hooks/useTranscriptConfidence';

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
  // Same row design as the active states above — no pulsing ring (that's reserved for an
  // in-progress turn), just a color that reflects what's actually happening.
  connecting: 'var(--accent)',
  'pre-connect-buffering': 'var(--accent)',
  failed: 'var(--warn)',
};

export function WidgetPanel({ onClose }: { onClose: () => void }) {
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
  const latency = useLatencyMetrics();
  const {
    noiseLevelPct,
    noiseThresholdPct,
    isOverThreshold,
    noiseBarRef,
    isDraggingThreshold,
    handleThresholdPointerDown,
  } = useNoiseMeter(micLevel);
  const confidenceByKey = useTranscriptConfidence(messages);
  const { confidenceThresholdPct, setConfidenceThresholdPct } = useConfidenceThreshold();

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages]);

  const stateLabel = STATE_LABELS[agent.state] ?? STATE_LABELS.idle;
  const isActive = ACTIVE_STATES.has(agent.state);
  const dotColor = STATE_DOT_COLORS[agent.state] ?? 'var(--text-muted)';

  return (
    <div
      style={
        {
          '--panel-padding': 'clamp(0px, 4vw, 40px)',
          width: '100%',
          minHeight: '100dvh',
          boxSizing: 'border-box',
          padding: 'var(--panel-padding)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-page)',
        } as React.CSSProperties
      }
    >
      <div
        style={{
          width: 'min(380px, 100%)',
          height: 'min(640px, calc(100dvh - var(--panel-padding) * 2))',
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
              const confidence = isUser ? confidenceByKey[messageKey(m)] : undefined;
              const isLowConfidence = confidence !== undefined && confidence < confidenceThresholdPct / 100;
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
                    {confidence !== undefined && (
                      <div
                        style={{
                          marginTop: 7,
                          paddingTop: 6,
                          borderTop: '1px solid color-mix(in oklch, var(--accent-ink) 22%, transparent)',
                          display: 'flex',
                          justifyContent: 'flex-end',
                        }}
                      >
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '2.5px 8px',
                            borderRadius: 999,
                            background: 'color-mix(in oklch, var(--accent-ink) 14%, transparent)',
                          }}
                        >
                          <div
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: '50%',
                              flexShrink: 0,
                              background: isLowConfidence ? 'var(--warn)' : 'var(--success)',
                              opacity: 1,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: '0.03em',
                              color: 'var(--accent-ink)',
                              opacity: 0.75,
                            }}
                          >
                            Transcript confidence{' '}
                            <span
                              style={{
                                fontWeight: 800,
                                color: isLowConfidence ? 'var(--warn)' : 'var(--success)',
                                opacity: 1,
                              }}
                            >
                              {Math.round(confidence * 100)}%
                            </span>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Noise meter + mic control */}
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

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <label
                htmlFor="confidence-threshold"
                style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
              >
                Confidence threshold
              </label>
              <input
                id="confidence-threshold"
                type="range"
                min={0}
                max={100}
                step={5}
                value={confidenceThresholdPct}
                onChange={(e) => setConfidenceThresholdPct(Number(e.target.value))}
                aria-valuetext={`${confidenceThresholdPct}%`}
                style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer', minWidth: 0 }}
              />
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)', width: 30, textAlign: 'right' }}>
                {confidenceThresholdPct}%
              </span>
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
