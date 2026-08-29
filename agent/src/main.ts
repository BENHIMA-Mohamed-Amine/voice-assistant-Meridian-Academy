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
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TRANSCRIPT_CONFIDENCE_THRESHOLD } from './agent/audioQuality.ts';
import { createAgent } from './agent/agent.ts';
import { publishConfidence } from './livekit/confidenceSignal.ts';
import { watchConfidenceThreshold } from './livekit/confidenceThresholdSignal.ts';
import { publishLatencyMetrics } from './livekit/latencyMetrics.ts';
import { watchNoiseSignal } from './livekit/noiseSignal.ts';
import { setupLangfuseTracing } from './livekit/tracing.ts';

// Make sure to set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET when running locally
// or self-hosting your agent server.
dotenv.config({ path: '.env.local' });

// Read explicitly (not left to the plugin's own env lookup) and passed to the TTS client
// below, since the plugin resolves its default key at import time, before dotenv.config()
// above has run.
const SONIOX_API_KEY = process.env.SONIOX_API_KEY;
if (!SONIOX_API_KEY) {
  throw new Error('SONIOX_API_KEY is not set. Add it to .env.local.');
}

// Loaded once per worker process (not per call) and reused across jobs via prewarm below.
interface ProcessUserData {
  vad: VAD;
}

export default defineAgent<ProcessUserData>({
  prewarm: async (proc: JobProcess<ProcessUserData>) => {
    // Cast needed because pnpm resolves the plugin's own nested copy of @livekit/agents as a
    // peer dependency, so `silero.VAD` is a structurally identical but distinct type from
    // this file's `VAD` import. minSilenceDuration is lowered from the 550ms default; VAD
    // here only feeds interruption detection, since end-of-turn comes from the STT below.
    proc.userData.vad = (await silero.VAD.load({ minSilenceDuration: 350 })) as unknown as VAD;
  },

  entry: async (ctx: JobContext<ProcessUserData>) => {
    // Routes this session's spans (LLM calls, tool calls, STT/TTS) to Langfuse, if configured.
    const traceProvider = setupLangfuseTracing({ 'langfuse.session.id': ctx.room.name });
    if (traceProvider) {
      ctx.addShutdownCallback(async () => {
        await traceProvider.shutdown();
      });
    }

    const isEnvironmentNoisy = watchNoiseSignal(ctx.room);
    const getConfidenceThreshold = watchConfidenceThreshold(
      ctx.room,
      DEFAULT_TRANSCRIPT_CONFIDENCE_THRESHOLD,
    );

    // Cartesia synthesizes faster, but Soniox is the TTS here: cheaper, and one model
    // natively covers both English and French without swapping voices per language.
    const tts = new soniox.TTS({ apiKey: SONIOX_API_KEY });

    const session = new voice.AgentSession({
      // Deepgram Flux, via the plugin directly (not LiveKit Inference) so interim
      // transcripts stream to the client as the visitor speaks.
      stt: new deepgram.STTv2({
        model: 'flux-general-multi',
      }),

      tts,

      // Prewarmed above and reused from proc.userData rather than loaded fresh per call.
      // Only drives interruption detection here — end-of-turn comes from the STT.
      vad: ctx.proc.userData.vad,

      turnHandling: {
        // Flux's own phrase-endpointing model decides end-of-turn directly, instead of the
        // generic audio turn detector, which would otherwise wait on a full transcript
        // before it can even start.
        turnDetection: 'stt',
        endpointing: {
          // Flux already runs its own endpointing, so no extra delay is added on top.
          minDelay: 0,
          maxDelay: 3000,
        },
        // Simpler and cheaper than adaptive (context-aware) interruption handling.
        interruption: { mode: 'vad' },
        // Disabled: caused duplicated/fragmented replies in testing.
        preemptiveGeneration: { enabled: false },
      },

      // Lets the LLM add emotion, pacing, and pauses to the reply automatically.
      expressive: true,
    });

    await session.start({
      agent: createAgent(
        isEnvironmentNoisy,
        (confidence) => publishConfidence(ctx.room, confidence),
        getConfidenceThreshold,
      ),
      room: ctx.room,
    });

    // Keeps the reply's spoken language matched to whatever the visitor last used.
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal && ev.language) {
        tts.updateOptions({ language: ev.language });
      }
    });

    publishLatencyMetrics(ctx.room, session);

    await ctx.connect();

    // Static greeting (TTS only, no LLM call) — faster and doesn't depend on the LLM
    // producing a good opener on cold start every time.
    session.say(
      "Hi there, welcome to Meridian Academy! I'm here to help you book a demo with our team. Whenever you're ready, just say the word and we'll get started.",
    );
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'agent',
  }),
);
