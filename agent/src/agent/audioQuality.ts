// Below this, a transcript is treated as low-confidence. The client can override this per
// session (see livekit/confidenceThresholdSignal.ts) — this is only the starting value.
export const DEFAULT_TRANSCRIPT_CONFIDENCE_THRESHOLD = 0.6;

// Builds a short, factual note added to the chat context for the current turn only. The LLM
// decides how to phrase and use it (see the Clarity section of the agent's instructions) —
// this only states what's true: `noisy` always gets mentioned to the visitor, `lowConfidence`
// always triggers a repeat request. The two are independent and can combine.
export function buildAudioQualityNote(noisy: boolean, lowConfidence: boolean): string | undefined {
  const parts: string[] = [];
  if (noisy) {
    parts.push("There's background noise on the visitor's end right now — mention that to them.");
  }
  if (lowConfidence) {
    parts.push(
      "The last transcript came through with low confidence — ask the visitor to repeat what they said rather than guessing.",
    );
  }
  if (parts.length === 0) return undefined;
  return `Audio quality note: ${parts.join(' ')}`;
}
