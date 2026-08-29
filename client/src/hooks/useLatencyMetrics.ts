import { useDataChannel } from '@livekit/components-react';
import { useState } from 'react';

// Mirrors LatencyPayload in agent/src/livekit/latencyMetrics.ts, published on the
// 'lk.metrics' data channel topic.
export interface LatencyMetrics {
  eouMs?: number;
  llmTtftMs?: number;
  ttsTtfbMs?: number;
  e2eMs?: number;
  e2eAvgMs?: number;
}

const decoder = new TextDecoder();

// Subscribes to per-turn latency numbers published by the agent.
export function useLatencyMetrics(): LatencyMetrics {
  const [latency, setLatency] = useState<LatencyMetrics>({});
  useDataChannel('lk.metrics', (msg) => {
    try {
      setLatency(JSON.parse(decoder.decode(msg.payload)) as LatencyMetrics);
    } catch (err) {
      console.error('Failed to parse latency metrics payload:', err);
    }
  });
  return latency;
}
