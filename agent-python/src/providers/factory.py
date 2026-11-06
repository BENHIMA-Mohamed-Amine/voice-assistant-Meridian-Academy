"""Reads PIPELINE_ARCHITECTURE and returns the matching VoicePipeline."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from providers.pipeline import _PIPELINE_REGISTRY

if TYPE_CHECKING:
    from providers.base import VoicePipeline


def create_pipeline() -> VoicePipeline:
    """Create the voice pipeline selected by PIPELINE_ARCHITECTURE (default: cascade).

    Raises:
        ValueError: If PIPELINE_ARCHITECTURE names an unregistered architecture.
    """
    name = os.environ.get("PIPELINE_ARCHITECTURE", "cascade")
    pipeline_cls = _PIPELINE_REGISTRY.get(name)
    if pipeline_cls is None:
        raise ValueError(
            f"Unknown PIPELINE_ARCHITECTURE: {name!r}. Known: {sorted(_PIPELINE_REGISTRY)}"
        )
    return pipeline_cls()
