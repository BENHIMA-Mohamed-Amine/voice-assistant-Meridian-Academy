"""Streams per-turn latency to the client on the 'lk.metrics' data topic."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from livekit import rtc
    from livekit.agents import voice

logger = logging.getLogger("signals.latency")

_background_tasks: set[asyncio.Task[None]] = set()


def publish_latency_metrics(room: rtc.Room, session: voice.AgentSession) -> None:
    """Publish per-turn latency metrics to the client as they become available.

    Mirrors the shape the client widget expects on the 'lk.metrics' topic. Fields
    fill in incrementally as each turn's metrics become available, so the client
    always has the latest known value per field.
    """
    latency: dict[str, Any] = {}
    e2e_sum_ms = 0
    e2e_count = 0

    def _publish() -> None:
        task = asyncio.create_task(_publish_data(room, json.dumps(latency)))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

    @session.on("conversation_item_added")
    def _on_conversation_item_added(ev: Any) -> None:
        nonlocal e2e_sum_ms, e2e_count

        item = ev.item
        if getattr(item, "type", None) != "message":
            return
        # item.metrics is a MetricsReport TypedDict (a plain dict at runtime), not
        # an object -- use dict access, not attribute access.
        metrics: dict[str, Any] = getattr(item, "metrics", None) or {}

        if item.role == "user":
            end_of_turn_delay = metrics.get("end_of_turn_delay")
            if end_of_turn_delay is None:
                return
            latency["eouMs"] = round(end_of_turn_delay * 1000)
            _publish()
            return

        if item.role == "assistant":
            llm_node_ttft = metrics.get("llm_node_ttft")
            if llm_node_ttft is not None:
                latency["llmTtftMs"] = round(llm_node_ttft * 1000)
            tts_node_ttfb = metrics.get("tts_node_ttfb")
            if tts_node_ttfb is not None:
                latency["ttsTtfbMs"] = round(tts_node_ttfb * 1000)
            e2e_latency = metrics.get("e2e_latency")
            if e2e_latency is not None:
                latency["e2eMs"] = round(e2e_latency * 1000)
                e2e_sum_ms += latency["e2eMs"]
                e2e_count += 1
                latency["e2eAvgMs"] = round(e2e_sum_ms / e2e_count)
            _publish()


async def _publish_data(room: rtc.Room, payload: str) -> None:
    try:
        await room.local_participant.publish_data(payload, reliable=True, topic="lk.metrics")
    except Exception:
        logger.exception("Failed to publish latency metrics")
