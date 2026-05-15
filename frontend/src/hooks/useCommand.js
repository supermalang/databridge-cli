import { useCallback, useRef, useState } from 'react';

// Streams logs from POST /api/run/<command> — the backend writes SSE-style frames
// (event: log / status / done\\ndata: {...}\\n\\n) into the response body. We can't use
// EventSource because that's GET-only, so we read the body manually.
//
// onLog and onDone are stable callbacks the caller provides via refs.
export function useCommand({ onLog, onStatus } = {}) {
  const [running, setRunning] = useState(false);
  const [activeCmd, setActiveCmd] = useState(null);

  const onLogRef = useRef(onLog);
  const onStatusRef = useRef(onStatus);
  onLogRef.current = onLog;
  onStatusRef.current = onStatus;

  const run = useCallback(async (command, opts = {}) => {
    if (running) return;
    setRunning(true);
    setActiveCmd(command);
    onStatusRef.current?.({ command, status: 'running' });

    const body = {};
    if (opts.sample) body.sample = opts.sample;
    if (opts.split_by) body.split_by = opts.split_by;
    if (opts.session) body.session = opts.session;
    if (opts.random_sample) body.random_sample = opts.random_sample;

    let finalStatus = null;
    try {
      const res = await fetch(`/api/run/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          let ev = 'message', data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) ev = line.slice(7);
            if (line.startsWith('data: '))  data = line.slice(6);
          }
          if (!data) continue;
          const payload = JSON.parse(data);
          if (ev === 'log') {
            onLogRef.current?.(payload.line, payload.level || 'info');
          } else if (ev === 'status') {
            finalStatus = payload.status;
            onStatusRef.current?.({ command, ...payload });
          }
        }
      }
    } catch (err) {
      onStatusRef.current?.({ command, status: 'error', error: String(err) });
      finalStatus = 'error';
    } finally {
      setRunning(false);
      setActiveCmd(null);
      if (finalStatus && finalStatus !== 'success' && finalStatus !== 'error') {
        // ensure caller sees a terminal status
        onStatusRef.current?.({ command, status: finalStatus });
      }
    }
  }, [running]);

  const stop = useCallback(async () => {
    try { await fetch('/api/stop', { method: 'POST' }); } catch {}
  }, []);

  return { run, stop, running, activeCmd };
}
