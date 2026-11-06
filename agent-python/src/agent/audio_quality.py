"""Pure logic for the per-turn audio-quality note injected into the chat context."""

# Below this, a transcript is treated as low-confidence. The client can override this
# per session (see livekit/confidence_threshold_signal.py) -- this is only the starting
# value.
DEFAULT_TRANSCRIPT_CONFIDENCE_THRESHOLD = 0.6


def build_audio_quality_note(noisy: bool, low_confidence: bool) -> str | None:
    """Build a short, factual note for the current turn only.

    The LLM decides how to phrase and use it (see the Clarity section of the agent's
    instructions) -- this only states what's true: `noisy` always gets mentioned to the
    visitor, `low_confidence` always triggers a repeat request. The two are independent
    and can combine.
    """
    parts: list[str] = []
    if noisy:
        parts.append(
            "There's background noise on the visitor's end right now -- mention that to them."
        )
    if low_confidence:
        parts.append(
            "The last transcript came through with low confidence -- ask the visitor "
            "to repeat what they said rather than guessing."
        )
    if not parts:
        return None
    return f"Audio quality note: {' '.join(parts)}"
