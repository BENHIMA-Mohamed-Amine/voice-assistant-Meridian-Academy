"""Listens for the client's noise-threshold flag on the 'lk.noise' data topic."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from livekit import rtc

logger = logging.getLogger("signals.noise")


def watch_noise_signal(room: rtc.Room) -> Callable[[], bool]:
    """Watch the 'lk.noise' topic and return a getter for the latest noisy state.

    Mirrors the client's noise meter (see client/src/hooks/useNoiseMeter.ts), sent on
    the 'lk.noise' data channel topic. Returns a getter (not a snapshot) so callers
    always read the latest state instead of a stale one.
    """
    is_noisy = False

    @room.on("data_received")
    def _on_data_received(data: rtc.DataPacket) -> None:
        nonlocal is_noisy
        if data.topic != "lk.noise":
            return
        try:
            payload = json.loads(data.data.decode("utf-8"))
            is_noisy = payload.get("overThreshold") is True
        except Exception:
            logger.exception("Failed to parse lk.noise payload")

    return lambda: is_noisy
