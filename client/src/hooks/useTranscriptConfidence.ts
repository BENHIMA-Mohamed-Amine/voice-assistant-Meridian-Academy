import { useDataChannel, type ReceivedMessage } from '@livekit/components-react';
import { useEffect, useRef, useState } from 'react';

const decoder = new TextDecoder();

// A transcription bubble's `id` is the raw text-stream chunk id, which can change as later
// chunks (interim -> final) replace it — LiveKit correlates chunks into the same bubble
// internally via this attribute, so it's the stable key across that update, unlike `id`.
const SEGMENT_ID_ATTRIBUTE = 'lk.segment_id';

export function messageKey(m: ReceivedMessage): string {
  return m.attributes?.[SEGMENT_ID_ATTRIBUTE] ?? m.id;
}

// Attaches each turn's STT confidence (published by the agent on 'lk.confidence') to the most
// recent user transcript bubble at the time it arrives. The agent publishes it right after the
// turn ends, by which point the matching bubble is already rendered client-side.
export function useTranscriptConfidence(messages: ReceivedMessage[]): Record<string, number> {
  const [confidenceByKey, setConfidenceByKey] = useState<Record<string, number>>({});

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useDataChannel('lk.confidence', (msg) => {
    try {
      const { confidence } = JSON.parse(decoder.decode(msg.payload)) as { confidence?: number };
      if (typeof confidence !== 'number') return;

      const lastUserMessage = [...messagesRef.current].reverse().find((m) => m.type === 'userTranscript');
      if (!lastUserMessage) return;

      setConfidenceByKey((prev) => ({ ...prev, [messageKey(lastUserMessage)]: confidence }));
    } catch (err) {
      console.error('Failed to parse confidence payload:', err);
    }
  });

  return confidenceByKey;
}
