"""Concrete LLM strategies (cascade architecture leg) + registry."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from livekit.plugins import openai

if TYPE_CHECKING:
    from livekit.agents import llm


class GroqQwenProvider:
    """Groq-hosted Qwen3, via the OpenAI-compatible plugin (own key/billing).

    `reasoning_effort="none"` keeps Qwen3 in instruct mode rather than its slower
    thinking mode, which this simple slot-filling dialogue doesn't need.
    """

    def build(self) -> llm.LLM:
        """Create the Groq/Qwen3 LLM instance.

        Raises:
            ValueError: If GROQ_API_KEY is not set.
        """
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY is not set. Add it to .env.local.")
        return openai.LLM(
            model="qwen/qwen3.8-27b",
            base_url="https://api.groq.com/openai/v1",
            api_key=api_key,
            reasoning_effort="none",
        )


_LLM_REGISTRY: dict[str, type[GroqQwenProvider]] = {
    "groq_qwen": GroqQwenProvider,
}


def create_llm() -> llm.LLM:
    """Create the LLM instance selected by the LLM_PROVIDER env var (default: groq_qwen).

    Raises:
        ValueError: If LLM_PROVIDER names an unregistered provider.
    """
    name = os.environ.get("LLM_PROVIDER", "groq_qwen")
    provider_cls = _LLM_REGISTRY.get(name)
    if provider_cls is None:
        raise ValueError(f"Unknown LLM_PROVIDER: {name!r}. Known: {sorted(_LLM_REGISTRY)}")
    return provider_cls().build()
