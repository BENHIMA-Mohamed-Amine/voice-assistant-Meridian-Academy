import { voice } from '@livekit/agents';
import type { Room } from '@livekit/rtc-node';

// Mirrors the shape the client widget expects on the 'lk.metrics' data channel topic. Fields
// fill in incrementally as each turn's metrics become available, so the client always has the
// latest known value per field.
interface LatencyPayload {
  eouMs?: number;
  llmTtftMs?: number;
  ttsTtfbMs?: number;
  e2eMs?: number;
  e2eAvgMs?: number;
}

// Streams per-turn latency to the client so the widget's latency panel shows real numbers.
export function publishLatencyMetrics(room: Room, session: voice.AgentSession): void {
  const latency: LatencyPayload = {};
  let e2eSumMs = 0;
  let e2eCount = 0;
  const encoder = new TextEncoder();

  const publish = () => {
    void room.localParticipant
      ?.publishData(encoder.encode(JSON.stringify(latency)), {
        reliable: true,
        topic: 'lk.metrics',
      })
      .catch((err: unknown) => {
        console.error('Failed to publish latency metrics:', err);
      });
  };

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    if (ev.item.type !== 'message') return;
    const m = ev.item.metrics;
    if (!m) return;

    if (ev.item.role === 'user') {
      if (m.endOfTurnDelay === undefined) return;
      latency.eouMs = Math.round(m.endOfTurnDelay * 1000);
      publish();
      return;
    }

    if (ev.item.role === 'assistant') {
      if (m.llmNodeTtft !== undefined) latency.llmTtftMs = Math.round(m.llmNodeTtft * 1000);
      if (m.ttsNodeTtfb !== undefined) latency.ttsTtfbMs = Math.round(m.ttsNodeTtfb * 1000);
      if (m.e2eLatency !== undefined) {
        latency.e2eMs = Math.round(m.e2eLatency * 1000);
        e2eSumMs += latency.e2eMs;
        e2eCount += 1;
        latency.e2eAvgMs = Math.round(e2eSumMs / e2eCount);
      }
      publish();
    }
  });
}
