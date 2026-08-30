'use client';

import { useEffect, useState } from 'react';
import { RoomAudioRenderer, SessionProvider, useSession } from '@livekit/components-react';
import { TokenSource } from 'livekit-client';
import { Launcher } from './Launcher';
import { WidgetPanel } from './WidgetPanel';

const TOKEN_SOURCE = TokenSource.endpoint('/api/token');

// LiveKit Cloud's free-tier scale-to-zero cold start takes ~10-20s (see agent/README.md's
// Known limitations), right at the SDK's 20s default agentConnectTimeoutMilliseconds — so a
// visitor's first connection can time out on nothing but normal cold-start variance. Raised
// well past that worst case rather than tuned tight, since a real failure just takes longer
// to surface, not silently hang.
const AGENT_CONNECT_TIMEOUT_MS = 60_000;

export default function VoiceWidget() {
  const session = useSession(TOKEN_SOURCE, {
    agentName: 'agent',
    agentConnectTimeoutMilliseconds: AGENT_CONNECT_TIMEOUT_MS,
  });
  const [isOpen, setIsOpen] = useState(false);

  // Only end the session on unmount if it was actually started — connecting is deferred
  // until the visitor opens the widget from the launcher, not on page load.
  useEffect(() => {
    return () => {
      session.end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    session.end();
    setIsOpen(false);
  };

  const handleOpen = () => {
    session.start();
    setIsOpen(true);
  };

  return (
    <SessionProvider session={session}>
      {isOpen ? <WidgetPanel onClose={handleClose} /> : <Launcher onOpen={handleOpen} />}
      <RoomAudioRenderer />
    </SessionProvider>
  );
}
