# Meridian Academy — Voice Agent (Python)

Python port of the LiveKit voice agent originally built in Node.js/TypeScript (see
`../agent/`). Migrated to Python because that's the language I use the most day to
day. Behavior is intentionally identical; the one deliberate addition is a
provider + pipeline abstraction layer (see [`docs/architecture.md`](docs/architecture.md))
so STT/TTS/LLM providers, and the whole voice architecture (cascaded vs.
speech-to-speech), can be swapped by config instead of by editing code.

## Project structure

```
agent-python/
├── src/
│   ├── main.py                        Entrypoint. Drives the voice pipeline through
│   │                                   the VoicePipeline strategy from providers/.
│   │
│   ├── agent/
│   │   ├── agent.py                   MeridianAssistant: persona/instructions, the
│   │   │                               audio-quality note injected per turn.
│   │   ├── audio_quality.py           Pure logic: builds the "audio quality note"
│   │   │                               text from (is_noisy, is_low_confidence).
│   │   ├── tools.py                   notify_support_team (posts a completed demo
│   │   │                               request to Slack).
│   │   └── email.py                   Work-email vs. personal-email domain check.
│   │
│   ├── providers/                     Strategy + Factory seam for swappable
│   │   │                              providers and architectures. See
│   │   │                              docs/architecture.md.
│   │   ├── base.py
│   │   ├── stt.py / tts.py / llm.py   Cascade-architecture providers.
│   │   ├── realtime.py                Speech-to-speech providers.
│   │   ├── pipeline.py                CascadePipeline / SpeechToSpeechPipeline.
│   │   └── factory.py                 create_pipeline().
│   │
│   └── signals/                       NOT named `livekit/` -- that would shadow the
│       │                              real `livekit` PyPI namespace package.
│       ├── noise_signal.py            Listens for the client's noise flag on
│       │                               'lk.noise'.
│       ├── confidence_threshold_signal.py  Listens for the client's threshold
│       │                               override on 'lk.confidenceThreshold'.
│       ├── latency_metrics.py         Publishes per-turn latency on 'lk.metrics'.
│       ├── turn_pairing.py            Publishes correctly-ordered, paired
│       │                               conversation turns (incl. confidence) on
│       │                               'lk.turns' -- works around full-duplex
│       │                               realtime models (e.g. GPT-Live) posting a
│       │                               reply's transcript before the visitor's own.
│       └── tracing.py                 Optional Langfuse OpenTelemetry trace export.
│
├── tests/
│   ├── test_email.py / test_audio_quality.py   Pure unit tests.
│   ├── test_tools.py                  Deterministic tool tests (no LLM/network).
│   ├── test_providers.py              Strategy/Factory registry tests.
│   ├── test_agent.py                  Behavioral evals (greeting, grounded refusal,
│   │                                   harmful-request refusal).
│   └── test_booking_flow.py           Multi-turn booking eval (see note below).
│
├── Dockerfile                         Production container build for LiveKit Cloud.
├── livekit.toml                       LiveKit Cloud agent deployment config.
├── scenarios.yaml                     lk agent simulate scenarios (unchanged from
│                                       the TS version -- CLI-level, language-agnostic).
├── .env.example                       Required environment variables.
└── pyproject.toml
```

## Tech choices

Same providers as the TS version, now behind the `providers/` seam:

- **STT — Deepgram Flux** (`flux-general-multi`, `providers/stt.py`).
- **LLM — Groq-hosted Qwen3** (`qwen/qwen3.8-27b`, `providers/llm.py`),
  `reasoning_effort="none"` for instruct mode.
- **TTS — Soniox** (`providers/tts.py`). The greeting is pre-rendered once per worker
  process in `prewarm()` and replayed from cached frames at session start, to cut
  Soniox's TTFB off the very first thing the visitor hears.
- **VAD — Silero**, interruption detection only (end-of-turn comes from Deepgram Flux).
- **Interruption handling — adaptive** (`turn_handling.interruption.mode`), same as
  the TS version.
- **Observability — Langfuse (optional)**, same env-var gating as the TS version.

**Speech-to-speech alternative — OpenAI GPT-Live** (`providers/realtime.py`), via
LiveKit Inference: no `OPENAI_API_KEY` needed, billed through LiveKit Cloud's free
inference credits instead of my own OpenAI key. Backend reasoning model
`gpt-5.6-luna` at `reasoning_effort="low"`, voice `marin`. Full-duplex (listens and
speaks at once, decides its own turns) -- live-tested and working.

Picked for this project specifically to:
- **Try the free credits** — runs on LiveKit Cloud's inference billing rather than a
  personal API key.
