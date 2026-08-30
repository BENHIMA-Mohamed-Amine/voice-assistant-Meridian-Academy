# Meridian Academy — Voice Assistant

A real-time voice assistant for "Meridian Academy" (a corporate training center) that talks to
website visitors, books a demo of one of its training programs, and stays usable in noisy,
real-world conditions.

Two parts, deployed separately:

- **[`agent/`](agent/)** — the LiveKit Agents worker (Node.js/TypeScript): speech-to-text, the
  LLM conversation, text-to-speech, noise/confidence handling. Deploys to LiveKit Cloud.
- **[`client/`](client/)** — the Next.js voice widget: connects to the room, renders the live
  transcript, noise meter, and latency readout. Deploys to Vercel.

Each has its own README with its file-by-file structure and setup instructions. This one covers
the app as a whole.

## Demo

https://github.com/user-attachments/assets/87d8ce10-dc4f-40bb-a87e-75342328ea03

The demo shows the assistant booking a training demo, exercising several features along the way:

- **Confidence-gated clarification** — raising the transcript confidence threshold so a normal STT transcript falls below it, causing the assistant to notice and ask a clarification question instead of guessing.
- **Noise-aware acknowledgment** — lowering the noise threshold while mimicking a noisy environment, prompting the assistant to notice and tell the visitor it's having trouble hearing them.
- **Smooth multilingual switching** — the conversation moves fluidly between English and French mid-conversation (the underlying model also supports Spanish and other languages, not just these two).
- **Low average latency** — end-to-end response time stays around ~1.3s throughout the call.
- **Successful Slack notification** — once the booking details are collected, the assistant notifies the team in Slack.
- **Prompt-injection resistance** — an attempt to break the assistant's instructions mid-conversation is handled correctly, with the LLM staying on task instead of complying.
- The conversation is then closed out.
- **Full trace observability** — every LLM call, tool call, and STT/TTS span from the session is saved in Langfuse for inspection afterward.

  
## Features

- **Real-time voice conversation** — streaming speech-to-text → LLM → streaming text-to-speech,
  with the response starting well under the ~2-3s target in normal conditions.
- **Live transcript** for both the visitor and the assistant, updating as each side speaks —
  not just once a turn finishes.
- **Bot state indicator** — listening / thinking / speaking, shown live in the widget header.
- **Ambient noise meter** — a real-time vumeter driven by the visitor's own microphone signal,
  with a visible, draggable threshold.
- **Noise- and confidence-aware responses** — the assistant is told, per turn, whether the
  visitor's environment is noisy and how confident the transcription was, and reacts to that
  naturally in its own reply (acknowledging noise, asking the visitor to repeat) rather than
  guessing at a bad transcript.
- **Transcript confidence displayed per message** — each visitor message shows the STT
  confidence score it was transcribed with.
- **Barge-in** — the visitor can interrupt the assistant mid-sentence.
- **Multilingual (English + French)** — detected automatically per turn, on both the STT and
  TTS side, with no need for the visitor to pick a language.
- **Live per-turn latency breakdown** — end-of-turn delay, LLM time-to-first-token, TTS
  time-to-first-byte, and total end-to-end latency, shown in the widget as the conversation
  happens.
- **Fast-starting greeting** — the opening line is pre-synthesized once per worker process
  (not per call), so it plays with no TTS wait at all. One warm process is also kept ready
  (`numIdleProcesses: 1`) so a session doesn't pay for process/model startup on top of that.
  See `agent/README.md`'s Known limitations for the cold starts this doesn't cover (LiveKit
  Cloud free-tier scale-to-zero).
- **Responsive layout** — works down to a single mobile viewport width, not just desktop.
- **Demo booking flow** — collects company name, a work email (personal email providers are
  rejected), and a program of interest, then notifies the support team on Slack.
- **Turn-level and scenario-level agent tests** — Vitest-based behavioral evals asserting on
  individual turns, plus full end-to-end conversation scenarios (a happy-path booking and an
  unhappy path covering a rejected personal email and an off-topic/prompt-injection attempt)
  run via LiveKit Cloud's agent simulations. See `agent/README.md`.

## How a connection is made

1. The visitor opens the widget and it requests a token from the client's own
   `/api/token` route (`client/src/app/api/token/route.ts`).
2. That route mints a short-lived LiveKit access token server-side (using
   `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`, which never reach the browser), scoped to a freshly
   generated room name, and returns it along with the LiveKit Cloud server URL.
3. The client connects to that LiveKit Cloud room over WebRTC using the token, and requests
   dispatch of an agent named `agent` into the room.
4. LiveKit Cloud dispatches the job to a running agent worker (the `agent/` process — running
   locally via `lk agent dev`, or deployed on LiveKit Cloud). The worker's `entry()` function
   sets up the STT/TTS/VAD pipeline, starts the agent session, and joins the same room.
5. From that point, the client's microphone audio streams to the agent (for STT) and the
   agent's synthesized speech streams back (for playback) over the same WebRTC room — plus
   three small data-channel topics running alongside the audio: `lk.noise` (client → agent,
   ambient noise threshold state), and `lk.confidence` / `lk.metrics` (agent → client, per-turn
   confidence and latency numbers).
6. Either side leaving the room (the visitor closing the widget, or the agent completing/erroring)
   ends the session.

## Tech stack

| Layer | Choice | Why (see `agent/README.md` for detail) |
| --- | --- | --- |
| Realtime transport | LiveKit Cloud | Managed WebRTC, agent hosting, and dispatch |
| STT | Deepgram Flux | Own phrase-endpointing for fast turn detection; streams interim transcripts |
| LLM | Qwen3 (via Groq) | Fast, cheap, instruct mode for simple slot-filling dialogue |
| TTS | Soniox | Cheaper than Cartesia, one model natively covers English + French |
| VAD | Silero | Interruption detection |
| Observability | Langfuse (optional) | Per-session LLM/tool/STT/TTS trace export, alongside LiveKit Cloud's own Agent insights |
| Backend | Node.js / TypeScript | `agent/` |
| Frontend | Next.js / React / TypeScript | `client/` |

## Known limitations & possible improvements

See the "Known limitations" and "Possible improvements" sections in
[`agent/README.md`](agent/README.md) for the current gaps (TTS latency stability, server-side
noise cancellation) and what's next.
