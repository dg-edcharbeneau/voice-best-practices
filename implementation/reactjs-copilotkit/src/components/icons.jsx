// Minimal inline SVG icons — zero dependencies, drawn with `currentColor` so they
// inherit each button's text color and adapt to light/dark automatically. Sized
// 16px by default; pass `size` to override. Decorative (aria-hidden) — the button
// text carries the meaning.

function Svg({ size = 16, filled = false, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

// Microphone — "Listen" (start a session).
export function MicIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" x2="12" y1="18" y2="22" />
    </Svg>
  );
}

// Filled square — "Stop" (end the session, or stop generation).
export function StopIcon(props) {
  return (
    <Svg filled {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Svg>
  );
}

// Muted speaker — "Barge-in" (silence the agent that's speaking).
export function MuteIcon(props) {
  return (
    <Svg {...props}>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <line x1="22" x2="16" y1="9" y2="15" />
      <line x1="16" x2="22" y1="9" y2="15" />
    </Svg>
  );
}

// Paper plane — "Send" (submit typed text).
export function SendIcon(props) {
  return (
    <Svg {...props}>
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </Svg>
  );
}
