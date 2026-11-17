import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';

export interface DbUserProfile {
  id: number;
  uid: string;
  email: string;
  displayName: string | null;
  role: string;
}

interface AuthContextValue {
  firebaseUser: User | null;
  dbUser: DbUserProfile | null;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<DbUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const syncUserWithBackend = useCallback(async (user: User) => {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { user: DbUserProfile };
        setDbUser(data.user);
      }
    } catch {
      // Non-fatal: user remains signed in with Firebase
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await syncUserWithBackend(user);
      } else {
        setDbUser(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [syncUserWithBackend]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      await syncUserWithBackend(cred.user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setAuthError(msg);
    }
  }, [syncUserWithBackend]);

  const logout = useCallback(async () => {
    await signOut(auth);
    setDbUser(null);
  }, []);

  const authFetch = useCallback(
    async (input: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers || {});
      if (firebaseUser) {
        const token = await firebaseUser.getIdToken();
        headers.set('Authorization', `Bearer ${token}`);
      }
      if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      return fetch(input, { ...init, headers });
    },
    [firebaseUser]
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        dbUser,
        loading,
        authError,
        signInWithGoogle,
        logout,
        authFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