- **Test a new architecture live** — full-duplex speech-to-speech is a different
  model/architecture than the cascaded STT→LLM→TTS pipeline, worth exercising for
  real rather than just reading about.
- **Latency** — measured end-to-end latency stays under 1.3s in testing, which is
  what made it worth switching to for this use case.

Two things worth knowing before you rely on it:
- **Transcript order**: full-duplex models emit a turn's transcript only *after* that
  turn's audio finishes, so a fast reply's transcript can post before the visitor's
  own. `signals/turn_pairing.py` works around this -- see
  [`docs/architecture.md`](docs/architecture.md#turn-ordering-for-full-duplex-models).
- **Multilingual voice continuity** (e.g. switching between English and French) isn't
  documented by OpenAI for GPT-Live's voices one way or the other -- not confirmed
  either way, worth a manual check if that matters for your use case.

Enable it with `PIPELINE_ARCHITECTURE=realtime` in `.env.local` (default stays
`cascade`, matching the TS version's behavior unchanged).

See [`docs/architecture.md`](docs/architecture.md) for how to add a new provider or a
new architecture (e.g. a different speech-to-speech model) without touching `main.py`.

## Local setup

Requires Python 3.12+ and [`uv`](https://docs.astral.sh/uv/).

```bash
uv sync
cp .env.example .env.local
# fill in .env.local -- same variable names as the TS version, plus
# PIPELINE_ARCHITECTURE / *_PROVIDER (all default to today's cascade setup)
uv run python src/main.py dev
```

`uv run python src/main.py dev` connects to your LiveKit Cloud project and lets you
test against the `client/` dev server (or the LiveKit Agents testing console).

### Environment variables

See `.env.example` for the full list. Everything from the TS version carries over
unchanged (`LIVEKIT_URL`, `GROQ_API_KEY`, `SONIOX_API_KEY`, `DEEPGRAM_API_KEY`,
`SLACK_WEBHOOK_URL`, `LANGFUSE_*`), plus three new ones for the provider seam:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PIPELINE_ARCHITECTURE` | `cascade` | `cascade` (today's behavior) or `realtime` (speech-to-speech). |
| `STT_PROVIDER` / `TTS_PROVIDER` / `LLM_PROVIDER` | `deepgram` / `soniox` / `groq_qwen` | Which provider to use within each role. |
| `REALTIME_PROVIDER` | `gpt_live` | Which realtime model, only used when `PIPELINE_ARCHITECTURE=realtime`. `gpt_live` is OpenAI GPT-Live via LiveKit Inference -- no `OPENAI_API_KEY` needed, billed through `LIVEKIT_API_KEY`/`SECRET`. |

### Other commands

```bash
uv run pytest           # run tests
uv run mypy src         # type checking (strict)
uv run ruff check .     # lint
uv run ruff format .    # format
```

## Testing

Same two layers as the TS version, per [LiveKit's testing guide](https://docs.livekit.io/testing/unit-tests/):

- **Turn-level** (`tests/`, `uv run pytest`) — pytest behavioral evals and unit tests.
  `test_email.py`, `test_audio_quality.py`, `test_tools.py`, and `test_providers.py`
  are deterministic and need no external credentials. `test_agent.py` and
  `test_booking_flow.py` call the real Groq LLM and a LiveKit Inference judge model,
  so they need `GROQ_API_KEY`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` set.

  > **Note:** `test_booking_flow.py` runs several conversation turns per test and can
  > hit Groq's free-tier rate limit (7,000 input tokens/minute for `qwen/qwen3.8-27b`)
  > if run back-to-back with the other LLM-backed tests. Run it on its own
  > (`uv run pytest tests/test_booking_flow.py`) if you see `429` errors. See
  > [`docs/silent-bug-risks.md`](docs/silent-bug-risks.md).

- **Scenario-level** (`scenarios.yaml`) — unchanged from the TS version:

  ```bash
  lk agent simulate --scenarios scenarios.yaml --concurrency 1
  ```

## Deployment

Deployed to LiveKit Cloud (agent id `CA_4LkrcTEAmVNX`).

```bash
lk cloud auth
lk agent deploy
```

Secrets are set via `lk agent secrets`, not committed to the repo.

## Known limitations

Carried over from the TS version (see its README for detail): Krisp noise
cancellation is disabled (crashed on activation in testing); LiveKit Cloud's free
(Build) plan cold-starts the agent after scale-to-zero. See
[`docs/silent-bug-risks.md`](docs/silent-bug-risks.md) for issues specific to this
Python port.
