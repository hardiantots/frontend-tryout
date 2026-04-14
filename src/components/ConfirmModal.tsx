import { useEffect, useRef } from 'react';

type ModalVariant = 'info' | 'warning' | 'danger';

type ConfirmModalProps = {
  title: string;
  message: string;
  variant?: ModalVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  /** If undefined, only a single "OK" button is shown (alert mode). */
  onConfirm?: () => void;
  onCancel: () => void;
};

const variantStyles: Record<ModalVariant, { icon: string; iconBg: string; confirmBtn: string }> = {
  info: {
    icon: 'ℹ',
    iconBg: 'bg-sky-100 text-sky-700',
    confirmBtn: 'bg-slate-900 text-white hover:bg-slate-700',
  },
  warning: {
    icon: '⚠',
    iconBg: 'bg-amber-100 text-amber-700',
    confirmBtn: 'bg-amber-600 text-white hover:bg-amber-700',
  },
  danger: {
    icon: '⚠',
    iconBg: 'bg-rose-100 text-rose-700',
    confirmBtn: 'bg-rose-600 text-white hover:bg-rose-700',
  },
};

export function ConfirmModal({
  title,
  message,
  variant = 'info',
  confirmLabel = 'Ya, Lanjutkan',
  cancelLabel = 'Batal',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const styles = variantStyles[variant];
  const isAlertMode = onConfirm == null;

  // Auto-focus the primary action button on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isAlertMode) {
        cancelBtnRef.current?.focus();
      } else {
        cancelBtnRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isAlertMode]);

  // Trap Escape key to cancel
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div
      className="proctoring-overlay fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={onCancel}
    >
      <section
        className="proctoring-panel w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon + Title */}
        <div className="mb-3 flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ${styles.iconBg}`}
            aria-hidden="true"
          >
            {styles.icon}
          </span>
          <h2
            id="confirm-modal-title"
            className="mt-1 text-base font-semibold leading-snug text-slate-900"
          >
            {title}
          </h2>
        </div>

        {/* Message */}
        <p className="mb-5 whitespace-pre-line pl-12 text-sm leading-relaxed text-slate-600">
          {message}
        </p>

        {/* Actions */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelBtnRef}
            type="button"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto"
            onClick={onCancel}
          >
            {isAlertMode ? 'OK' : cancelLabel}
          </button>
          {!isAlertMode && (
            <button
              ref={confirmBtnRef}
              type="button"
              className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:w-auto ${styles.confirmBtn}`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
