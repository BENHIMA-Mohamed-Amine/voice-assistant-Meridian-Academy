# Meridian Academy — Voice Agent

## Project structure

```
agent/
├── src/
│   ├── main.ts                        Entrypoint. Wires the STT/TTS/VAD pipeline together,
│   │                                   starts the session, and streams latency metrics.
│   │
│   ├── agent/
│   │   ├── agent.ts                   The assistant itself: persona/instructions, LLM
│   │   │                               config, the audio-quality note injected per turn,
│   │   │                               and tool wiring.
│   │   ├── audioQuality.ts            Pure logic: builds the "audio quality note" text from
│   │   │                               (isNoisy, isLowConfidence). Unit-tested in isolation.
│   │   ├── tools.ts                   The notifySupportTeam tool (posts a completed demo
│   │   │                               request to Slack).
│   │   └── email.ts                   Work-email vs. personal-email domain check used by
│   │                                   the tool.
│   │
│   └── livekit/
│       ├── noiseSignal.ts             Listens for the client's noise-threshold flag on the
│       │                               'lk.noise' data channel topic.
│       ├── confidenceSignal.ts        Publishes each turn's STT confidence to the client on
│       │                               the 'lk.confidence' data channel topic.
│       ├── confidenceThresholdSignal.ts Listens for the client's confidence-threshold
│       │                               override on 'lk.confidenceThreshold', overriding the
│       │                               default in audioQuality.ts for that session.
│       ├── latencyMetrics.ts          Publishes per-turn latency (EOU, LLM TTFT, TTS TTFB,
│       │                               E2E) to the client on the 'lk.metrics' topic.
│       └── tracing.ts                 Optional Langfuse OpenTelemetry trace export. See
│                                       Observability below.
│
├── tests/
│   ├── agent.test.ts                  Behavioral evals for the agent (greeting, refusing
│   │                                   out-of-scope/harmful requests).
│   └── audioQuality.test.ts           Tests for audioQuality.ts.
│
├── Dockerfile                         Production container build for LiveKit Cloud deploy.
├── livekit.toml                       LiveKit Cloud agent deployment config.
├── .env.example                       Required environment variables (see below).
└── package.json
```

## Tech choices

- **STT — Deepgram Flux** (`deepgram/flux-general-multi`, via the `@livekit/agents-plugin-deepgram`
  plugin directly, not LiveKit Inference). Flux's own phrase-endpointing model provides the
  end-of-turn signal directly (`turnHandling.turnDetection: 'stt'`), which is faster than
  waiting on a generic turn detector, and its multilingual model streams interim transcripts,
  which LiveKit Inference's hosted Flux route did not.
- **LLM — Groq-hosted Qwen3** (`qwen/qwen3.8-27b`), via the OpenAI-compatible plugin.
  `reasoningEffort: 'none'` keeps it in instruct mode — this is simple slot-filling dialogue,
  not a task that benefits from a reasoning pass.
- **TTS — Soniox**. Cartesia synthesizes faster, but Soniox was chosen here: cheaper, and one
  model natively covers both English and French without swapping voices per language.
  - The opening greeting is fixed text spoken before the visitor has said anything, so it's
    pre-rendered once per worker process in `prewarm` (`src/main.ts`) and replayed from cached
    audio frames at session start instead of calling Soniox live — cuts Soniox's TTS TTFB
    (~400-600ms) off the very first thing the visitor hears.
- **VAD — Silero**, used only for interruption detection (end-of-turn comes from Deepgram Flux
  above).
