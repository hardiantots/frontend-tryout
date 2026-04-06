import { useEffect, useMemo, useState } from 'react';
import { useExamStore } from '../store/examStore';

export function useSectionTimer() {
  const sections = useExamStore((s) => s.sections);
  const activeOrder = useExamStore((s) => s.activeSectionOrder);
  const advanceSection = useExamStore((s) => s.advanceSection);

  const activeSection = useMemo(() => sections.find((s) => s.order === activeOrder), [sections, activeOrder]);
  const [remaining, setRemaining] = useState(activeSection?.durationSeconds ?? 0);

  useEffect(() => {
    setRemaining(activeSection?.durationSeconds ?? 0);
  }, [activeSection?.durationSeconds, activeSection?.order]);

  useEffect(() => {
    if (!activeSection) {
      return;
    }

    if (remaining <= 0) {
      advanceSection();
      return;
    }

    const timer = window.setTimeout(() => {
      setRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeSection, remaining, advanceSection]);

  return {
    activeSection,
    remainingSeconds: remaining,
  };
}
