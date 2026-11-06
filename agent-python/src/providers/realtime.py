"""Concrete speech-to-speech (realtime) model strategies + registry.

Only one provider ships here (OpenAI GPT-Live, via LiveKit Inference) -- enough to
prove the architecture seam works end-to-end. Adding another realtime provider later
is a new class + one registry entry; see docs/architecture.md.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from livekit.agents import inference

if TYPE_CHECKING:
    from livekit.agents.llm import DuplexModel

# gpt-5.6-luna is OpenAI's smallest/fastest model in its tier -- matches the direct
# Groq path's choice of reasoning_effort="none" on Qwen: keep the backend fast for
# simple slot-filling dialogue, not deep reasoning.
_GPT_LIVE_BACKEND_MODEL = "gpt-5.6-luna"
_GPT_LIVE_REASONING_EFFORT = "low"
# marin is OpenAI's recommended default voice (alongside cedar) and female-presenting.
_GPT_LIVE_VOICE = "marin"


class GPTLiveProvider:
    """OpenAI GPT-Live, via LiveKit Inference -- full-duplex, no OpenAI key needed.

    Billed through LiveKit Cloud using LIVEKIT_API_KEY/SECRET. Unlike the turn-based
    OpenAI Realtime API, GPT-Live listens and speaks at the same time and controls its
    own turn-taking; the AgentSession needs an explicit VAD for barge-in (see
    SpeechToSpeechPipeline in pipeline.py).
    """

    def build(self) -> DuplexModel:
        """Create the GPT-Live duplex model, routed through LiveKit Inference."""
        return inference.DuplexModel(
            model="openai/gpt-live-1",
            voice=_GPT_LIVE_VOICE,
            extra_kwargs={
                "responses_options": {
                    "model": _GPT_LIVE_BACKEND_MODEL,
                    "reasoning": {"effort": _GPT_LIVE_REASONING_EFFORT},
                },
            },
        )


_REALTIME_REGISTRY: dict[str, type[GPTLiveProvider]] = {
    "gpt_live": GPTLiveProvider,
}


def create_realtime_model() -> DuplexModel:
    """Create the realtime model selected by REALTIME_PROVIDER (default: gpt_live).

    Raises:
        ValueError: If REALTIME_PROVIDER names an unregistered provider.
    """
    name = os.environ.get("REALTIME_PROVIDER", "gpt_live")
    provider_cls = _REALTIME_REGISTRY.get(name)
    if provider_cls is None:
        raise ValueError(
            f"Unknown REALTIME_PROVIDER: {name!r}. Known: {sorted(_REALTIME_REGISTRY)}"
        )
    return provider_cls().build()
