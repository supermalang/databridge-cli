import { useState, useEffect } from 'react';

// Spinner + rotating status caption shown while an AI task runs, so the user knows
// it's processing. Pass context-specific `messages`; they cycle every `interval` ms.
// `card` wraps it in a rail-card for use inside the right-hand rail.
const DEFAULT_MESSAGES = ['Working…', 'Analyzing your data…', 'Almost there…'];

export default function AiThinking({ messages = DEFAULT_MESSAGES, interval = 2200, card = false }) {
  const msgs = messages && messages.length ? messages : DEFAULT_MESSAGES;
  const [i, setI] = useState(0);

  useEffect(() => {
    setI(0);
    if (msgs.length <= 1) return undefined;
    const id = setInterval(() => setI(n => (n + 1) % msgs.length), interval);
    return () => clearInterval(id);
  }, [interval, msgs.length]);

  const body = (
    <div className="ai-thinking" role="status" aria-live="polite">
      <span className="ai-spinner" aria-hidden="true" />
      {/* key={i} re-triggers the fade-in each time the caption changes */}
      <span className="ai-thinking__msg" key={i}>{msgs[i]}</span>
    </div>
  );
  return card ? <div className="rail-card ai-thinking-card">{body}</div> : body;
}
