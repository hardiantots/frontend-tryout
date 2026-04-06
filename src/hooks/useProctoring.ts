import { useEffect, useRef, useState } from 'react';
import { useExamStore } from '../store/examStore';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

type ProctoringEventType = 'TAB_HIDDEN' | 'WINDOW_BLUR' | 'WINDOW_FOCUS';

type UseProctoringParams = {
  sessionId: string;
  maxWarnings?: number;
  enabled?: boolean;
  onForceSubmit: (payload: { sessionId: string; warningCount: number; reason: string }) => Promise<void>;
};

type ProctoringDialog = {
  title: string;
  message: string;
};

const DUPLICATE_GUARD_MS = 500;

function getRequestHeaders(): HeadersInit {
  const token = window.localStorage.getItem('accessToken');
  if (!token) {
    return { 'Content-Type': 'application/json' };
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function recordEvent(sessionId: string, eventType: ProctoringEventType) {
  const response = await fetch(`${API_BASE}/exam/proctoring-event`, {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      sessionId,
      eventType,
      clientTimestamp: new Date().toISOString(),
      metadata: {
        visibilityState: document.visibilityState,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to record proctoring event with status ${response.status}`);
  }

  return (await response.json()) as {
    warningCount: number;
    shouldForceSubmit: boolean;
  };
}

export function useProctoring({ sessionId, maxWarnings = 3, enabled = true, onForceSubmit }: UseProctoringParams) {
  const warningCount = useExamStore((s) => s.warningCount);
  const incrementWarning = useExamStore((s) => s.incrementWarning);
  const setWarningCount = useExamStore((s) => s.setWarningCount);
  const forceSubmit = useExamStore((s) => s.forceSubmit);

  const [isForceSubmitting, setIsForceSubmitting] = useState(false);
  const [lastEventType, setLastEventType] = useState<ProctoringEventType | null>(null);
  const [dialog, setDialog] = useState<ProctoringDialog | null>(null);
  const submitTriggeredRef = useRef(false);
  const lastViolationAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !sessionId) {
      return;
    }

    const tryViolation = async (eventType: ProctoringEventType) => {
      const now = Date.now();
      if (now - lastViolationAtRef.current < DUPLICATE_GUARD_MS) {
        return;
      }
      lastViolationAtRef.current = now;
      setLastEventType(eventType);

      let nextWarnings = warningCount;
      let shouldForceSubmitFromServer = false;

      try {
        const result = await recordEvent(sessionId, eventType);
        nextWarnings = result.warningCount;
        shouldForceSubmitFromServer = result.shouldForceSubmit;
        setWarningCount(nextWarnings);
      } catch {
        // Fallback for offline/dev mode: continue local counting.
        if (eventType !== 'WINDOW_FOCUS') {
          nextWarnings = incrementWarning();
        }
      }

      if (eventType === 'WINDOW_FOCUS') {
        return;
      }

      if (nextWarnings < maxWarnings) {
        const remain = Math.max(0, maxWarnings - nextWarnings);
        setDialog({
          title: `Peringatan Anti-Cheat #${nextWarnings}`,
          message: `Anda terdeteksi meninggalkan halaman ujian. Mohon tetap berada di halaman ujian. Sisa toleransi: ${remain} kali.`,
        });
      }

      if (!shouldForceSubmitFromServer && nextWarnings < maxWarnings) {
        return;
      }

      if (submitTriggeredRef.current) {
        return;
      }

      submitTriggeredRef.current = true;
      forceSubmit();
      setIsForceSubmitting(true);
      setDialog({
        title: 'Batas Pelanggaran Tercapai',
        message: `Peringatan anti-cheat sudah mencapai ${Math.max(nextWarnings, maxWarnings)} kali. Ujian akan otomatis diakhiri dan hasil akhir akan ditampilkan.`,
      });
      try {
        await onForceSubmit({
          sessionId,
          warningCount: nextWarnings,
          reason: 'TAB_SWITCH_LIMIT_EXCEEDED',
        });
      } finally {
        setIsForceSubmitting(false);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void tryViolation('TAB_HIDDEN');
      }
      if (document.visibilityState === 'visible') {
        void tryViolation('WINDOW_FOCUS');
      }
    };

    const handleBlur = () => {
      void tryViolation('WINDOW_BLUR');
    };

    const handleFocus = () => {
      void tryViolation('WINDOW_FOCUS');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [enabled, sessionId, maxWarnings, warningCount, incrementWarning, setWarningCount, forceSubmit, onForceSubmit]);

  return {
    warningCount,
    isForceSubmitting,
    isBlocked: warningCount >= maxWarnings,
    lastEventType,
    dialog,
    closeDialog: () => setDialog(null),
  };
}
