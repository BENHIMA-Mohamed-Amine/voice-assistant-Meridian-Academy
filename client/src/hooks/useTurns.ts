import { useDataChannel, type ReceivedMessage } from '@livekit/components-react';
import { useMemo, useState } from 'react';

// Mirrors the payloads published by agent-python/src/signals/turn_pairing.py on the
// 'lk.turns' data channel topic.
type TurnPayload =
  | { type: 'slot'; role: 'user' | 'assistant' }
  | { type: 'confidence'; confidence: number };

interface Slot {
  role: 'user' | 'assistant';
  confidence?: number;
}

export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending: boolean;
  confidence?: number;
}

const decoder = new TextDecoder();

// Orders bubbles by when each side actually *started* talking (published here, in
// real time, by turn_pairing.py), while still sourcing each bubble's live-streaming
// text from the framework's own transcription feed (`messages`, from
// useSessionMessages) -- so a full-duplex model's late, out-of-order
// conversation_item_added events don't affect display order, and normal streaming
// text is untouched. A slot with no bound message yet renders as a pending bubble.
export function useTurns(messages: ReceivedMessage[]): Turn[] {
  const [slots, setSlots] = useState<Slot[]>([]);

  useDataChannel('lk.turns', (msg) => {
    let payload: TurnPayload;
    try {
      payload = JSON.parse(decoder.decode(msg.payload)) as TurnPayload;
    } catch (err) {
      console.error('Failed to parse turn pairing payload:', err);
      return;
    }

    setSlots((prev) => {
      if (payload.type === 'slot') {
        return [...prev, { role: payload.role }];
      }
      // Attach to the most recent user slot that doesn't have a confidence yet.
      const index = [...prev].reverse().findIndex((s) => s.role === 'user' && s.confidence === undefined);
      if (index === -1) return prev;
      const targetIndex = prev.length - 1 - index;
      const next = [...prev];
      next[targetIndex] = { ...next[targetIndex], confidence: payload.confidence };
      return next;
    });
  });

  // Memoized so the returned array keeps its identity across renders that don't
  // actually change slots/messages (e.g. the mic-level meter re-rendering the panel
  // many times a second) -- without this, an effect that scrolls to bottom on every
  // new `turns` reference fires constantly and the visitor can't scroll up at all.
  return useMemo(() => {
    const userMessages = messages.filter((m) => m.type === 'userTranscript');
    const agentMessages = messages.filter((m) => m.type === 'agentTranscript');
    let userIdx = 0;
    let agentIdx = 0;

    return slots.map((slot, i) => {
      const bound = slot.role === 'user' ? userMessages[userIdx++] : agentMessages[agentIdx++];
      return {
        id: `${slot.role}-${i}`,
        role: slot.role,
        text: bound && 'message' in bound ? bound.message : '',
        pending: !bound,
        confidence: slot.confidence,
      };
    });
  }, [slots, messages]);
}
