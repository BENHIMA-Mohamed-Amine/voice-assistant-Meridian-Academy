# Silent bug risks

## Plugin HTTP calls inside `prewarm()` need an explicit HTTP context

**What happens:** any plugin call that makes an HTTP/WebSocket request (e.g. a TTS's
`.synthesize()`) silently fails inside `prewarm()`/`setup_fnc` unless wrapped in
`async with livekit.agents.utils.http_context.open():`.

**Why it's silent:** the framework retries the call 3 times with backoff and logs a
`WARNING`, not an `ERROR` -- easy to miss in a noisy dev-mode log. The worker still
starts and registers with LiveKit Cloud, so it *looks* healthy. The actual failure mode
is that the pre-rendered greeting audio is empty, which only shows up at runtime when
the first visitor hears nothing (or a fallback) instead of the greeting.

**How to spot it:** grep worker logs for `Attempted to use an http session outside of a
job context`. In dev mode, also watch for `failed to synthesize speech: Connection
error` warnings during the `initializing process` phase (before `registered worker`).

**How to avoid it:** `CascadePipeline.prewarm()` in `src/providers/pipeline.py` wraps
its TTS call in `http_context.open()` for exactly this reason -- any new prewarm logic
that talks to a provider over HTTP must do the same. `build_session()` (called inside
the real job context) does not need this wrapper.

## Groq free-tier rate limits during multi-turn tests

**What happens:** `qwen/qwen3.8-27b` on Groq's free tier caps at 7,000 input tokens per
minute. A multi-turn eval test (`tests/test_booking_flow.py`) alone can approach that
limit, and running it back-to-back with other LLM-backed tests exhausts it, surfacing
as `APIStatusError: 429` / `APIConnectionError` rather than an actual agent defect.

**How to spot it:** the error message names `qwen/qwen3.8-27b` and `rate_limit_exceeded`
explicitly -- it is not a stack trace pointing at this project's code.

**How to avoid it:** run LLM-backed tests one file at a time rather than the whole
suite back-to-back, same guidance the original TypeScript agent's README gives for
`lk agent simulate --concurrency 1`.

## `ChatMessage.metrics` is a dict (TypedDict), not an object

**What happens:** `item.metrics.llm_node_ttft` raises `AttributeError: 'dict' object
has no attribute 'llm_node_ttft'`. `MetricsReport` is a `TypedDict` -- a plain `dict`
at runtime -- so every field needs `item.metrics.get("llm_node_ttft")`, not attribute
access. (`item.transcript_confidence`, by contrast, *is* a real attribute directly on
`ChatMessage` -- the two don't follow the same access pattern, easy to assume
otherwise when porting from the TS version's object-shaped equivalent.)

**Why it's silent:** this broke inside a `conversation_item_added` handler
(`signals/latency_metrics.py`), which the framework logs as "failed to emit event"
and otherwise swallows -- the agent session kept running, with no latency numbers
reaching the client and no crash visible to a visitor.

**How to spot it:** grep worker logs for `failed to emit event conversation_item_added`
or `AttributeError`.

**How to avoid it:** already fixed in `signals/latency_metrics.py` (uses `.get()`).
Any new code reading `item.metrics` must do the same.

## Full-duplex realtime models (GPT-Live) can drop a turn without a catch-up slot

**What happens:** if `signals/turn_pairing.py`'s ordering slots are only opened from
VAD's `user_state_changed`, a second user turn that GPT-Live finalizes within the same
continuous "speaking" stretch has no slot to bind to on the client and is silently
never rendered -- even though the agent clearly understood it (its reply references
information only in that dropped turn).

**How to spot it:** the agent's reply makes sense but references something the
transcript never shows the visitor saying.

**How to avoid it:** already fixed -- `turn_pairing.py` also opens a slot from
`conversation_item_added` itself whenever none is already open. Any change to that
module's slot-opening logic needs to preserve this invariant: every finalized user
turn must get exactly one slot, whether opened proactively (VAD) or reactively
(catch-up). See `docs/architecture.md#turn-ordering-for-full-duplex-models`.
