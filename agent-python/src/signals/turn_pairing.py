"""Publishes real-time turn-order slots on 'lk.turns', fixing ordering for full-duplex
realtime models without touching the framework's own (live-streaming) transcription.

Why this exists: a full-duplex realtime model (e.g. GPT-Live) streams audio
continuously and only emits a turn's `conversation_item_added` event *after* that
turn's audio finishes -- so the agent's reply to "hi" can post before the visitor's
own "hi" transcript does. There's no fix at the framework level (turn detection for
these models isn't configurable).

The fix: publish a "slot" the instant each side actually *starts* talking --
`user_state_changed` -> "speaking" and `agent_state_changed` -> "speaking" both fire
in real time, before any transcript exists, and (unlike `conversation_item_added`) in
true chronological order. The client reserves a bubble position for each slot as it
arrives, then binds the slot to the Nth same-role message from the framework's own
live transcription feed (which still streams text in normally) -- so ordering comes
from this channel, and text content and its live streaming still comes from the
framework's own 'lk.transcription' feed, unchanged. Confidence is carried separately,
since it isn't known until the turn finalizes.

A full-duplex model can finalize more than one user `conversation_item_added` within
a single continuous VAD "speaking" stretch -- it chunks turns by its own pause
detection, not 1:1 with raw VAD state. If a slot were only opened on VAD, a second or
third item in the same stretch would have nowhere to bind on the client and would be
silently dropped. So a "catch-up" slot is also published on `conversation_item_added`
itself whenever none is currently open -- it arrives at the same moment as the text,
so the client binds it immediately with no visible pending gap.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from livekit import rtc
    from livekit.agents import voice

logger = logging.getLogger("signals.turn_pairing")

_background_tasks: set[asyncio.Task[None]] = set()


def publish_turn_pairing(room: rtc.Room, session: voice.AgentSession) -> None:
    """Watch session state + conversation events and publish ordered turn slots."""
    has_open_user_slot = False

    def _publish(payload: dict[str, Any]) -> None:
        task = asyncio.create_task(_publish_data(room, json.dumps(payload)))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

    def _open_user_slot() -> None:
        nonlocal has_open_user_slot
        has_open_user_slot = True
        _publish({"type": "slot", "role": "user", "ts": time.time()})

    @session.on("user_state_changed")
    def _on_user_state_changed(ev: Any) -> None:
        if ev.new_state == "speaking" and not has_open_user_slot:
            _open_user_slot()

    @session.on("agent_state_changed")
    def _on_agent_state_changed(ev: Any) -> None:
        if ev.new_state == "speaking":
            _publish({"type": "slot", "role": "assistant", "ts": time.time()})

    @session.on("conversation_item_added")
    def _on_conversation_item_added(ev: Any) -> None:
        nonlocal has_open_user_slot

        item = ev.item
        if getattr(item, "type", None) != "message" or item.role != "user":
            return

        # Catch-up: this item finalized without a slot already open for it (a
        # full-duplex model closing a second turn within one VAD "speaking" stretch).
        if not has_open_user_slot:
            _open_user_slot()
        has_open_user_slot = False

        confidence = getattr(item, "transcript_confidence", None)
        if confidence is not None:
            _publish({"type": "confidence", "confidence": confidence, "ts": time.time()})


async def _publish_data(room: rtc.Room, payload: str) -> None:
    try:
        await room.local_participant.publish_data(payload, reliable=True, topic="lk.turns")
    except Exception:
        logger.exception("Failed to publish turn pairing event")
