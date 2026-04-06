import { FormEvent, useEffect, useState } from 'react';
import { forgotPassword, login, participantTokenLogin, resetPassword, validateParticipantToken } from '../auth/api';
import { getSession, getSessionRoleLanding } from '../auth/session';
import { useExamStore } from '../store/examStore';

type AuthPageProps = {
  onAuthenticated: (landing: 'exam' | 'admin') => void;
};

type AuthMode = 'participant-login' | 'admin-login' | 'forgot' | 'reset';

export function AuthPage({ onAuthenticated }: AuthPageProps) {
  const searchParams = new URLSearchParams(window.location.search);
  const resetTokenFromUrl = searchParams.get('token') ?? searchParams.get('resetToken') ?? '';
  const isResetRoute = window.location.pathname.toLowerCase().includes('/reset-password');

  const [mode, setMode] = useState<AuthMode>(resetTokenFromUrl ? 'reset' : 'participant-login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [participantToken, setParticipantToken] = useState('');
  const [participantTokenStatus, setParticipantTokenStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [participantTokenHint, setParticipantTokenHint] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [successModal, setSuccessModal] = useState<{ title: string; description: string; actionLabel: string } | null>(null);

  const backToSignIn = () => {
    setMode('participant-login');
    setSuccessModal(null);
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    const cleanUrl = `${window.location.origin}/`;
    window.history.replaceState({}, '', cleanUrl);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (mode === 'forgot') {
        const result = await forgotPassword(email);
        setSuccessModal({
          title: 'Link Reset Terkirim',
          description: result?.message ?? 'Jika email terdaftar, link reset password sudah dikirim.',
          actionLabel: 'Kembali ke Login',
        });
        return;
      }

      if (mode === 'reset') {
        if (!resetTokenFromUrl) {
          throw new Error('Token reset tidak ditemukan pada URL.');
        }
        if (newPassword !== confirmPassword) {
          throw new Error('Konfirmasi password tidak sama.');
        }

        await resetPassword(resetTokenFromUrl, newPassword);
        setSuccessModal({
          title: 'Password Berhasil Diubah',
          description: 'Silakan login kembali menggunakan password baru.',
          actionLabel: 'Lanjut ke Login',
        });
        return;
      }

      const me =
        mode === 'admin-login'
          ? await login({ email, password })
          : await participantTokenLogin({ token: participantToken });

      // Handle re-login abuse: if exam was auto-completed due to exceeding login limit,
      // mark the exam store so ExamPage goes straight to results.
      if ('examAutoCompleted' in me && me.examAutoCompleted) {
        useExamStore.getState().forceSubmit();
      }

      const landing = getSessionRoleLanding(me.roles ?? ['PARTICIPANT']);
      onAuthenticated(landing);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const restoreExisting = () => {
    const current = getSession();
    if (!current) {
      return;
    }
    const landing = getSessionRoleLanding(current.roles ?? ['PARTICIPANT']);
    onAuthenticated(landing);
  };

  useEffect(() => {
    if (mode !== 'participant-login') {
      setParticipantTokenStatus('idle');
      setParticipantTokenHint('');
      return;
    }

    const trimmed = participantToken.trim();
    if (!trimmed) {
      setParticipantTokenStatus('idle');
      setParticipantTokenHint('');
      return;
    }

    if (trimmed.length < 6) {
      setParticipantTokenStatus('invalid');
      setParticipantTokenHint('Token minimal 6 karakter.');
      return;
    }

    setParticipantTokenStatus('checking');
    const timer = window.setTimeout(() => {
      void validateParticipantToken({ token: trimmed })
        .then((result) => {
          setParticipantTokenStatus(result.valid ? 'valid' : 'invalid');
          setParticipantTokenHint(result.message);
        })
        .catch(() => {
          setParticipantTokenStatus('invalid');
          setParticipantTokenHint('Tidak dapat memvalidasi token saat ini.');
        });
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [mode, participantToken]);

  return (
    <main className="app-shell">
      {successModal ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4">
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">{successModal.title}</h2>
            <p className="mt-2 text-sm text-slate-700">{successModal.description}</p>
            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
              onClick={backToSignIn}
            >
              {successModal.actionLabel}
            </button>
          </section>
        </div>
      ) : null}

      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <img src="/logo-ppgt.webp" alt="Logo PPGT" className="h-10 w-10 rounded-full border border-slate-200 bg-white object-cover" />
            <div>
              <h1 className="text-sm font-semibold tracking-wide text-slate-900">Platform Try Out SNBT</h1>
              <p className="text-xs text-slate-600">Akses Participant dan Admin</p>
            </div>
          </div>
          <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 sm:inline-flex">
            Secure Access
          </span>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-10">
        <aside className="rounded-3xl border border-slate-200/70 bg-white/75 p-6 shadow-lg shadow-slate-300/20 backdrop-blur sm:p-8">
          <p className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Sistem Ujian Adaptif
          </p>
          <h2 className="mt-4 text-2xl font-semibold leading-tight text-slate-900 sm:text-3xl">
            Participant login via token dan admin login via email.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            Token participant dibuat oleh master admin. Setiap token dipantau status penggunaannya dan dapat dinonaktifkan sewaktu-waktu.
          </p>
        </aside>

        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-300/20 sm:p-7">
          <h2 className="text-xl font-semibold text-slate-900">SNBT Try Out</h2>
          <p className="mt-1 text-sm text-slate-600">Pilih jenis login sesuai peran.</p>

          <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1.5 text-sm font-medium">
            <button
              type="button"
              onClick={() => setMode('participant-login')}
              className={`rounded-lg px-3 py-2.5 transition ${mode === 'participant-login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Participant (Token)
            </button>
            <button
              type="button"
              onClick={() => setMode('admin-login')}
              className={`rounded-lg px-3 py-2.5 transition ${mode === 'admin-login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Admin
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <button
              type="button"
              onClick={() => setMode('forgot')}
              className={`rounded-lg px-3 py-2.5 font-semibold transition ${mode === 'forgot' ? 'bg-rose-600 text-white shadow-sm shadow-rose-200' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
            >
              Lupa Password
            </button>
            {resetTokenFromUrl ? (
              <button
                type="button"
                onClick={() => setMode('reset')}
                className={`rounded-lg px-3 py-2.5 font-semibold transition ${mode === 'reset' ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                Reset Password
              </button>
            ) : (
              <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-center text-slate-500">-</div>
            )}
          </div>

          {isResetRoute && !resetTokenFromUrl ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Link reset tidak valid atau token tidak ditemukan. Silakan kirim ulang dari menu Lupa Password.
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
            {mode === 'participant-login' ? (
              <>
                <input
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  placeholder="Masukkan token participant"
                  value={participantToken}
                  onChange={(e) => setParticipantToken(e.target.value)}
                  required
                />
                <p className="text-xs text-slate-500">
                  Gunakan token unik yang diberikan master admin (format pendek 6-7 karakter).
                </p>
                {participantTokenStatus !== 'idle' ? (
                  <div
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                      participantTokenStatus === 'valid'
                        ? 'bg-emerald-100 text-emerald-700'
                        : participantTokenStatus === 'checking'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {participantTokenStatus === 'valid'
                      ? 'Valid'
                      : participantTokenStatus === 'checking'
                        ? 'Checking...'
                        : 'Invalid'}
                  </div>
                ) : null}
                {participantTokenHint ? <p className="text-xs text-slate-500">{participantTokenHint}</p> : null}
              </>
            ) : null}

            {mode === 'admin-login' || mode === 'forgot' ? (
              <input
                className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="email"
                placeholder="Email admin"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            ) : null}

            {mode === 'admin-login' ? (
              <input
                className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            ) : null}

            {mode === 'reset' ? (
              <>
                <input
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  type="password"
                  placeholder="Password baru"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
                <input
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  type="password"
                  placeholder="Konfirmasi password baru"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </>
            ) : null}

            <button
              className="w-full rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={loading}
            >
              {loading
                ? 'Memproses...'
                : mode === 'participant-login'
                  ? 'Masuk Dengan Token'
                  : mode === 'admin-login'
                    ? 'Masuk Admin'
                    : mode === 'forgot'
                      ? 'Kirim Link Reset'
                      : 'Ubah Password'}
            </button>
          </form>

          {message ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p> : null}

          <button
            type="button"
            onClick={restoreExisting}
            className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Gunakan session yang masih aktif
          </button>
        </article>
      </section>
    </main>
  );
}
