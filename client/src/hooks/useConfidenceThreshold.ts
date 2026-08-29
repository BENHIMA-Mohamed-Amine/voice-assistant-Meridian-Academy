import { useDataChannel } from '@livekit/components-react';
import { useEffect, useRef, useState } from 'react';

const DEFAULT_CONFIDENCE_THRESHOLD_PCT = 60;
// Debounced rather than sent on every drag tick, same reasoning as the noise threshold.
const SEND_DEBOUNCE_MS = 400;

export interface ConfidenceThreshold {
  confidenceThresholdPct: number;
  setConfidenceThresholdPct: (pct: number) => void;
}

// Lets the visitor tune how confident the STT transcript needs to be before the agent asks
// them to repeat themselves — mirrors the noise threshold control. Sent to the agent on the
// 'lk.confidenceThreshold' data channel as a 0-1 fraction, matching the STT confidence scale.
export function useConfidenceThreshold(): ConfidenceThreshold {
  const [confidenceThresholdPct, setConfidenceThresholdPct] = useState(DEFAULT_CONFIDENCE_THRESHOLD_PCT);
  const { send } = useDataChannel('lk.confidenceThreshold');

  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(() => {
      void send(
        new TextEncoder().encode(JSON.stringify({ threshold: confidenceThresholdPct / 100 })),
        { reliable: true },
      );
    }, SEND_DEBOUNCE_MS);
    return () => clearTimeout(sendTimerRef.current);
  }, [confidenceThresholdPct, send]);

  return { confidenceThresholdPct, setConfidenceThresholdPct };
}
