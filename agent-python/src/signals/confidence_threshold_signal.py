"""Listens for the client's confidence-threshold override on 'lk.confidenceThreshold'."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from livekit import rtc

logger = logging.getLogger("signals.confidence_threshold")


def watch_confidence_threshold(room: rtc.Room, default_threshold: float) -> Callable[[], float]:
    """Watch 'lk.confidenceThreshold' and return a getter for the current value.

    Mirrors noise_signal.py. The threshold is a 0-1 fraction, matching the STT
    confidence scale.
    """
    threshold = default_threshold

    @room.on("data_received")
    def _on_data_received(data: rtc.DataPacket) -> None:
        nonlocal threshold
        if data.topic != "lk.confidenceThreshold":
            return
        try:
            payload = json.loads(data.data.decode("utf-8"))
            value = payload.get("threshold")
            if isinstance(value, (int, float)) and 0 <= value <= 1:
                threshold = float(value)
                logger.info("confidence threshold updated: %s", threshold)
        except Exception:
            logger.exception("Failed to parse lk.confidenceThreshold payload")

    return lambda: threshold
