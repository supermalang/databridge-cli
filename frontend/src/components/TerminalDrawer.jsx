import { useState } from 'react';

// Collapsible iframe to the ttyd terminal service. The proxy/Traefik routes
// /terminal/ to the terminal container in prod; in dev, vite proxies it too
// (the dev container won't have ttyd unless the user opts in, so the iframe
// may just show a 404 — that's fine, it's a non-essential convenience).
export default function TerminalDrawer() {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState('');

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !src) setSrc('/terminal/');
  };

  return (
    <div className={`dashboard-terminal ${open ? 'open' : ''}`}>
      <div className="dashboard-terminal-toggle" onClick={toggle}>
        <span>Terminal · /app</span>
        <span className="toggle-icon">▶</span>
      </div>
      <div className="dashboard-terminal-body">
        <iframe title="ttyd terminal" src={src} allowFullScreen />
      </div>
    </div>
  );
}
