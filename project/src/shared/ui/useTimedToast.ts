import { useEffect, useRef, useState } from 'react';

const DEFAULT_TOAST_DURATION_MS = 3000;

export const useTimedToast = (durationMs = DEFAULT_TOAST_DURATION_MS) => {
  const [message, setMessage] = useState('');
  const timerRef = useRef<number | null>(null);

  const clearToast = () => {
    setMessage('');

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const showToast = (nextMessage: string) => {
    clearToast();
    window.setTimeout(() => setMessage(nextMessage), 0);

    timerRef.current = window.setTimeout(() => {
      setMessage('');
      timerRef.current = null;
    }, durationMs);
  };

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return {
    clearToast,
    message,
    showToast,
  };
};
