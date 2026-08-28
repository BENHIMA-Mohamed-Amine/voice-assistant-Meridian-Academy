import {
  type JobContext,
  type JobProcess,
  type VAD,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  voice,
} from '@livekit/agents';
import { NoiseCancellation } from '@livekit/noise-cancellation-node';
import * as silero from '@livekit/agents-plugin-silero';
import * as soniox from '@livekit/agents-plugin-soniox';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createAgent } from './agent.ts';

// Load environment variables from a local file.
// Make sure to set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET
// when running locally or self-hosting your agent server.
dotenv.config({ path: '.env.local' });

// Read once, after dotenv.config() above, so it's available before entry() needs it.
// See the note on the STT/TTS construction below for why this can't come from the plugin's own default.
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
    proc.userData.vad = (await silero.VAD.load()) as unknown as VAD;
  },

  entry: async (ctx: JobContext<ProcessUserData>) => {
    // Set up a voice AI pipeline using Soniox (STT + TTS), Silero VAD, and the LiveKit turn detector
    const session = new voice.AgentSession({
      // Speech-to-text (STT) is your agent's ears, turning the user's speech into text that the LLM can understand
      // apiKey is passed explicitly (rather than relying on the plugin's own env lookup) because
      // the plugin reads process.env.SONIOX_API_KEY once at import time, which is before this
      // file's dotenv.config() call runs — ES module imports always evaluate before the importing
      // module's own top-level code, so the plugin's default would otherwise capture `undefined`.
      stt: new soniox.STT({
        model: 'stt-rt-v5',
        languageHints: ['en'],
        apiKey: SONIOX_API_KEY,
      }),

      // Text-to-speech (TTS) is your agent's voice, turning the LLM's text into speech that the user can hear
      tts: new soniox.TTS({
        apiKey: SONIOX_API_KEY,
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
        // Allow the LLM to generate a response while waiting for the end of turn
        preemptiveGeneration: { enabled: true },
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
        // Krisp background noise suppression (NC) — removes environmental noise
        // (traffic, fans, music) while preserving speech. Included with LiveKit Cloud, no extra cost.
        noiseCancellation: NoiseCancellation(),
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

    // Join the room and connect to the user
    await ctx.connect();

    // Greet the user on joining
    session.generateReply({
      instructions: 'Greet the user in a helpful and friendly manner.',
    });
  },
});

// Run the agent server
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'agent',
  }),
);
