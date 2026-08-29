import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  type VAD,
  cli,
  defineAgent,
  inference,
  voice,
} from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
// import { NoiseCancellation } from '@livekit/noise-cancellation-node'; // see inputOptions below
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createAgent } from './agent.ts';

// Mirrors the shape the client widget expects on the 'lk.metrics' data channel topic.
// Fields are filled in incrementally as each turn's metrics become available and
// published on every update, so the client always has the latest known value per field.
interface LatencyPayload {
  eouMs?: number;
  llmTtftMs?: number;
  ttsTtfbMs?: number;
  e2eMs?: number;
  e2eAvgMs?: number;
}

// Load environment variables from a local file.
// Make sure to set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET
// when running locally or self-hosting your agent server.
dotenv.config({ path: '.env.local' });

// Loaded once per worker process (not per call) and reused across jobs via prewarm below.
interface ProcessUserData {
  vad: VAD;
}

export default defineAgent<ProcessUserData>({
  // Runs once when the worker process starts, before any job is dispatched to it.
  // Loading Silero VAD here (instead of inside `entry`) avoids reloading the model on every call.
  prewarm: async (proc: JobProcess<ProcessUserData>) => {
    // pnpm installs the plugin's own nested copy of `@livekit/agents` (peer dependency),
    // so `silero.VAD` is structurally identical to but a distinct type from this file's `VAD`
    // import. The cast is safe: same compiled class, same version, just a duplicate module
    // instance — a known pnpm + TypeScript private-field quirk, not a real type mismatch.
    // minSilenceDuration defaults to 550ms — this is a hard floor on end-of-turn latency
    // that sits *before* the turn detector model even runs (VAD must first confirm silence).
    // 350ms; the documented minimum the audio turn detector accepts is 250ms (lower raises
    // a ValueError at session start). See docs.livekit.io/agents/logic/turns/turn-detector.
    proc.userData.vad = (await silero.VAD.load({ minSilenceDuration: 350 })) as unknown as VAD;
  },

  entry: async (ctx: JobContext<ProcessUserData>) => {
    // Set up a voice AI pipeline using LiveKit Inference (Deepgram STT + Cartesia TTS),
    // Silero VAD, and the LiveKit turn detector. Both run on LiveKit's own inference infra
    // (no separate provider API key/billing) and were chosen over Soniox for lower latency —
    // see architecture-decisions.md.
    const session = new voice.AgentSession({
      // Speech-to-text (STT) is your agent's ears, turning the user's speech into text that the LLM can understand.
      // Nova-3 supports English and French (among 40+ languages); `multi` auto-detects per segment
      // so the agent doesn't need to know in advance which language the visitor will use.
      stt: new inference.STT({
        model: 'deepgram/nova-3',
        language: 'multi',
      }),

      // Text-to-speech (TTS) is your agent's voice, turning the LLM's text into speech that the user can hear.
      // No `language` here — Cartesia's sonic-3 voices are cross-lingual (the same voice ID
      // renders any of its 40+ supported languages), and the agent switches between English
      // and French per the prompt's Language rule, so hardcoding one would fight that.
      tts: new inference.TTS({
        model: 'cartesia/sonic-3',
        voice: 'a167e0f3-df7e-4d52-a9c3-f949145efdab', // "Blake" — suggested voice, see docs.livekit.io/agents/models/tts/cartesia
      }),

      // Voice activity detection (VAD) — distinguishes speech from silence/noise.
      // Prewarmed above and reused from proc.userData rather than loaded fresh per call.
      vad: ctx.proc.userData.vad,

      turnHandling: {
        // Turn detection determines when the user is speaking and when the agent should respond.
        // The LiveKit audio turn detector is a multimodal model that encodes the user's audio
        // directly to predict end of turn. It's built into the SDK (no extra plugin) and
        // AgentSession supplies the required VAD automatically.
        // See more at https://docs.livekit.io/agents/logic/turns/turn-detector/
        turnDetection: new inference.TurnDetector(),
        // VAD-based interruption (standard mode) — simpler and cheaper than adaptive
        // (context-aware barge-in) mode. Revisit adaptive mode later, closer to production.
        interruption: { mode: 'vad' },
        // Disabled — was causing duplicated/fragmented replies (an early speculative
        // generation and the real one both getting forwarded). Revisit later if latency needs it.
        preemptiveGeneration: { enabled: false },
      },

      // Expressive mode injects the TTS provider's markup guide into the LLM prompt, so the model
      // emits inline delivery tags (emotion, pacing, non-verbal sounds) that the TTS renders and
      // the transcript never shows. Requires a TTS model that supports markup, such as the Fish
      // Audio model above.
      expressive: true,
    });

    // Start the session, which initializes the voice pipeline and warms up the models
    await session.start({
      agent: createAgent(),
      room: ctx.room,
      inputOptions: {
        // Disabled — the native NC processor crashes the whole agent process with a fatal
        // C++ exception ("Input and output sample rates must be equal") as soon as it
        // activates. NoiseCancellation() takes no config to fix the mismatch directly.
        // This was a bonus feature (server-side noise cleanup), not a spec requirement, so
        // disabling unblocks everything else; revisit as its own investigation later.
        // noiseCancellation: NoiseCancellation(),
      },
    });

    // // Add a virtual avatar to the session, if desired
    // // For other providers, see https://docs.livekit.io/agents/models/avatar/
    // const avatar = new anam.AvatarSession({
    //   personaConfig: {
    //     name: '...',
    //     avatarId: '...', // See https://docs.livekit.io/agents/models/avatar/plugins/anam
    //   },
    // });
    // // Start the avatar and wait for it to join
    // await avatar.start(session, ctx.room);

    // Per-turn latency, streamed to the client over the data channel so the widget's
    // latency panel can show real numbers instead of the old hardcoded placeholders.
    // ChatMessage.metrics is the non-deprecated per-turn surface (the session-level
    // metrics_collected event is deprecated) — see architecture-decisions.md.
    const latency: LatencyPayload = {};
    let e2eSumMs = 0;
    let e2eCount = 0;
    const metricsEncoder = new TextEncoder();

    const publishLatency = () => {
      void ctx.room.localParticipant
        ?.publishData(metricsEncoder.encode(JSON.stringify(latency)), {
          reliable: true,
          topic: 'lk.metrics',
        })
        .catch((err: unknown) => {
          console.error('Failed to publish latency metrics:', err);
        });
    };

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      if (ev.item.type !== 'message') return;
      const m = ev.item.metrics;
      if (!m) return;

      if (ev.item.role === 'user') {
        if (m.endOfTurnDelay === undefined) return;
        latency.eouMs = Math.round(m.endOfTurnDelay * 1000);
        publishLatency();
        return;
      }

      if (ev.item.role === 'assistant') {
        if (m.llmNodeTtft !== undefined) latency.llmTtftMs = Math.round(m.llmNodeTtft * 1000);
        if (m.ttsNodeTtfb !== undefined) latency.ttsTtfbMs = Math.round(m.ttsNodeTtfb * 1000);
        if (m.e2eLatency !== undefined) {
          latency.e2eMs = Math.round(m.e2eLatency * 1000);
          e2eSumMs += latency.e2eMs;
          e2eCount += 1;
          latency.e2eAvgMs = Math.round(e2eSumMs / e2eCount);
        }
        publishLatency();
      }
    });

    // Join the room and connect to the user
    await ctx.connect();

    // Static greeting (TTS only, no LLM call) — faster, cheaper, and avoids depending on
    // the LLM producing a good opener on cold start every time.
    session.say(
      "Hi there, welcome to Meridian Academy! I'm here to help you book a demo with our team. Whenever you're ready, just say the word and we'll get started.",
    );
  },
});

// Run the agent server
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'agent',
  }),
);
