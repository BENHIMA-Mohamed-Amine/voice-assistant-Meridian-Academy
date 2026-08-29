import type { Room } from '@livekit/rtc-node';
import { RoomEvent } from '@livekit/rtc-node';

// Listens for the client's confidence-threshold override, sent on the
// 'lk.confidenceThreshold' data channel topic, and returns a getter for its current value.
// Mirrors noiseSignal.ts. The threshold is a 0-1 fraction, matching the STT confidence scale.
export function watchConfidenceThreshold(room: Room, defaultThreshold: number): () => number {
  let threshold = defaultThreshold;

  room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
    if (topic !== 'lk.confidenceThreshold') return;
    try {
      const { threshold: value } = JSON.parse(Buffer.from(payload).toString('utf-8')) as {
        threshold?: unknown;
      };
      if (typeof value === 'number' && value >= 0 && value <= 1) {
        threshold = value;
        console.log('confidence threshold updated:', { threshold });
      }
    } catch (err) {
      console.error('Failed to parse lk.confidenceThreshold payload:', err);
    }
  });

  return () => threshold;
}
