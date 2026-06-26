import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

// Spinner + rotating status caption shown while an AI task runs, so the user knows
// it's processing. Pass context-specific `messages`; they cycle every `interval` ms.
// `card` wraps it in a rail-card for use inside the right-hand rail.
export default function AiThinking({ messages, interval = 2200, card = false }) {
  const { t } = useTranslation();
  const defaults = [
    t('components.aiThinking.working'),
    t('components.aiThinking.analyzing'),
    t('components.aiThinking.almost'),
  ];
  const msgs = messages && messages.length ? messages : defaults;
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
