'use client';

import { useEffect, useState } from 'react';
import { RoomAudioRenderer, SessionProvider, useSession } from '@livekit/components-react';
import { TokenSource } from 'livekit-client';
import { Launcher } from './Launcher';
import { WidgetPanel } from './WidgetPanel';

const TOKEN_SOURCE = TokenSource.endpoint('/api/token');

export default function VoiceWidget() {
  const session = useSession(TOKEN_SOURCE, { agentName: 'agent' });
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
