import { telemetry } from '@livekit/agents';
import type { Attributes } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

// Optional: exports the agent's per-session OpenTelemetry traces (LLM calls, tool calls,
// STT/TTS spans) to Langfuse for conversation-level observability. Skipped entirely if the
// Langfuse env vars aren't set, same pattern as the optional Slack webhook.
export function setupLangfuseTracing(metadata?: Attributes): NodeTracerProvider | undefined {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_BASE_URL;

  if (!publicKey || !secretKey || !baseUrl) {
    return undefined;
  }

  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
  const traceExporter = new OTLPTraceExporter({
    url: `${baseUrl.replace(/\/$/, '')}/api/public/otel/v1/traces`,
    // Opts into Langfuse's realtime ingestion; without it spans can take up to 10 minutes
    // to appear.
    headers: { Authorization: `Basic ${auth}`, 'x-langfuse-ingestion-version': '4' },
  });

  // FanoutSpanProcessor lets the framework attach its own LiveKit Cloud exporter alongside
  // ours, so spans keep reaching Agent insights in LiveKit Cloud too, not just Langfuse.
  const fanout = new telemetry.FanoutSpanProcessor();
  const traceProvider = new NodeTracerProvider({
    spanProcessors: [new BatchSpanProcessor(traceExporter), fanout],
  });

  traceProvider.register();
  telemetry.setTracerProvider(traceProvider, {
    ...(metadata ? { metadata } : {}),
    registerSpanProcessor: (processor) => fanout.add(processor),
  });

  return traceProvider;
}
