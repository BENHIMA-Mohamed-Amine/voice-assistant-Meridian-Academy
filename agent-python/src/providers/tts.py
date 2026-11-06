"""Concrete TTS strategies (cascade architecture leg) + registry."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from livekit.plugins import soniox

if TYPE_CHECKING:
    from livekit.agents import tts


class SonioxProvider:
    """Soniox TTS -- cheaper than Cartesia, one model covers English and French."""

    def build(self) -> tts.TTS:
        """Create the Soniox TTS instance.

        Raises:
            ValueError: If SONIOX_API_KEY is not set.
        """
        api_key = os.environ.get("SONIOX_API_KEY")
        if not api_key:
            raise ValueError("SONIOX_API_KEY is not set. Add it to .env.local.")
        return soniox.TTS(api_key=api_key)


_TTS_REGISTRY: dict[str, type[SonioxProvider]] = {
    "soniox": SonioxProvider,
}


def create_tts() -> tts.TTS:
    """Create the TTS instance selected by the TTS_PROVIDER env var (default: soniox).

    Raises:
        ValueError: If TTS_PROVIDER names an unregistered provider.
    """
    name = os.environ.get("TTS_PROVIDER", "soniox")
    provider_cls = _TTS_REGISTRY.get(name)
    if provider_cls is None:
        raise ValueError(f"Unknown TTS_PROVIDER: {name!r}. Known: {sorted(_TTS_REGISTRY)}")
    return provider_cls().build()
