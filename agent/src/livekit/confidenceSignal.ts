import type { Room } from '@livekit/rtc-node';

// Publishes the STT confidence for the most recent user turn on the 'lk.confidence' data
// channel topic, so the client can attach it to the matching transcript bubble.
export function publishConfidence(room: Room, confidence: number): void {
  const encoder = new TextEncoder();
  void room.localParticipant
    ?.publishData(encoder.encode(JSON.stringify({ confidence })), {
      reliable: true,
      topic: 'lk.confidence',
    })
    .catch((err: unknown) => {
      console.error('Failed to publish confidence:', err);
    });
}
