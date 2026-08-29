export function Launcher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label="Open Meridian Academy voice assistant"
      style={{
        position: 'fixed',
        bottom: 'max(24px, env(safe-area-inset-bottom))',
        right: 'max(24px, env(safe-area-inset-right))',
        width: 64,
        height: 64,
        border: 'none',
        cursor: 'pointer',
        background: 'transparent',
      }}
    >
      <div
        style={{ position: 'relative', width: 64, height: 64, borderRadius: '50%', color: 'var(--accent)' }}
      >
        <div
          className="ring-pulse"
          style={{
            position: 'absolute',
            inset: -14,
            borderRadius: '50%',
            background: 'oklch(0.74 0.15 55 / 0.14)',
          }}
        />
        <div
          className="ring-pulse-delayed"
          style={{
            position: 'absolute',
            inset: -6,
            borderRadius: '50%',
            background: 'oklch(0.74 0.15 55 / 0.20)',
          }}
        />
        <div
          style={{
            position: 'relative',
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'var(--panel-bg)',
            boxShadow: '0 12px 28px oklch(0 0 0 / 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"
              fill="var(--accent)"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </button>
  );
}
