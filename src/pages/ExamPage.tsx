import { useEffect, useMemo, useRef, useState } from 'react';
import { useProctoring } from '../hooks/useProctoring';
import { useExamStore } from '../store/examStore';
import { RichTextRenderer } from '../components/RichTextRenderer';
import { ConfirmModal } from '../components/ConfirmModal';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const EXAM_RUNTIME_KEY = 'exam.runtime.v1';

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

type ExamRuntimeSnapshot = {
  sessionId: string;
  sections: Array<{ order: number; code: string; title: string; durationSeconds: number }>;
  activeSectionOrder: number;
  activeQuestionId?: string | null;
};

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

function formatTime(seconds: number): string {
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Strips Markdown / LaTeX syntax so jsPDF can print clean plain text.
 * Preserves newlines so splitTextToSize can wrap lines properly.
 */
function stripMarkdownForPdf(raw: string): string {
  return (
    raw
      // Convert common HTML block/line tags to newlines
      .replace(/<\/?(p|div|br|li|h[1-6])[^>]*>/gi, '\n')
      // Remove all other HTML tags
      .replace(/<[^>]+>/g, ' ')
      // CRLF -> LF
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Keep inline LaTeX but remove the wrappers so formulas are readable text
      .replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ')
      .replace(/\$([^$\n]+)\$/g, ' $1 ')
      // Keep \( ... \) and \[ ... \]
      .replace(/\\\(([\s\S]*?)\\\)/g, ' $1 ')
      .replace(/\\\[([\s\S]*?)\\\]/g, ' $1 ')
      // Remove Markdown headings but keep their text
      .replace(/^#{1,6}\s+(.+)$/gm, '$1')
      // Remove blockquotes
      .replace(/^>\s?/gm, '')
      // Remove horizontal rules
      .replace(/^---+$/gm, '')
      // Unwrap bold and italic
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      // Remove strikethrough
      .replace(/~~(.*?)~~/g, '$1')
      // Remove inline code
      .replace(/`([^`]+)`/g, '$1')
      // Remove link markup but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove pipe (table artifacts)
      .replace(/\|/g, ' ')
      // Decode minimal HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Remove emoji
      .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '')
      // Normalise multiple spaces on same line (don't collapse newlines)
      .replace(/[ \t]{2,}/g, ' ')
      // Collapse 3+ blank lines to 2
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

type LocalAnswerState = {
  selectedAnswer?: string;
  shortAnswerText?: string;
  selectedAnswers?: string[];
};

type ExamPageProps = {
  onLogout: () => void;
};

export function ExamPage({ onLogout }: ExamPageProps) {
  const {
    sessionId,
    sections,
    questions,
    activeSectionOrder,
    activeSectionRemaining,
    warningCount,
    isForceSubmitted,
    isCompleted,
    scoreSummary,
    reviewItems,
    aiInsight,
    activeQuestionId: storeActiveQuestionId,
    setSession,
    setQuestions,
    setLoadingQuestions,
    setActiveSectionRemaining,
    setActiveSectionOrder,
    setWarningCount,
    setAiInsight,
    setActiveQuestionId: setStoreActiveQuestionId,
    completeExam,
  } = useExamStore();

  type ModalState = {
    title: string;
    message: string;
    variant?: 'info' | 'warning' | 'danger';
    confirmLabel?: string;
    onConfirm?: () => void;
  };

  const [confirmModal, setConfirmModal] = useState<ModalState | null>(null);
  const closeConfirmModal = () => setConfirmModal(null);

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const openLightbox = (src: string) => setLightboxSrc(src);
  const closeLightbox = () => setLightboxSrc(null);

  const [resultLoading, setResultLoading] = useState(false);
  const [earlyNextLoading, setEarlyNextLoading] = useState(false);
  const [openedDiscussion, setOpenedDiscussion] = useState<string | null>(null);
  const [reviewPage, setReviewPage] = useState(1);
  const [insightLoading, setInsightLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [localAnswers, setLocalAnswers] = useState<Record<string, LocalAnswerState>>({});
  const [isNavSidebarOpen, setIsNavSidebarOpen] = useState(false);
  const [isNavSidebarClosing, setIsNavSidebarClosing] = useState(false);
  const [selectedSubTestCode, setSelectedSubTestCode] = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<'summary' | 'weak' | 'review'>('summary');
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState('');
  const [participantCongregation, setParticipantCongregation] = useState('');
  const [participantSchool, setParticipantSchool] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(true);
  const [isSectionReady, setIsSectionReady] = useState(false);
  const [prepCountdown, setPrepCountdown] = useState(0);
  const [preparingSectionOrder, setPreparingSectionOrder] = useState<number | null>(null);
  const restoredRuntimeRef = useRef(false);
  const forceFinalizeTriggeredRef = useRef(false);
  const closeSidebarTimerRef = useRef<number | null>(null);

  const activeSection = useMemo(() => sections.find((s) => s.order === activeSectionOrder) ?? null, [sections, activeSectionOrder]);
  const activeQuestion = useMemo(() => {
    if (!questions.length) {
      return null;
    }
    return questions.find((q) => q.id === activeQuestionId) ?? questions[0];
  }, [questions, activeQuestionId]);

  useEffect(() => {
    if (restoredRuntimeRef.current || sessionId) {
      setResumeLoading(false);
      return;
    }

    restoredRuntimeRef.current = true;
    const raw = window.localStorage.getItem(EXAM_RUNTIME_KEY);
    if (!raw) {
      return;
    }

    try {
      const snapshot = JSON.parse(raw) as ExamRuntimeSnapshot;
      if (!snapshot?.sessionId || !Array.isArray(snapshot.sections) || !snapshot.activeSectionOrder) {
        window.localStorage.removeItem(EXAM_RUNTIME_KEY);
        return;
      }

      setSession({
        sessionId: snapshot.sessionId,
        sections: snapshot.sections,
        activeSectionOrder: snapshot.activeSectionOrder,
        activeQuestionId: snapshot.activeQuestionId ?? null,
      });
      setResumeLoading(false);
    } catch {
      window.localStorage.removeItem(EXAM_RUNTIME_KEY);
      setResumeLoading(false);
    }
  }, [sessionId, setSession]);

  const fetchAndShowCompletedResults = async () => {
    setResultLoading(true);
    try {
      // Try to score the latest session (even if already submitted, score-session is idempotent)
      const scoreRes = await fetch(`${API_BASE}/exam/latest-completed-session`, {
        method: 'POST',
        headers: getRequestHeaders(),
      });

      if (!scoreRes.ok) {
        // Fallback: try resume-session to get session ID, then score it
        setResumeLoading(false);
        return;
      }

      const scorePayload = await scoreRes.json();
      if (scorePayload?.examSessionId && scorePayload?.scoreSummary) {
        setSession({
          sessionId: scorePayload.examSessionId,
          sections: [],
          activeSectionOrder: 1,
          activeQuestionId: null,
        });
        completeExam({
          scoreSummary: scorePayload.scoreSummary,
          reviewItems: scorePayload.reviewItems ?? [],
        });

        // Also fetch AI insight
        try {
          const insightRes = await fetch(`${API_BASE}/ai/insight`, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ examSessionId: scorePayload.examSessionId }),
          });
          if (insightRes.ok) {
            const insightPayload = await insightRes.json();
            setAiInsight(insightPayload.insight?.narrative ?? 'Insight AI belum tersedia.');
          }
        } catch {
          // AI insight is optional
        }
      }
    } catch {
      // Continue with normal flow
    } finally {
      setResultLoading(false);
      setResumeLoading(false);
    }
  };

  useEffect(() => {
    if (sessionId || isCompleted) {
      setResumeLoading(false);
      return;
    }

    let cancelled = false;

    const tryResumeSession = async () => {
      setResumeLoading(true);
      try {
        const res = await fetch(`${API_BASE}/exam/resume-session`, {
          method: 'POST',
          headers: getRequestHeaders(),
        });
        const payload = await res.json().catch(() => null);

        if (!res.ok) {
          // If isForceSubmitted is true (from re-login abuse), try to fetch the latest completed session results
          if (isForceSubmitted) {
            await fetchAndShowCompletedResults();
            return;
          }
          throw new Error(payload?.message ?? 'Gagal memuat sesi sebelumnya.');
        }

        if (!cancelled && payload?.resumed && payload.examSessionId) {
          // Check if the session was already submitted (e.g. due to re-login abuse)
          if (payload.status === 'AUTO_SUBMITTED' || payload.status === 'SUBMITTED') {
            // Session is already done, show results
            setSession({
              sessionId: payload.examSessionId,
              sections: payload.sections ?? [],
              activeSectionOrder: payload.activeSectionOrder,
              activeQuestionId: payload.activeQuestionId ?? null,
            });
            // Trigger finalization to show results
            await finalizeAfterForceSubmit(payload.examSessionId);
            return;
          }

          // If isForceSubmitted was set by AuthPage (re-login abuse detected on this login),
          // force-submit the active session immediately
          if (isForceSubmitted) {
            setSession({
              sessionId: payload.examSessionId,
              sections: payload.sections ?? [],
              activeSectionOrder: payload.activeSectionOrder,
              activeQuestionId: payload.activeQuestionId ?? null,
            });
            await finalizeAfterForceSubmit(payload.examSessionId);
            return;
          }

          setSession({
            sessionId: payload.examSessionId,
            sections: payload.sections ?? [],
            activeSectionOrder: payload.activeSectionOrder,
            activeQuestionId: payload.activeQuestionId ?? null,
          });
          if (typeof payload.warningCount === 'number') {
            setWarningCount(payload.warningCount);
          }
        } else if (!cancelled) {
          // No active session found. Try loading latest completed result so relogin scenarios
          // do not bounce users back to biodata when their exam is already finalized.
          await fetchAndShowCompletedResults();
        }
      } catch {
        if (isForceSubmitted) {
          await fetchAndShowCompletedResults();
          return;
        }
        // Keep UI stable and continue with manual start.
      } finally {
        if (!cancelled) {
          setResumeLoading(false);
        }
      }
    };

    void tryResumeSession();

    return () => {
      cancelled = true;
    };
  }, [sessionId, isCompleted, isForceSubmitted, setSession, setWarningCount]);

  useEffect(() => {
    if (!sessionId || isCompleted) {
      window.localStorage.removeItem(EXAM_RUNTIME_KEY);
      return;
    }

    const snapshot: ExamRuntimeSnapshot = {
      sessionId,
      sections,
      activeSectionOrder,
      activeQuestionId,
    };
    window.localStorage.setItem(EXAM_RUNTIME_KEY, JSON.stringify(snapshot));
  }, [sessionId, sections, activeSectionOrder, activeQuestionId, isCompleted]);

  const startSessionWithBiodata = async () => {
    if (sessionId) {
      return;
    }

    setOnboardingError(null);
    setOnboardingLoading(true);

    try {
      const res = await fetch(`${API_BASE}/exam/start-session`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
          fullName: participantName,
          congregation: participantCongregation,
          schoolName: participantSchool,
          agreedToTerms,
        }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.message ?? 'Gagal memulai sesi ujian.');
      }

      setSession({
        sessionId: payload.examSessionId,
        sections: payload.sections,
        activeSectionOrder: payload.activeSectionOrder,
        activeQuestionId: payload.activeQuestionId,
      });
      setIsSectionReady(false);
      setPreparingSectionOrder(null);
      setPrepCountdown(0);
    } catch (error) {
      setOnboardingError((error as Error).message);
    } finally {
      setOnboardingLoading(false);
    }
  };

  useEffect(() => {
    if (!sessionId || !activeSection || isCompleted || preparingSectionOrder != null) {
      return;
    }

    setIsSectionReady(false);
    setLoadingQuestions(true);
    fetch(`${API_BASE}/exam/section-questions`, {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({ examSessionId: sessionId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new ApiError('Failed to get section questions', res.status);
        }
        return res.json();
      })
      .then((payload) => {
        setQuestions(payload.questions ?? []);
        if (typeof payload.warningCount === 'number') {
          setWarningCount(payload.warningCount);
        }
        if (payload.activeSection?.order && payload.activeSection.order !== activeSectionOrder) {
          setActiveSectionOrder(payload.activeSection.order);
        }
        if (payload.activeSection?.serverRemainingSeconds != null) {
          setActiveSectionRemaining(payload.activeSection.serverRemainingSeconds);
        }
        setIsSectionReady(true);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          window.localStorage.removeItem(EXAM_RUNTIME_KEY);
          window.location.reload();
        }
      })
      .finally(() => {
        setLoadingQuestions(false);
      });
  }, [
    sessionId,
    activeSectionOrder,
    activeSection,
    isCompleted,
    preparingSectionOrder,
    setLoadingQuestions,
    setQuestions,
    setWarningCount,
    setActiveSectionRemaining,
    setActiveSectionOrder,
  ]);

  useEffect(() => {
    if (preparingSectionOrder == null) {
      return;
    }

    if (prepCountdown <= 0) {
      setPreparingSectionOrder(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setPrepCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [prepCountdown, preparingSectionOrder]);

  useEffect(() => {
    if (!sessionId || !activeSection || isCompleted || !isSectionReady || preparingSectionOrder != null) {
      return;
    }

    if (activeSectionRemaining <= 0) {
      fetch(`${API_BASE}/exam/heartbeat`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
          examSessionId: sessionId,
          sectionOrder: activeSectionOrder,
          clientRemainingSeconds: 0,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error('Failed to sync heartbeat');
          }
          return res.json();
        })
        .then((payload) => {
          if (typeof payload.warningCount === 'number') {
            setWarningCount(payload.warningCount);
          }
          if (payload.activeSectionOrder) {
            if (payload.activeSectionOrder !== activeSectionOrder && !payload.isFinished) {
              setActiveSectionOrder(payload.activeSectionOrder);
              setActiveSectionRemaining(payload.serverRemainingSeconds ?? 0);
              setPreparingSectionOrder(payload.activeSectionOrder);
              setPrepCountdown(45);
              setIsSectionReady(false);
              return;
            }
            setActiveSectionOrder(payload.activeSectionOrder);
          }
          setActiveSectionRemaining(payload.serverRemainingSeconds ?? 0);
          if (payload.isFinished) {
            void handleSubmitFinal();
          }
        })
        .catch(() => {
          // Keep starter stable.
        });
      return;
    }

    const timer = window.setTimeout(() => {
      setActiveSectionRemaining(Math.max(0, activeSectionRemaining - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    sessionId,
    activeSection,
    activeSectionOrder,
    activeSectionRemaining,
    isCompleted,
    isSectionReady,
    preparingSectionOrder,
    setActiveSectionOrder,
    setActiveSectionRemaining,
    setWarningCount,
  ]);

  useEffect(() => {
    if (!sessionId || !activeSection || isCompleted || !isSectionReady || preparingSectionOrder != null) {
      return;
    }

    const interval = window.setInterval(() => {
      fetch(`${API_BASE}/exam/heartbeat`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
          examSessionId: sessionId,
          sectionOrder: activeSectionOrder,
          clientRemainingSeconds: activeSectionRemaining,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error('Failed heartbeat');
          }
          return res.json();
        })
        .then((payload) => {
          if (typeof payload.warningCount === 'number') {
            setWarningCount(payload.warningCount);
          }
          if (typeof payload.serverRemainingSeconds === 'number') {
            setActiveSectionRemaining(payload.serverRemainingSeconds);
          }
          if (payload.activeSectionOrder && payload.activeSectionOrder !== activeSectionOrder) {
            setActiveSectionOrder(payload.activeSectionOrder);
            setPreparingSectionOrder(payload.activeSectionOrder);
            setPrepCountdown(45);
            setIsSectionReady(false);
          }
          if (payload.isFinished) {
            void handleSubmitFinal();
          }
        })
        .catch(() => {
          // Keep starter stable.
        });
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    sessionId,
    activeSection,
    activeSectionOrder,
    activeSectionRemaining,
    isCompleted,
    isSectionReady,
    preparingSectionOrder,
    setActiveSectionOrder,
    setActiveSectionRemaining,
    setWarningCount,
  ]);

  const finalizeAfterForceSubmit = async (forcedSessionId: string) => {
    if (forceFinalizeTriggeredRef.current || isCompleted) {
      return;
    }

    forceFinalizeTriggeredRef.current = true;
    setResultLoading(true);

    try {
      const submitRes = await fetch(`${API_BASE}/exam/submit-final`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ examSessionId: forcedSessionId }),
      });

      if (submitRes.ok) {
        const payload = await submitRes.json();
        completeExam({
          scoreSummary: payload.scoreSummary,
          reviewItems: payload.reviewItems ?? [],
        });
      }

      const insightRes = await fetch(`${API_BASE}/ai/insight`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ examSessionId: forcedSessionId }),
      });

      if (insightRes.ok) {
        const insightPayload = await insightRes.json();
        setAiInsight(insightPayload.insight?.narrative ?? 'Insight AI belum tersedia.');
      } else {
        setAiInsight('Gagal mengambil insight AI. Coba lagi.');
      }
    } catch {
      setAiInsight('Gagal mengambil insight AI. Coba lagi.');
    } finally {
      setResultLoading(false);
    }
  };

  const { isForceSubmitting, isBlocked, dialog: proctoringDialog, closeDialog } = useProctoring({
    sessionId: sessionId ?? '',
    enabled: Boolean(sessionId) && !isCompleted,
    onForceSubmit: async (payload) => {
      await fetch(`${API_BASE}/exam/force-submit`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(payload),
      });

      await finalizeAfterForceSubmit(payload.sessionId);
    },
  });

  const subtitle = useMemo(() => {
    if (!activeSection) {
      return 'Semua section selesai.';
    }
    return `${activeSection.order}/${sections.length} - ${activeSection.title}`;
  }, [activeSection, sections.length]);

  const canNavigateTo = (order: number) => order === activeSectionOrder;

  const isAnswered = (questionId: string) => {
    const local = localAnswers[questionId];
    if (local?.selectedAnswer) {
      return true;
    }

    if (local?.shortAnswerText && local.shortAnswerText.trim().length > 0) {
      return true;
    }

    if (local?.selectedAnswers && local.selectedAnswers.length > 0) {
      return true;
    }

    const question = questions.find((q) => q.id === questionId);
    if (!question?.savedAnswer) {
      return false;
    }

    if (question.savedAnswer.selectedAnswer) {
      return true;
    }

    if (question.savedAnswer.shortAnswerText && question.savedAnswer.shortAnswerText.trim().length > 0) {
      return true;
    }

    return !!question.savedAnswer.selectedAnswers?.length;
  };

  const answeredCount = useMemo(() => questions.filter((q) => isAnswered(q.id)).length, [questions, localAnswers]);

  const jumpToQuestion = (questionId: string) => {
    setActiveQuestionId(questionId);
  };

  const openNavSidebar = () => {
    if (closeSidebarTimerRef.current != null) {
      window.clearTimeout(closeSidebarTimerRef.current);
      closeSidebarTimerRef.current = null;
    }
    setIsNavSidebarClosing(false);
    setIsNavSidebarOpen(true);
  };

  const closeNavSidebar = () => {
    if (!isNavSidebarOpen || isNavSidebarClosing) {
      return;
    }

    setIsNavSidebarClosing(true);
    closeSidebarTimerRef.current = window.setTimeout(() => {
      setIsNavSidebarOpen(false);
      setIsNavSidebarClosing(false);
      closeSidebarTimerRef.current = null;
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (closeSidebarTimerRef.current != null) {
        window.clearTimeout(closeSidebarTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!lightboxSrc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxSrc]);

  useEffect(() => {
    if (!isCompleted || !scoreSummary) {
      return;
    }

    const keys = Array.from(new Set(reviewItems.map((item) => item.subTestCode)));
    if (!keys.length) {
      setSelectedSubTestCode(null);
      return;
    }

    setSelectedSubTestCode((prev) => (prev && keys.includes(prev) ? prev : keys[0]));
  }, [isCompleted, scoreSummary]);

  const filteredReviewItems = useMemo(() => {
    if (!selectedSubTestCode) {
      return reviewItems;
    }
    return reviewItems.filter((item) => item.subTestCode === selectedSubTestCode);
  }, [reviewItems, selectedSubTestCode]);

  const reviewPageSize = 5;
  const reviewTotalPages = Math.max(1, Math.ceil(filteredReviewItems.length / reviewPageSize));
  const paginatedReviewItems = useMemo(() => {
    const safePage = Math.min(reviewPage, reviewTotalPages);
    const start = (safePage - 1) * reviewPageSize;
    return filteredReviewItems.slice(start, start + reviewPageSize);
  }, [filteredReviewItems, reviewPage, reviewTotalPages]);

  useEffect(() => {
    setReviewPage(1);
  }, [selectedSubTestCode, resultTab]);

  useEffect(() => {
    if (reviewPage > reviewTotalPages) {
      setReviewPage(reviewTotalPages);
    }
  }, [reviewPage, reviewTotalPages]);

  const subTestNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    sections.forEach((section) => {
      map[section.code] = section.title;
    });
    return map;
  }, [sections]);

  const weakMaterials = useMemo(() => {
    if (!scoreSummary?.weakMaterials?.length) {
      return [];
    }

    const base = selectedSubTestCode
      ? scoreSummary.weakMaterials.filter((item) => item.subTestCode === selectedSubTestCode)
      : scoreSummary.weakMaterials;

    return [...base]
      .sort((a, b) => {
        if (a.wrong !== b.wrong) {
          return b.wrong - a.wrong;
        }
        return a.accuracy - b.accuracy;
      })
      .slice(0, 10);
  }, [scoreSummary, selectedSubTestCode]);

  const handleDownloadResultPdf = async () => {
    if (!scoreSummary || !isCompleted || pdfLoading) {
      return;
    }

    setPdfLoading(true);
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);

      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const marginX = 40;

      doc.setFontSize(15);
      doc.text('Laporan Hasil Try Out SNBT', marginX, 40);
      doc.setFontSize(10);
      doc.text(`Tanggal unduh: ${new Date().toLocaleString('id-ID')}`, marginX, 58);

      doc.setFontSize(12);
      doc.text('1) Skor Akhir', marginX, 86);
      doc.setFontSize(10);
      doc.text(
        `Benar: ${scoreSummary.totals.correct} | Salah: ${scoreSummary.totals.wrong} | Dijawab: ${scoreSummary.totals.answered}`,
        marginX,
        102,
      );

      const subTestRows = Object.entries(scoreSummary.bySubTest).map(([code, item]) => [
        subTestNameMap[code] ?? code,
        String(item.correct),
        String(item.wrong),
        String(item.total),
      ]);

      autoTable(doc, {
        startY: 116,
        head: [['Sub-Tes', 'Benar', 'Salah', 'Total']],
        body: subTestRows,
        styles: { fontSize: 9, cellPadding: 4 },
      });

      const aiStart = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 18 : 270;
      doc.setFontSize(12);
      doc.text('2) Rekomendasi AI', marginX, aiStart);

      const aiRaw = aiInsight ?? 'Belum ada rekomendasi AI yang tersimpan.';
      const aiText = stripMarkdownForPdf(aiRaw);
      // splitTextToSize wraps long lines; each \n becomes a new entry
      const aiLines = aiText
        .split('\n')
        .flatMap((line) => (line.trim() === '' ? [''] : doc.splitTextToSize(line.trim(), 740) as string[]));
      doc.setFontSize(10);
      let aiY = aiStart + 16;
      for (const line of aiLines) {
        if (aiY > 540) {
          doc.addPage();
          aiY = 40;
        }
        if (line.trim() === '') {
          aiY += 6; // blank line spacing
        } else {
          doc.text(line, marginX, aiY);
          aiY += 14;
        }
      }

      const weakStart = aiY + 10;
      doc.setFontSize(12);
      doc.text('3) Materi Sub-Tes Yang Masih Lemah', marginX, weakStart);

      const weakRows = weakMaterials.length
        ? weakMaterials.map((item) => [
            item.subTestName,
            item.materialTopic,
            String(item.wrong),
            String(item.answered),
            `${Math.round((item.accuracy || 0) * 100)}%`,
          ])
        : [['-', 'Belum ada data materi lemah', '-', '-', '-']];

      autoTable(doc, {
        startY: weakStart + 10,
        head: [['Sub-Tes', 'Materi', 'Salah', 'Dijawab', 'Akurasi']],
        body: weakRows,
        styles: { fontSize: 9, cellPadding: 4 },
      });

      // ── 4) Pembahasan Tiap Soal — format uraian (per soal, bukan tabel) ──
      const pgWidth = doc.internal.pageSize.getWidth();
      const contentWidth = pgWidth - marginX * 2;
      doc.addPage();
      let curY = 40;

      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('4) Pembahasan Tiap Soal', marginX, curY);
      doc.setFont('helvetica', 'normal');
      curY += 20;

      const printWrapped = (label: string, value: string, y: number, bold = false): number => {
        const text = stripMarkdownForPdf(value || '-');
        const lines = text
          .split('\n')
          .flatMap((ln) => (ln.trim() === '' ? [''] : (doc.splitTextToSize(ln.trim(), contentWidth - 10) as string[])));

        if (bold) doc.setFont('helvetica', 'bold');
        doc.text(label, marginX, y);
        if (bold) doc.setFont('helvetica', 'normal');
        let lineY = y;
        for (const ln of lines) {
          if (lineY > 545) {
            doc.addPage();
            lineY = 40;
          }
          if (ln.trim() === '') {
            lineY += 5;
          } else {
            doc.text(ln, marginX + 8, lineY);
            lineY += 13;
          }
        }
        return lineY + 4;
      };

      reviewItems.forEach((item, idx) => {
        const status = item.isCorrect == null ? 'Belum Dijawab' : item.isCorrect ? 'Benar ✓' : 'Salah ✗';

        if (curY > 510) {
          doc.addPage();
          curY = 40;
        }

        // Header soal
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(
          `Soal ${idx + 1}  |  ${item.subTestName}  |  ${item.materialTopic ?? '-'}  |  ${status}`,
          marginX,
          curY,
        );
        doc.setFont('helvetica', 'normal');
        curY += 14;

        // Garis pemisah header
        doc.setDrawColor(180, 180, 180);
        doc.line(marginX, curY, marginX + contentWidth, curY);
        curY += 8;

        doc.setFontSize(9);
        curY = printWrapped('Teks Soal:', item.questionText, curY);
        curY = printWrapped('Jawaban Anda:', item.userAnswer, curY);
        curY = printWrapped('Jawaban Benar:', item.correctAnswer, curY);
        if (item.discussion) {
          curY = printWrapped('Pembahasan:', item.discussion, curY);
        }

        curY += 10; // jarak antar soal
      });

      doc.save(`hasil-snbt-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch {
      // Keep UX stable when PDF library fails in runtime.
      setConfirmModal({
        title: 'Gagal Membuat PDF',
        message: 'Terjadi kesalahan saat membuat PDF hasil. Silakan coba lagi.',
        variant: 'warning',
      });
    } finally {
      setPdfLoading(false);
    }
  };

  useEffect(() => {
    if (!questions.length) {
      setActiveQuestionId(null);
      return;
    }

    if (storeActiveQuestionId && questions.some((q) => q.id === storeActiveQuestionId)) {
      setActiveQuestionId(storeActiveQuestionId);
      setStoreActiveQuestionId(null);
      return;
    }

    setActiveQuestionId((prev) => (prev && questions.some((q) => q.id === prev) ? prev : questions[0].id));
  }, [questions, storeActiveQuestionId, setStoreActiveQuestionId]);

  useEffect(() => {
    if (!sessionId || !activeQuestionId || isCompleted) return;

    const timer = setTimeout(() => {
      fetch(`${API_BASE}/exam/active-question`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
          examSessionId: sessionId,
          questionId: activeQuestionId,
        }),
      }).catch(() => {
        // Silently ignore sync errors
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [sessionId, activeQuestionId, isCompleted]);

  useEffect(() => {
    if (!activeQuestionId && questions.length) {
      setActiveQuestionId(questions[0].id);
    }
  }, [questions, activeQuestionId]);

  const onSelectOption = async (questionId: string, value: string) => {
    if (!sessionId) {
      return;
    }

    setLocalAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] ?? {}),
        selectedAnswer: value,
      },
    }));

    await fetch(`${API_BASE}/exam/submit-attempt`, {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({
        examSessionId: sessionId,
        questionId,
        selectedAnswer: value,
      }),
    }).catch(() => {
      // Keep starter stable.
    });
  };

  const onShortAnswer = async (questionId: string, value: string) => {
    if (!sessionId) {
      return;
    }

    setLocalAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] ?? {}),
        shortAnswerText: value,
      },
    }));

    await fetch(`${API_BASE}/exam/submit-attempt`, {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({
        examSessionId: sessionId,
        questionId,
        shortAnswerText: value,
      }),
    }).catch(() => {
      // Keep starter stable.
    });
  };

  const onSetComplexRowAnswer = async (questionId: string, rowIndex: number, value: 'LEFT' | 'RIGHT') => {
    if (!sessionId) {
      return;
    }

    const source = localAnswers[questionId]?.selectedAnswers ?? [];
    const next = [...source];
    next[rowIndex] = value;

    setLocalAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] ?? {}),
        selectedAnswers: next,
      },
    }));

    await fetch(`${API_BASE}/exam/submit-attempt`, {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({
        examSessionId: sessionId,
        questionId,
        selectedAnswers: next.filter(Boolean),
      }),
    }).catch(() => {
      // Keep starter stable.
    });
  };

  const doSubmitFinal = async () => {
    setResultLoading(true);
    await fetch(`${API_BASE}/exam/submit-final`, {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({ examSessionId: sessionId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Failed submit final');
        }
        return res.json();
      })
      .then((payload) => {
        completeExam({
          scoreSummary: payload.scoreSummary,
          reviewItems: payload.reviewItems ?? [],
        });
      })
      .catch(() => {
        // Keep starter stable.
      })
      .finally(() => {
        setResultLoading(false);
      });
  };

  const handleSubmitFinal = async () => {
    if (!sessionId || resultLoading || isCompleted) {
      return;
    }

    setConfirmModal({
      title: 'Selesaikan Ujian?',
      message: 'Yakin ingin menyelesaikan ujian sekarang? Sesi akan langsung diakhiri dan tidak bisa dibuka kembali.',
      variant: 'warning',
      confirmLabel: 'Ya, Selesaikan',
      onConfirm: () => {
        closeConfirmModal();
        void doSubmitFinal();
      },
    });
  };

  const doCompleteSectionEarly = async () => {
    setEarlyNextLoading(true);
    await fetch(`${API_BASE}/exam/complete-section-early`, {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({ examSessionId: sessionId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Failed complete section early');
        }
        return res.json();
      })
      .then((payload) => {
        if (payload.isFinished) {
          void doSubmitFinal();
          return;
        }

        if (payload.activeSectionOrder && payload.activeSectionOrder !== activeSectionOrder) {
          setActiveSectionOrder(payload.activeSectionOrder);
          setActiveSectionRemaining(payload.serverRemainingSeconds ?? 0);
          setPreparingSectionOrder(payload.activeSectionOrder);
          setPrepCountdown(45);
          setIsSectionReady(false);
        }
      })
      .catch(() => {
        setConfirmModal({
          title: 'Gagal Pindah Subtes',
          message: 'Terjadi kesalahan saat menyelesaikan subtes lebih awal. Silakan coba lagi.',
          variant: 'warning',
        });
      })
      .finally(() => {
        setEarlyNextLoading(false);
      });
  };

  const handleCompleteSectionEarly = async () => {
    if (!sessionId || isCompleted || resultLoading || earlyNextLoading || preparingSectionOrder != null) {
      return;
    }

    setConfirmModal({
      title: 'Akhiri Subtes Lebih Awal?',
      message: 'Yakin ingin mengakhiri subtes ini lebih cepat dan lanjut ke subtes berikutnya? Jawaban yang sudah diisi tetap tersimpan.',
      variant: 'warning',
      confirmLabel: 'Ya, Lanjutkan',
      onConfirm: () => {
        closeConfirmModal();
        void doCompleteSectionEarly();
      },
    });
  };

  const handleGetAiInsight = async () => {
    if (!sessionId || insightLoading) {
      return;
    }

    setInsightLoading(true);
    await fetch(`${API_BASE}/ai/insight`, {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({ examSessionId: sessionId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Failed AI insight');
        }
        return res.json();
      })
      .then((payload) => {
        setAiInsight(payload.insight?.narrative ?? 'Insight AI belum tersedia.');
      })
      .catch(() => {
        setAiInsight('Gagal mengambil insight AI. Coba lagi.');
      })
      .finally(() => {
        setInsightLoading(false);
      });
  };

  const confirmLogout = () => {
    setConfirmModal({
      title: 'Keluar dari Akun?',
      message: 'Yakin ingin keluar dari akun ini? Progres ujian yang sedang berjalan akan tetap tersimpan.',
      variant: 'warning',
      confirmLabel: 'Ya, Keluar',
      onConfirm: () => {
        closeConfirmModal();
        onLogout();
      },
    });
  };

  if (isCompleted && scoreSummary) {
    return (
      <main className="app-shell px-2 py-3 sm:px-3 md:px-4 lg:px-6 lg:py-6">
        {/* ── Lightbox / Image Popup (review mode) ── */}
        {lightboxSrc ? (
          <div
            className="lightbox-overlay fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/80 p-3"
            onClick={closeLightbox}
            role="dialog"
            aria-modal="true"
            aria-label="Tampilan gambar diperbesar"
          >
            <div
              className="lightbox-panel relative flex max-h-[92dvh] max-w-[96vw] flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="absolute -top-3 -right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-lg hover:bg-white"
                onClick={closeLightbox}
                aria-label="Tutup gambar"
              >
                ✕
              </button>
              <img
                src={lightboxSrc}
                alt="Tampilan gambar diperbesar"
                className="max-h-[88dvh] max-w-full rounded-xl object-contain shadow-2xl"
                draggable={false}
              />
              <p className="mt-2 text-xs text-white/70">Klik di luar atau tekan Esc untuk menutup</p>
            </div>
          </div>
        ) : null}
        {confirmModal ? (
          <ConfirmModal
            title={confirmModal.title}
            message={confirmModal.message}
            variant={confirmModal.variant}
            confirmLabel={confirmModal.confirmLabel}
            onConfirm={confirmModal.onConfirm}
            onCancel={closeConfirmModal}
          />
        ) : null}
        <header className="sticky top-0 z-40 mb-3 border border-slate-200/80 bg-white/90 p-3 shadow-sm backdrop-blur sm:rounded-2xl">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <img src="/logo-ppgt.webp" alt="Logo PPGT" className="h-9 w-9 rounded-full border border-slate-200 bg-white object-cover" />
              <h1 className="text-sm font-semibold text-slate-900">Try Out SNBT 2026 - Hasil Ujian</h1>
            </div>
            <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={confirmLogout}>
              Keluar
            </button>
          </div>
        </header>
        <section className="motion-once w-full rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm backdrop-blur sm:p-4">
          <header className="motion-once-delay-1 mb-4 rounded-xl bg-teal-50 p-3 sm:p-4">
            <h1 className="text-lg font-semibold text-teal-900">Hasil Akhir Try Out</h1>
            <p className="text-sm text-teal-800">
              Benar: {scoreSummary.totals.correct} | Salah: {scoreSummary.totals.wrong} | Dijawab: {scoreSummary.totals.answered}
            </p>
            <button
              className="mt-3 touch-target rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={handleGetAiInsight}
              disabled={insightLoading}
            >
              {insightLoading ? 'Mengambil Insight AI...' : 'Dapatkan Insight AI'}
            </button>
            <button
              className="mt-2 touch-target rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={handleDownloadResultPdf}
              disabled={pdfLoading}
            >
              {pdfLoading ? 'Menyiapkan PDF...' : 'Unduh PDF Hasil Akhir'}
            </button>
            {aiInsight ? (
              <div className="mt-3 rounded-lg bg-white p-3">
                <RichTextRenderer content={aiInsight} />
              </div>
            ) : null}
          </header>

          <section className="motion-once-delay-2 mb-4 rounded-xl border border-slate-200 bg-slate-50 p-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setResultTab('summary')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  resultTab === 'summary' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                Ringkasan Nilai
              </button>
              <button
                type="button"
                onClick={() => setResultTab('weak')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  resultTab === 'weak' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                Materi Perlu Fokus
              </button>
              <button
                type="button"
                onClick={() => setResultTab('review')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  resultTab === 'review' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                Review Pembahasan
              </button>
            </div>
          </section>

          {resultTab === 'summary' ? (
            <section className="motion-once-delay-2 mb-4 rounded-xl border border-slate-200 p-3">
            <h2 className="mb-2 text-sm font-semibold">Rekap Benar/Salah Per Sub-Tes</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(scoreSummary.bySubTest).map(([code, item]) => {
                const active = selectedSubTestCode === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setSelectedSubTestCode(code)}
                    className={`subtest-card rounded-lg border p-3 text-left text-sm transition ${active ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                  >
                    <p className="font-semibold text-slate-800">{subTestNameMap[code] ?? code}</p>
                    <p className="text-slate-700">Benar: {item.correct}</p>
                    <p className="text-slate-700">Salah: {item.wrong}</p>
                    <p className="text-slate-700">Total: {item.total}</p>
                  </button>
                );
              })}
            </div>
            </section>
          ) : null}

          {resultTab === 'weak' ? (
            <section className="motion-once-delay-3 mb-4 rounded-xl border border-slate-200 p-3">
            <h2 className="mb-2 text-sm font-semibold">Materi Yang Perlu Diperbaiki {selectedSubTestCode ? `- ${subTestNameMap[selectedSubTestCode] ?? selectedSubTestCode}` : ''}</h2>
            {!weakMaterials.length ? (
              <p className="text-sm text-slate-600">Belum ada materi spesifik yang terdeteksi lemah. Lanjutkan latihan soal untuk memperkaya analisis.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {weakMaterials.map((item, idx) => (
                  <article key={`${item.subTestCode}-${item.materialTopic}-${idx}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p className="font-semibold text-amber-900">{item.materialTopic}</p>
                    <p className="text-xs text-amber-800">{item.subTestName}</p>
                    <p className="mt-1 text-amber-800">Salah: {item.wrong} dari {item.answered} jawaban</p>
                    <p className="text-xs text-amber-700">Akurasi: {Math.round((item.accuracy || 0) * 100)}%</p>
                  </article>
                ))}
              </div>
            )}
            </section>
          ) : null}

          {resultTab === 'review' ? (
            <section className="motion-once-delay-3 rounded-xl border border-slate-200 p-3">
            <h2 className="mb-2 text-sm font-semibold">Review Soal {selectedSubTestCode ? `- ${subTestNameMap[selectedSubTestCode] ?? selectedSubTestCode}` : ''}</h2>
            <div className="space-y-2">
              {paginatedReviewItems.map((item, idx) => {
                const open = openedDiscussion === item.attemptId;
                return (
                  <article key={item.attemptId} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-700">
                        Soal {(reviewPage - 1) * reviewPageSize + idx + 1} - {item.subTestName}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          item.isCorrect == null
                            ? 'bg-slate-100 text-slate-700'
                            : item.isCorrect
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {item.isCorrect == null ? 'Belum Dijawab' : item.isCorrect ? 'Benar' : 'Perlu Perbaikan'}
                      </span>
                    </div>
                    {item.materialTopic ? <p className="mt-1 text-xs text-slate-600">Materi: {item.materialTopic}</p> : null}
                    
                    {/* Render Image before Question Text */}
                    {(item.imageUrls?.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : [])).length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(item.imageUrls?.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : [])).map((imgUrl, imgIndex) => (
                          <button
                            key={`${item.attemptId}-img-${imgIndex}`}
                            type="button"
                            className="exam-img-thumb group relative overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                            onClick={() => openLightbox(imgUrl)}
                            aria-label={`Perbesar gambar ${imgIndex + 1}`}
                          >
                            <img
                              src={imgUrl}
                              alt={`Soal gambar ${imgIndex + 1}`}
                              className="exam-img-thumb-img block h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
                              loading="lazy"
                            />
                            <span className="exam-img-zoom-hint absolute inset-0 flex items-center justify-center rounded-md bg-slate-900/0 text-sm font-semibold text-white opacity-0 transition-all duration-200 group-hover:bg-slate-900/30 group-hover:opacity-100" aria-hidden="true">🔍 Perbesar</span>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-4"><RichTextRenderer content={item.questionText} /></div>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-700 sm:grid-cols-2">
                      <div className="rounded-md bg-slate-50 px-2 py-2 flex flex-wrap gap-1">
                        <span className="font-semiboldshrink-0">Jawaban Anda:</span>
                        <RichTextRenderer content={item.userAnswer} className="inline-block" />
                      </div>
                      <div className="rounded-md bg-teal-50 px-2 py-2 text-teal-800 flex flex-wrap gap-1">
                        <span className="font-semibold shrink-0">Jawaban Benar:</span>
                        <RichTextRenderer content={item.correctAnswer} className="inline-block" />
                      </div>
                    </div>
                    <button
                      className="mt-2 touch-target rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                      onClick={() => setOpenedDiscussion(open ? null : item.attemptId)}
                    >
                      {open ? 'Tutup Pembahasan' : 'Lihat Pembahasan'}
                    </button>
                    {open ? (
                      <div className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">
                        <RichTextRenderer content={item.discussion ?? ''} />
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {!paginatedReviewItems.length ? <p className="text-sm text-slate-600">Belum ada data jawaban untuk sub-tes ini.</p> : null}
              {filteredReviewItems.length ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <p className="text-xs text-slate-600">
                    Halaman {reviewPage} dari {reviewTotalPages} ({filteredReviewItems.length} soal)
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                      onClick={() => setReviewPage((prev) => Math.max(1, prev - 1))}
                      disabled={reviewPage <= 1}
                    >
                      Sebelumnya
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                      onClick={() => setReviewPage((prev) => Math.min(reviewTotalPages, prev + 1))}
                      disabled={reviewPage >= reviewTotalPages}
                    >
                      Berikutnya
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            </section>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell px-2 py-3 sm:px-3 md:px-4 lg:px-6 lg:py-6">
      {/* ── Lightbox / Image Popup ── */}
      {lightboxSrc ? (
        <div
          className="lightbox-overlay fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/80 p-3"
          onClick={closeLightbox}
          role="dialog"
          aria-modal="true"
          aria-label="Tampilan gambar diperbesar"
        >
          <div
            className="lightbox-panel relative flex max-h-[92dvh] max-w-[96vw] flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute -top-3 -right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-lg hover:bg-white"
              onClick={closeLightbox}
              aria-label="Tutup gambar"
            >
              ✕
            </button>
            <img
              src={lightboxSrc}
              alt="Tampilan gambar diperbesar"
              className="max-h-[88dvh] max-w-full rounded-xl object-contain shadow-2xl"
              draggable={false}
            />
            <p className="mt-2 text-xs text-white/70">Klik di luar atau tekan Esc untuk menutup</p>
          </div>
        </div>
      ) : null}
      {!sessionId && !resumeLoading ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4">
          <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Data Peserta dan Ketentuan Ujian</h2>
            <p className="mt-1 text-sm text-slate-700">
              Isi biodata berikut dan setujui ketentuan untuk memulai ujian.
            </p>

            <div className="mt-3 space-y-2">
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Nama lengkap"
                value={participantName}
                onChange={(e) => setParticipantName(e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Asal jemaat"
                value={participantCongregation}
                onChange={(e) => setParticipantCongregation(e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Sekolah asal"
                value={participantSchool}
                onChange={(e) => setParticipantSchool(e.target.value)}
              />
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">
                <input
                  className="mt-0.5"
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                />
                <span>
                  Saya menyetujui ketentuan ujian: dilarang membuka tab lain, dilarang mencontek, dan bersedia hasil ujian disimpan berdasarkan token akses dan biodata.
                </span>
              </label>
            </div>

            {onboardingError ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{onboardingError}</p> : null}

            <button
              type="button"
              className="mt-3 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={onboardingLoading}
              onClick={() => {
                void startSessionWithBiodata();
              }}
            >
              {onboardingLoading ? 'Memproses...' : 'Setuju dan Mulai Ujian'}
            </button>
          </section>
        </div>
      ) : null}

      <header className="sticky top-0 z-40 mb-3 border border-slate-200/80 bg-white/90 p-3 shadow-sm backdrop-blur sm:rounded-2xl">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <img src="/logo-ppgt.webp" alt="Logo PPGT" className="h-9 w-9 rounded-full border border-slate-200 bg-white object-cover" />
            <h1 className="text-sm font-semibold text-slate-900">Try Out SNBT 2026</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 lg:hidden"
              type="button"
              onClick={openNavSidebar}
            >
              ☰
            </button>
            <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={confirmLogout}>
              Keluar
            </button>
          </div>
        </div>
      </header>

      {isNavSidebarOpen ? (
        <div
          className={`fixed inset-0 z-50 bg-slate-900/40 lg:hidden ${isNavSidebarClosing ? 'sidebar-overlay-exit' : 'sidebar-overlay-enter'}`}
          onClick={closeNavSidebar}
        >
          <aside
            className={`h-full w-[84vw] max-w-sm overflow-y-auto bg-white p-4 shadow-xl ${isNavSidebarClosing ? 'sidebar-panel-exit' : 'sidebar-panel-enter'}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Navigasi Ujian</h2>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                onClick={closeNavSidebar}
              >
                Tutup
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">Section</p>
              <ol className="mt-2 space-y-2">
                {sections.map((section) => {
                  const active = section.order === activeSectionOrder;
                  const disabled = !canNavigateTo(section.order);
                  return (
                    <li key={section.code}>
                      <button
                        className={`w-full rounded-lg border px-2 py-2 text-left text-xs ${
                          active ? 'border-teal-600 bg-teal-100 text-teal-900' : 'border-slate-300 bg-white text-slate-600'
                        }`}
                        disabled={disabled || isBlocked}
                      >
                        {section.order}. {section.title}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">Nomor Soal ({answeredCount}/{questions.length} terjawab)</p>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {questions.map((q, idx) => {
                  const answered = isAnswered(q.id);
                  const active = activeQuestionId === q.id;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={`rounded-md border px-2 py-2 text-xs font-semibold ${answered ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-slate-300 bg-white text-slate-700'} ${active ? 'ring-2 ring-sky-300 ring-offset-1' : ''}`}
                      onClick={() => {
                        jumpToQuestion(q.id);
                        closeNavSidebar();
                      }}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {proctoringDialog ? (
        <div className="proctoring-overlay fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4">
          <section className="proctoring-panel w-full max-w-sm rounded-2xl border border-rose-200 bg-white p-5 shadow-xl sm:max-w-md">
            <div className="mb-3 flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-base font-bold text-rose-700" aria-hidden="true">⚠</span>
              <h2 className="mt-1 text-base font-semibold leading-snug text-slate-900">{proctoringDialog.title}</h2>
            </div>
            <p className="mb-5 whitespace-pre-line pl-12 text-sm leading-relaxed text-slate-600">{proctoringDialog.message}</p>
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
                onClick={closeDialog}
              >
                Mengerti
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {confirmModal ? (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          variant={confirmModal.variant}
          confirmLabel={confirmModal.confirmLabel}
          onConfirm={confirmModal.onConfirm}
          onCancel={closeConfirmModal}
        />
      ) : null}

      {preparingSectionOrder != null ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/50 p-4">
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">Persiapan Subtes Berikutnya</h2>
            <p className="mt-2 text-sm text-slate-700">Subtes berikutnya akan dimulai dalam:</p>
            <p className="mt-3 text-4xl font-bold text-teal-700">{prepCountdown}</p>
            <p className="mt-2 text-sm text-slate-600">Gunakan waktu ini untuk membaca instruksi dan menenangkan fokus.</p>
          </section>
        </div>
      ) : null}

      <section className="motion-once w-full rounded-2xl border border-slate-200 bg-white/85 p-2 shadow-sm backdrop-blur sm:p-3 md:p-4">
        <header className="static lg:sticky lg:top-[76px] z-10 mb-3 grid gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 sm:p-3 md:p-4">
          <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-2">
            <h1 className="text-sm font-semibold text-slate-900 sm:text-base lg:text-lg">Try Out SNBT 2026</h1>
            <p className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 sm:px-3 sm:py-1 sm:text-xs lg:text-sm">{subtitle}</p>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-[10px] leading-tight sm:grid-cols-3 sm:gap-2 sm:text-sm">
            <div className="flex flex-col items-center justify-center rounded-md bg-teal-50 p-1.5 text-center font-semibold text-accent sm:flex-row sm:justify-start sm:gap-1 sm:rounded-lg sm:p-2">
              <span>Sisa Waktu:</span>
              <span>{formatTime(activeSectionRemaining)}</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded-md bg-amber-50 p-1.5 text-center font-semibold text-warning sm:flex-row sm:justify-start sm:gap-1 sm:rounded-lg sm:p-2">
              <span className="hidden sm:inline">Peringatan</span> Anti-Cheat: <span>{warningCount}/6</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded-md bg-rose-50 p-1.5 text-center font-semibold text-danger sm:flex-row sm:justify-start sm:gap-1 sm:rounded-lg sm:p-2">
              {isForceSubmitting || isForceSubmitted ? 'Sedang force submit...' : <>Status: <span>Aktif</span></>}
            </div>
          </div>
        </header>

        <div className="exam-grid">
          <aside className="hidden rounded-xl border border-slate-200 bg-slate-50 p-3 lg:block">
            <h2 className="mb-2 text-sm font-semibold">Section</h2>
            <ol className="space-y-2">
              {sections.map((section) => {
                const active = section.order === activeSectionOrder;
                const disabled = !canNavigateTo(section.order);
                return (
                  <li key={section.code}>
                    <button
                      className={`touch-target w-full rounded-lg border px-2 py-2 text-left text-xs sm:text-sm ${
                        active ? 'border-teal-600 bg-teal-100 text-teal-900' : 'border-slate-300 bg-white text-slate-500'
                      }`}
                      disabled={disabled || isBlocked}
                    >
                      {section.order}. {section.title}
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-semibold sm:text-base">Soal Aktif</h2>
            <div className="space-y-3">
              {activeQuestion ? (
                <article key={activeQuestion.id} id={`question-${activeQuestion.id}`} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">
                    Soal {Math.max(1, questions.findIndex((q) => q.id === activeQuestion.id) + 1)} dari {questions.length}
                  </p>
                  {activeQuestion.isMathContent ? (
                    <p className="mt-1 inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                      Format matematika aktif
                    </p>
                  ) : null}
                  {/* Tampilkan gambar soal terlebih dahulu sesuai request urutan */}
                  {(activeQuestion.imageUrls?.length ? activeQuestion.imageUrls : (activeQuestion.imageUrl ? [activeQuestion.imageUrl] : [])).length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(activeQuestion.imageUrls?.length ? activeQuestion.imageUrls : (activeQuestion.imageUrl ? [activeQuestion.imageUrl] : [])).map((imageUrl, imageIndex) => (
                        <button
                          key={`${activeQuestion.id}-img-${imageIndex}`}
                          type="button"
                          className="exam-img-thumb group relative overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                          onClick={() => openLightbox(imageUrl)}
                          aria-label={`Perbesar gambar ${imageIndex + 1}`}
                        >
                          <img
                            src={imageUrl}
                            alt={`Soal gambar ${imageIndex + 1}`}
                            className="exam-img-thumb-img block h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
                            loading="lazy"
                          />
                          <span className="exam-img-zoom-hint absolute inset-0 flex items-center justify-center rounded-md bg-slate-900/0 text-sm font-semibold text-white opacity-0 transition-all duration-200 group-hover:bg-slate-900/30 group-hover:opacity-100" aria-hidden="true">🔍 Perbesar</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4">
                    <RichTextRenderer content={activeQuestion.promptText} />
                  </div>

                  {activeQuestion.answerFormat === 'SHORT_INPUT' ? (
                    <input
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={localAnswers[activeQuestion.id]?.shortAnswerText ?? activeQuestion.savedAnswer?.shortAnswerText ?? ''}
                      onChange={(e) => void onShortAnswer(activeQuestion.id, e.target.value)}
                      placeholder={activeQuestion.shortAnswerType === 'NUMERIC' ? 'Masukkan angka' : 'Masukkan jawaban singkat'}
                    />
                  ) : null}

                  {activeQuestion.answerFormat === 'MULTIPLE_CHOICE_SINGLE' ? (
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      {(['A', 'B', 'C', 'D', 'E'] as const).map((opt) => {
                        const selectedValue =
                          localAnswers[activeQuestion.id]?.selectedAnswer ??
                          activeQuestion.savedAnswer?.selectedAnswer ??
                          '';
                        const isSelected = selectedValue === opt;

                        return (
                          <button
                            key={opt}
                            className={`touch-target rounded-lg border px-3 py-2 text-left text-sm transition ${
                              isSelected
                                ? 'border-teal-700 bg-teal-50 text-teal-900 shadow-sm'
                                : 'border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                            }`}
                            onClick={() => void onSelectOption(activeQuestion.id, opt)}
                            disabled={isBlocked}
                          >
                            <div className="flex gap-2">
                              <span className="font-semibold shrink-0">{opt}.</span>
                              <div className="flex-1 w-0">
                                <RichTextRenderer content={activeQuestion.options?.[opt] ?? '-'} className="m-0" />
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {activeQuestion.answerFormat === 'MULTIPLE_CHOICE_COMPLEX' ? (
                    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-slate-700">Pernyataan</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-700">Jawaban</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(activeQuestion.complexStatements ?? []).map((statement, rowIndex) => {
                            const selectedAnswers =
                              (localAnswers[activeQuestion.id]?.selectedAnswers as string[] | undefined) ??
                              (activeQuestion.savedAnswer?.selectedAnswers as string[] | null) ??
                              [];
                            const selectedValue = selectedAnswers[rowIndex] ?? '';

                            return (
                              <tr key={`${activeQuestion.id}-statement-${rowIndex}`}>
                                <td className="px-3 py-2 align-top text-slate-800">{rowIndex + 1}. {statement}</td>
                                <td className="px-3 py-2">
                                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                                    <button
                                      type="button"
                                      className={`touch-target rounded-md border px-2 py-1.5 text-left ${
                                        selectedValue === 'LEFT' ? 'border-teal-700 bg-teal-50 text-teal-800' : 'border-slate-300 text-slate-700'
                                      }`}
                                      onClick={() => void onSetComplexRowAnswer(activeQuestion.id, rowIndex, 'LEFT')}
                                      disabled={isBlocked}
                                    >
                                      {activeQuestion.complexChoiceLabels?.left ?? 'Benar'}
                                    </button>
                                    <button
                                      type="button"
                                      className={`touch-target rounded-md border px-2 py-1.5 text-left ${
                                        selectedValue === 'RIGHT' ? 'border-teal-700 bg-teal-50 text-teal-800' : 'border-slate-300 text-slate-700'
                                      }`}
                                      onClick={() => void onSetComplexRowAnswer(activeQuestion.id, rowIndex, 'RIGHT')}
                                      disabled={isBlocked}
                                    >
                                      {activeQuestion.complexChoiceLabels?.right ?? 'Salah'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </article>
              ) : null}
              {!questions.length ? <p className="text-sm text-slate-600">Memuat soal section aktif...</p> : null}
            </div>
          </section>

          <aside className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <h2 className="mb-2 text-sm font-semibold">Kontrol</h2>
            <div className="mb-3 rounded-lg border border-slate-200 bg-white p-2">
              <p className="text-xs font-semibold text-slate-700">Nomor Soal ({answeredCount}/{questions.length})</p>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {questions.map((q, idx) => {
                  const answered = isAnswered(q.id);
                  const active = activeQuestionId === q.id;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={`rounded-md border px-1 py-1.5 text-xs font-semibold ${answered ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-slate-300 bg-white text-slate-700'} ${active ? 'ring-2 ring-sky-300 ring-offset-1' : ''}`}
                      onClick={() => jumpToQuestion(q.id)}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              className="touch-target mb-2 w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => void handleCompleteSectionEarly()}
              disabled={
                isBlocked ||
                isForceSubmitting ||
                !sessionId ||
                resultLoading ||
                earlyNextLoading ||
                preparingSectionOrder != null
              }
            >
              {earlyNextLoading
                ? 'Memindahkan ke subtes berikutnya...'
                : activeSectionOrder < sections.length
                  ? 'Selesaikan Subtes Ini Lebih Awal'
                  : 'Akhiri Subtes Terakhir Sekarang'}
            </button>
            <button
              className="touch-target mb-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void handleSubmitFinal()}
              disabled={isBlocked || isForceSubmitting || !sessionId || resultLoading || earlyNextLoading}
            >
              Selesaikan Ujian
            </button>
            {resultLoading ? <p className="mt-3 text-xs text-slate-600">Sedang menyiapkan hasil akhir...</p> : null}
            {isBlocked ? <p className="mt-3 rounded-lg bg-rose-100 p-2 text-xs text-rose-800">Batas pelanggaran terlampaui. Ujian dikunci otomatis.</p> : null}
          </aside>
        </div>
      </section>
    </main>
  );
}
