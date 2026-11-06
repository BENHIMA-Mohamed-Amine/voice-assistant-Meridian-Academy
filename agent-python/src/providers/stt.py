"""Concrete STT strategies (cascade architecture leg) + registry."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from livekit.plugins import deepgram

if TYPE_CHECKING:
    from livekit.agents import stt


class DeepgramFluxProvider:
    """Deepgram Flux STT (STTv2), multilingual, via the plugin directly."""

    def build(self) -> stt.STT:
        """Create the Deepgram Flux STT instance.

        Raises:
            ValueError: If DEEPGRAM_API_KEY is not set.
        """
        api_key = os.environ.get("DEEPGRAM_API_KEY")
        if not api_key:
            raise ValueError("DEEPGRAM_API_KEY is not set. Add it to .env.local.")
        return deepgram.STTv2(model="flux-general-multi", api_key=api_key)


_STT_REGISTRY: dict[str, type[DeepgramFluxProvider]] = {
    "deepgram": DeepgramFluxProvider,
}


def create_stt() -> stt.STT:
    """Create the STT instance selected by the STT_PROVIDER env var (default: deepgram).

    Raises:
        ValueError: If STT_PROVIDER names an unregistered provider.
    """
    name = os.environ.get("STT_PROVIDER", "deepgram")
    provider_cls = _STT_REGISTRY.get(name)
    if provider_cls is None:
        raise ValueError(f"Unknown STT_PROVIDER: {name!r}. Known: {sorted(_STT_REGISTRY)}")
    return provider_cls().build()
