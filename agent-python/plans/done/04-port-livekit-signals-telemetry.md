# Plan — Phase 4: Port LiveKit signal + telemetry helpers

**Status:** done

## Goal

Port the data-channel signal helpers and optional Langfuse tracing. Wire protocol (topic
names, JSON field names) must stay byte-identical — the client (`client/src/hooks/...`)
is not changing and expects exactly these shapes.

## Steps

- [x] 1. `signals/noise_signal.py` — `watch_noise_signal(room) -> Callable[[], bool]`,
      subscribes `lk.noise` topic, same `overThreshold` JSON key (keep camelCase on the
      wire — only the Python identifier is snake_case).
      → verify: unit test publishes a fake data packet, asserts the getter flips.
- [x] 2. `signals/confidence_signal.py` — `publish_confidence(room, confidence: float)`,
      publishes `lk.confidence` with `{"confidence": ...}`.
      → verify: unit test asserts `publish_data` called with the right topic/payload.
- [x] 3. `signals/confidence_threshold_signal.py` — mirrors noise_signal, topic
      `lk.confidenceThreshold`, key `threshold`, range-checked `0 <= v <= 1`.
      → verify: same pattern as step 1.
- [x] 4. `signals/latency_metrics.py` — `publish_latency_metrics(room, session)`,
      subscribes to the session's conversation-item-added event, same field names on the
      wire: `eouMs`, `llmTtftMs`, `ttsTtfbMs`, `e2eMs`, `e2eAvgMs` (running average).
      → sub-step: confirm the Python event name/metric attribute names via
      `docs_search`/`code_search` before writing — don't assume 1:1 naming with the
      Node.js `AgentSessionEventTypes.ConversationItemAdded` / `ev.item.metrics`.
      → verify: unit test with a fake metrics event asserts the published payload.
- [x] 5. `signals/tracing.py` — `setup_langfuse_tracing(metadata) -> TracerProvider | None`,
      same env-var gating (`LANGFUSE_PUBLIC_KEY`/`SECRET_KEY`/`BASE_URL` all-or-nothing),
      same Basic-auth header, same `x-langfuse-ingestion-version: 4` header.
      → sub-step: confirm `FanoutSpanProcessor` (or equivalent) exists under
      `livekit.agents.telemetry` in Python — check via `code_search` before writing.
      → verify: unit test with no env vars set returns `None`; with fake vars set,
      constructs a provider without raising.

## Done / Challenges / Solution

_(filled in during execution)_
