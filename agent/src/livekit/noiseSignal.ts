import type { Room } from '@livekit/rtc-node';
import { RoomEvent } from '@livekit/rtc-node';

// Listens for the client's noise-threshold flag, sent on the 'lk.noise' data channel topic
// (see the noise meter in VoiceWidget.tsx), and returns a getter for its current value so
// callers always read the latest state instead of a stale snapshot.
export function watchNoiseSignal(room: Room): () => boolean {
  let isNoisy = false;

  room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
    if (topic !== 'lk.noise') return;
    try {
      const { overThreshold } = JSON.parse(Buffer.from(payload).toString('utf-8')) as {
        overThreshold?: unknown;
      };
      isNoisy = overThreshold === true;
    } catch (err) {
      console.error('Failed to parse lk.noise payload:', err);
    }
  });

  return () => isNoisy;
}
