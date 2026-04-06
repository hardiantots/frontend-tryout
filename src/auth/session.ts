export type AuthUserProfile = {
  id: string;
  fullName: string;
  email: string;
};

export type SessionData = {
  accessToken: string;
  refreshToken: string;
  roles: string[];
  user: AuthUserProfile;
  expiresAt: number;
};

const SESSION_KEY = 'auth.session.v1';
const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';
const EXAM_RUNTIME_KEY = 'exam.runtime.v1';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function saveSession(payload: {
  accessToken: string;
  refreshToken: string;
  roles: string[];
  user: AuthUserProfile;
}) {
  // Prevent old participant runtime from leaking into a fresh login.
  window.localStorage.removeItem(EXAM_RUNTIME_KEY);

  const value: SessionData = {
    ...payload,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  window.localStorage.setItem(ACCESS_TOKEN_KEY, payload.accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
}

export function getSession(): SessionData | null {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SessionData;
    if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.expiresAt) {
      clearSession();
      return null;
    }

    if (Date.now() > parsed.expiresAt) {
      clearSession();
      return null;
    }

    return parsed;
  } catch {
    clearSession();
    return null;
  }
}

export function updateAccessToken(accessToken: string) {
  const current = getSession();
  if (!current) {
    return;
  }

  const next: SessionData = {
    ...current,
    accessToken,
  };

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
}

export function updateTokens(accessToken: string, refreshToken: string) {
  const current = getSession();
  if (!current) {
    return;
  }

  const next: SessionData = {
    ...current,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(EXAM_RUNTIME_KEY);
}

export function getAccessToken() {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getSessionRoleLanding(roles: string[]): 'exam' | 'admin' {
  const normalized = roles.map((r) => r.toUpperCase());
  if (normalized.includes('MASTER_ADMIN') || normalized.includes('ADMIN')) {
    return 'admin';
  }
  return 'exam';
}