- **Observability — Langfuse (optional)**. See [Observability](#observability) below.

## Noise & confidence handling

- The client measures ambient noise from the raw mic signal and reports a threshold-crossing
  flag over the `lk.noise` data channel (see `client/src/hooks/useNoiseMeter.ts`).
- Deepgram Flux returns a per-turn transcription confidence score.
- Neither one is a hard fallback that bypasses the LLM. Instead, `onUserTurnCompleted`
  (`src/agent/agent.ts`) injects a factual note into that turn's context — "there's background
  noise" and/or "ask the visitor to repeat" — and lets the LLM react to it naturally, in its
  own words, as part of the normal reply.
- The confidence score itself is also published to the client per turn and shown under each
  user message bubble in the widget.
- The confidence threshold is configurable from the widget (alongside the noise threshold),
  and sent to the agent on the `lk.confidenceThreshold` topic, overriding
  `DEFAULT_TRANSCRIPT_CONFIDENCE_THRESHOLD` for that session.

## Local setup

Requires Node.js 24+ and pnpm.

```bash
pnpm install
cp .env.example .env.local
# fill in .env.local — see below for what each variable is for
pnpm dev
```

`pnpm dev` runs `lk agent dev`, which connects to your LiveKit Cloud project and lets you test
against the client running locally (or the LiveKit Agents testing console).

### Environment variables

| Variable                | Required | Purpose                                                                                                                                                  |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIVEKIT_URL`         | Yes      | LiveKit Cloud project WebSocket URL                                                                                                                      |
| `LIVEKIT_API_KEY`     | Yes      | LiveKit Cloud project API key                                                                                                                            |
| `LIVEKIT_API_SECRET`  | Yes      | LiveKit Cloud project API secret                                                                                                                         |
| `GROQ_API_KEY`        | Yes      | LLM (Qwen3, via Groq)                                                                                                                                    |
| `SONIOX_API_KEY`      | Yes      | TTS                                                                                                                                                      |
| `DEEPGRAM_API_KEY`    | Yes      | STT (Flux)                                                                                                                                               |
| `SLACK_WEBHOOK_URL`   | No       | Slack notification when a demo request completes. If unset, the tool still succeeds and just skips the Slack message.                                    |
| `LANGFUSE_PUBLIC_KEY` | No       | Langfuse observability — traces LLM calls, tool calls, and STT/TTS spans per session. If unset (along with the two below), tracing is skipped entirely. |
| `LANGFUSE_SECRET_KEY` | No       | Langfuse secret key, paired with the public key above.                                                                                                   |
| `LANGFUSE_BASE_URL`   | No       | Langfuse instance URL, e.g.`https://cloud.langfuse.com` (EU) or `https://us.cloud.langfuse.com` (US).                                                |

### Other commands

```bash
pnpm test        # run tests (vitest)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm start        # production start (used by the Dockerfile)
```

## Deployment

Deploys to LiveKit Cloud via the LiveKit CLI, using the included `Dockerfile` and
`livekit.toml`:

```bash
lk cloud auth
lk agent deploy
```

Secrets (the environment variables above) are set separately via `lk agent secrets`, not
committed to the repo.

## Known limitations

- Server-side noise cancellation (Krisp, via LiveKit Cloud) is not enabled — it crashed the
  agent process on activation in testing and was disabled. Noise reduction currently relies on
  the browser's default WebRTC audio processing (echo cancellation, noise suppression, auto
  gain control) rather than an explicit RNNoise-style pipeline.
- **Cold start on first connection (deployed).** On LiveKit Cloud's free (Build) plan, the
  production agent scales down to zero replicas once all sessions end; the next visitor's
  connection triggers a cold start that adds ~10-20s before the agent joins the room. This is a
  platform tier limit, not something `prewarm`/`num_idle_processes` can fix — those only
  pre-load processes/models within an already-running instance, they don't keep the instance
  itself alive between sessions. Staying warm continuously requires a paid LiveKit Cloud plan
  (Ship or higher).
- **Separately, local `pnpm dev` testing has its own cold start** — `lk agent dev` defaults
  `numIdleProcesses` to 0, so prewarm (VAD load, greeting pre-synthesis) runs in every job's
  critical path instead of ahead of time. `src/main.ts` pins `numIdleProcesses: 1` (applies in
  both dev and production) so only the very first job — locally, or after a deployed replica
  wakes from the free-tier cold start above — pays this cost.

## Observability

Optional Langfuse export of the SDK's built-in per-session OpenTelemetry traces (LLM calls,
tool calls, STT/TTS spans) — see `src/livekit/tracing.ts`. Skipped entirely if the
`LANGFUSE_*` env vars aren't set. Registering Langfuse's span processor alongside LiveKit's own
keeps [Agent insights in LiveKit Cloud](https://docs.livekit.io/deploy/observability/insights/)
working too, not just Langfuse.

## Testing

Two layers, per [LiveKit&#39;s testing guide](https://docs.livekit.io/agents/start/testing/):

- **Turn-level (`tests/`, `pnpm test`)** — Vitest behavioral evals and unit tests, asserting on
  individual turns via `session.run()`. Runs locally/CI, text-mode, deterministic.
- **Scenario-level (`scenarios.yaml`)** — full end-to-end conversations against an LLM-driven
  simulated visitor, judged as a whole rather than turn by turn. Covers a happy path (asks what
  the assistant can help with, then books a demo end-to-end) and an unhappy path (a rejected
  personal email, plus an off-topic/prompt-injection attempt, both recovered from before the
  booking completes). Run with:
  ```bash
  lk agent simulate --scenarios scenarios.yaml
  ```

  Runs on LiveKit Cloud (beta feature), against your authenticated `lk` project. Run scenarios
  one at a time (`--concurrency 1`) rather than back-to-back — Groq's free-tier rate limit for
  `qwen/qwen3.8-27b` (8,000 tokens/minute) is easy to exhaust across multiple simulated
  conversations in the same minute, which surfaces as a false "agent produced no response
  items" failure rather than an actual agent defect.

## Possible improvements

- Server-side noise cancellation, once the crash is root-caused.
- More scenarios (noisy environment, multilingual switching) beyond the two in
  `scenarios.yaml`.
