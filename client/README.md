# Meridian Academy — Voice Widget

The frontend half of the voice assistant: a Next.js app that embeds a voice-chat widget,
connects to the LiveKit room, and renders live transcript, noise, and latency information.
Pairs with the `agent/` LiveKit Agents worker in this repo.

## Project structure

```
client/
├── src/
│   ├── app/
│   │   ├── page.tsx                   Renders the widget on the page.
│   │   ├── layout.tsx                 Root layout, page metadata (title, description).
│   │   ├── globals.css                Global styles and CSS custom properties (colors, etc.)
│   │   │                               used throughout the widget.
│   │   ├── favicon.ico                Browser tab icon.
│   │   └── api/token/route.ts         Server-only route that mints a LiveKit access token
│   │                                   for the visitor's session. Keeps LIVEKIT_API_KEY /
│   │                                   LIVEKIT_API_SECRET off the client.
│   │
│   ├── components/
│   │   ├── VoiceWidget.tsx            Top-level widget: session provider, toggles between
│   │   │                               the launcher and the open panel.
│   │   ├── Launcher.tsx               The floating button that opens the widget.
│   │   └── WidgetPanel.tsx            The open widget: header, status, latency readout,
│   │                                   transcript, noise meter, mic control.
│   │
│   └── hooks/
│       ├── useNoiseMeter.ts           Tracks ambient noise from the mic (a fast-fall/slow-rise
│       │                               floor tracker), exposes the configurable threshold,
│       │                               and reports threshold crossings to the agent.
│       ├── useLatencyMetrics.ts        Subscribes to per-turn latency numbers from the agent.
│       ├── useTranscriptConfidence.ts Subscribes to per-turn STT confidence from the agent
│       │                               and attaches it to the matching transcript bubble.
│       └── useConfidenceThreshold.ts  Exposes the configurable confidence threshold and
│                                       sends changes to the agent.
│
├── public/                            Static assets.
├── next.config.ts
└── package.json
```

## Local setup

Requires Node.js and pnpm.

```bash
pnpm install
cp .env.example .env.local   # if present; otherwise create .env.local (see below)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The agent (`agent/`) must also be running
(`pnpm dev` there) for the widget to actually connect to anything.

### Environment variables

Set these in `.env.local`:

| Variable               | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `LIVEKIT_URL`        | LiveKit Cloud project WebSocket URL                                 |
| `LIVEKIT_API_KEY`    | Used server-side only, in`/api/token`, to mint room access tokens |
| `LIVEKIT_API_SECRET` | Used server-side only, in`/api/token`, to mint room access tokens |

These are the same LiveKit Cloud project credentials used by `agent/`.

### Other commands

```bash
pnpm build   # production build
pnpm start   # serve the production build
pnpm lint    # eslint
```

## Deployment

Deploys as a standard Next.js app — Vercel is the natural target (`vercel deploy`), since
`/api/token` runs as a serverless function and the actual realtime pipeline stays on LiveKit
Cloud, not on Vercel. Set the three environment variables above in the Vercel project settings.
