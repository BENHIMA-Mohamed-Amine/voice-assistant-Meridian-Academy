import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  type VAD,
  cli,
  defineAgent,
  voice,
} from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as silero from '@livekit/agents-plugin-silero';
import * as soniox from '@livekit/agents-plugin-soniox';
// import { NoiseCancellation } from '@livekit/noise-cancellation-node'; // see inputOptions below
import { RoomEvent } from '@livekit/rtc-node';
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

// Read once, after dotenv.config() above, so it's available before entry() needs it.
// See the note on the TTS construction below for why this can't come from the plugin's own
// default: the soniox TTS plugin captures process.env.SONIOX_API_KEY in a module-level
// object evaluated at import time, which runs before this file's own top-level dotenv.config()
// call — ES module imports always evaluate before the importing module's own top-level code —
// so the plugin's default would otherwise silently capture undefined.
const SONIOX_API_KEY = process.env.SONIOX_API_KEY;
if (!SONIOX_API_KEY) {
  throw new Error('SONIOX_API_KEY is not set. Add it to .env.local.');
}

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
    // minSilenceDuration defaults to 550ms; VAD here only drives interruption detection
    // (turnHandling.interruption below), since end-of-turn itself comes from Deepgram
    // Flux's own endpointing (turnDetection: 'stt'), not the VAD/audio-turn-detector path.
    proc.userData.vad = (await silero.VAD.load({ minSilenceDuration: 350 })) as unknown as VAD;
  },

  entry: async (ctx: JobContext<ProcessUserData>) => {
    // Client-side noise flag ('lk.noise' data channel, see VoiceWidget.tsx) — a supporting
    // signal for the confidence-gated "please repeat" check in agent.ts's onUserTurnCompleted,
    // not a standalone trigger. Read as a getter (not a snapshot) so the confidence check
    // always sees the latest known state at the moment a turn completes, per
    // architecture-decisions.md.
    let isEnvironmentNoisy = false;
    ctx.room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (topic !== 'lk.noise') return;
      try {
        const { overThreshold } = JSON.parse(Buffer.from(payload).toString('utf-8')) as {
          overThreshold?: unknown;
        };
        isEnvironmentNoisy = overThreshold === true;
      } catch (err) {
        console.error('Failed to parse lk.noise payload:', err);
      }
    });

    // Set up a voice AI pipeline using Silero VAD via LiveKit Inference (no separate
    // provider API key/billing), plus the Deepgram plugin directly for STT — see the STT
    // comment below for why that one isn't on LiveKit Inference. The STT choice (Deepgram
    // over Soniox) was purely about endpointing latency; see architecture-decisions.md.
    //
    // TTS is Soniox — its earlier drop (see architecture-decisions.md) was about STT
    // latency specifically, not TTS, so it's back in play here on its own merits: one
    // model across 60+ languages (no per-language voice swap needed, unlike Cartesia,
    // which kept defaulting to English pronunciation rules for French replies — see the
    // git history on this file).
    // ponytail: no `model`/`language` override — bare defaults (`tts-rt-v1-preview`, `en`,
    // voice `Maya`), matching the last config confirmed working end-to-end (see git history:
    // 50d1ff4). Explicitly setting `model: 'tts-rt-v2'` was tried and is silently broken —
    // verified directly against the real API with a standalone probe script: v2 produced 0
    // audio frames through @livekit/agents-plugin-soniox@1.7.1 (no error, just nothing),
    // while these defaults produced 21 frames and a clean final. The plugin can't parse
    // whatever response shape v2 returns. Risk: Soniox retires tts-rt-v1 on 2026-08-31 — if
    // their backend then serves v2-shaped responses to v1 requests, this same silent-zero-
    // audio bug could resurface regardless of the model string sent, since the break is in
    // the client's response parsing, not the model name. Re-run the probe (or check for a
    // plugin update) before or right after that date.
    const tts = new soniox.TTS({
      apiKey: SONIOX_API_KEY,
    });

    const session = new voice.AgentSession({
      // Speech-to-text (STT) is your agent's ears, turning the user's speech into text that the LLM can understand.
      // `flux-general-multi` auto-detects language per segment (covers English + French,
      // among others) so the agent doesn't need to know in advance which language the visitor will use.
      //
      // Whatever STT you use with the default audio TurnDetector, you're paying
      // (VAD silence) + (STT final-transcript latency) + (turn-detector inference) before
      // the LLM even starts — the framework gates the turn detector on a FINAL_TRANSCRIPT
      // existing at all (see @livekit/agents src/voice/audio_recognition.ts), so a slow STT
      // stalls end-of-turn detection regardless of provider. That was the real source of
      // multi-second turn latency with nova-3, and Soniox hit the same wall for the same
      // reason. Flux collapses this: its own phrase-endpointing model (acoustic + semantic)
      // *is* the end-of-turn signal, so turnDetection: 'stt' below skips the wait entirely.
      //
      // On the direct plugin (own DEEPGRAM_API_KEY), not `inference.STT`: verified in the
      // plugin's own source that Flux's periodic `Update` events map to INTERIM_TRANSCRIPT,
      // giving live-updating captions. LiveKit Inference's hosted Flux gateway was tested and
      // did not forward those as interims — only the final transcript landed client-side.
      stt: new deepgram.STTv2({
        model: 'flux-general-multi',
      }),

      // Text-to-speech (TTS) is your agent's voice, turning the LLM's text into speech that the user can hear.
      tts,

      // Voice activity detection (VAD) — distinguishes speech from silence/noise.
      // Prewarmed above and reused from proc.userData rather than loaded fresh per call.
      vad: ctx.proc.userData.vad,

      turnHandling: {
        // Deepgram Flux has its own built-in phrase-endpointing model (acoustic + semantic),
        // so we use its end-of-turn signal directly instead of the generic audio TurnDetector.
        // VAD (below) still handles interruption detection.
        // See https://docs.livekit.io/agents/models/stt/deepgram/#turn-detection
        turnDetection: 'stt',
        endpointing: {
          // Flux already runs its own endpointing; the SDK's min_delay is additive on top
          // of that, so keep it at 0 to avoid double-waiting.
          minDelay: 0,
          maxDelay: 3000,
        },
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
      agent: createAgent(() => isEnvironmentNoisy),
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

    // Retarget the TTS to whichever language the visitor just spoke, so the agent's reply
    // (which follows the same language per the prompt's Language rule) is synthesized with
    // the right pronunciation instead of Cartesia's 'en' default. See the `tts` comment above.
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal && ev.language) {
        tts.updateOptions({ language: ev.language });
      }
    });

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
