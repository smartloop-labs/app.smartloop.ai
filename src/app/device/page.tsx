'use client';

/**
 * Approve a device code sign-in (RFC 8628). An app with no browser of its
 * own here, like Docent Code over SSH, shows a code and this page; the
 * Smartloop agent it talks to polls the API, and gets its tokens once you
 * approve. They come straight to the agent: nothing reaches your terminal
 * from this browser.
 *
 * /device?code=BCDF-GHJK arrives with the code filled in; bare /device asks
 * for it. The page names the app asking, and the code is in your terminal
 * too: approving only when they match stops someone from getting you to sign
 * in their machine with a link of theirs.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, CircularProgress } from '@mui/material';
import AuthHeader from '@/app/components/auth-header';
import LoadingSpinner from '@/app/components/loading-spinner';
import { API_ENDPOINT } from '@/app/constants';
import { userService } from '@/app/services/user.service';

type State = 'loading' | 'enter' | 'looking' | 'ready' | 'deciding' | 'approved' | 'denied' | 'error';

const CODE_LETTERS = 8;

/** As typed: any case, with or without the dash or spaces. */
const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LETTERS);

/** BCDFGHJK → BCDF-GHJK, how codes are shown. */
const display = (code: string) => (code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/** The API's reason for a refusal, in words for this page. */
async function failure(r: Response): Promise<string> {
  const body = await r.json().catch(() => ({}));
  const detail = typeof body.detail === 'string' ? body.detail : '';
  if (r.status === 404) return 'That code is not valid or has expired. Start signing in again on your device.';
  if (r.status === 403 && detail.toLowerCase().includes('verif')) {
    return 'Verify your email address before signing in a device.';
  }
  if (r.status === 429) return 'Too many attempts. Wait a while and try again.';
  return detail || 'Something went wrong. Try again in a moment.';
}

function DeviceContent() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState(normalize(searchParams.get('code') ?? ''));
  const [typed, setTyped] = useState('');
  const [client, setClient] = useState('');
  const [state, setState] = useState<State>('loading');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  // Signed out: sign in first, then come back here with the same code.
  useEffect(() => {
    const back = code ? `/device?code=${encodeURIComponent(display(code))}` : '/device';
    const toLogin = () => {
      window.location.href = `/login?redirect=${encodeURIComponent(back)}`;
    };
    userService
      .get()
      .then((u: any) => {
        if (!u) return toLogin();
        setEmail(u.email ?? '');
        setState(code ? 'looking' : 'enter');
      })
      .catch(toLogin);
    // Only on arrival; a code typed here is looked up without signing in again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which app is asking, before anything is approved.
  const lookUp = useCallback(async (wanted: string) => {
    setState('looking');
    setError('');
    try {
      const r: Response | undefined = await userService.makeAuthenticatedRequest(
        `${API_ENDPOINT}/auth/device?code=${encodeURIComponent(wanted)}`,
      );
      if (!r) return; // session expired: makeAuthenticatedRequest sends you to /login
      if (!r.ok) {
        setError(await failure(r));
        setState('error');
        return;
      }
      const found = await r.json();
      setClient(found.client_name ?? found.client_id ?? 'An app');
      setState('ready');
    } catch {
      setError('Could not reach Smartloop. Try again in a moment.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (state === 'looking' && code) lookUp(code);
  }, [state, code, lookUp]);

  const decide = async (approve: boolean) => {
    setState('deciding');
    try {
      const r: Response | undefined = await userService.makeAuthenticatedRequest(`${API_ENDPOINT}/auth/device/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_code: code, approve }),
      });
      if (!r) return;
      if (r.ok) {
        setState(approve ? 'approved' : 'denied');
        return;
      }
      setError(await failure(r));
      setState('error');
    } catch {
      setError('Could not reach Smartloop. Try again in a moment.');
      setState('error');
    }
  };

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const wanted = normalize(typed);
    if (wanted.length !== CODE_LETTERS) return;
    setCode(wanted);
    window.history.replaceState(null, '', `/device?code=${display(wanted)}`);
    setState('looking');
  };

  if (state === 'loading' || state === 'looking') {
    return <LoadingSpinner showLogo message={state === 'loading' ? 'Checking your session...' : 'Looking up the code...'} size={48} />;
  }

  // Same card and controls as /login, so approving reads as part of signing in.
  const primaryButtonClass =
    'w-full flex items-center justify-center gap-2 py-4 rounded-lg font-medium transition-all '
    + 'bg-pink-500 text-white hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed '
    + 'disabled:hover:bg-pink-500';
  const secondaryButtonClass =
    'w-full flex items-center justify-center gap-2 py-4 rounded-lg font-medium transition-colors '
    + 'bg-surface hover:bg-surface-2 text-content border border-border-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const card = (children: React.ReactNode) => (
    <Box className="min-h-screen bg-bg flex flex-col">
      <AuthHeader />
      <Box className="flex-1 flex flex-col items-center px-6">
        <div className="flex-[2]" aria-hidden />
        <Box
          sx={{
            maxWidth: '460px',
            width: '100%',
            bgcolor: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
            borderRadius: '16px',
            padding: '40px',
          }}
        >
          {children}
        </Box>
        <div className="flex-[3]" aria-hidden />
      </Box>
    </Box>
  );

  const errorBox = state === 'error' && (
    <Box className="mb-4 p-3 bg-red-900 bg-opacity-20 border border-red-800 rounded-lg">
      <p className="text-red-400 text-sm">{error}</p>
    </Box>
  );

  if (state === 'approved') {
    return card(
      <>
        <h1 className="text-3xl font-normal text-content mb-2">{client} is signed in</h1>
        <p className="text-sm text-muted">
          {email ? <>It&apos;s signed in as <span className="text-content">{email}</span>. </> : null}
          Head back to it; you can close this tab.
        </p>
      </>
    );
  }

  if (state === 'denied') {
    return card(
      <>
        <h1 className="text-3xl font-normal text-content mb-2">Sign-in denied</h1>
        <p className="text-sm text-muted">Nothing was signed in. You can close this tab.</p>
      </>
    );
  }

  // No code yet (or a bad one): type the one the device shows.
  if (state === 'enter' || (state === 'error' && !client)) {
    return card(
      <form onSubmit={submitTyped}>
        <h1 className="text-3xl font-normal text-content mb-2">Sign in a device</h1>
        <p className="text-sm text-muted mb-8">Enter the code your device shows.</p>

        <input
          value={display(normalize(typed))}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="BCDF-GHJK"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          aria-label="Device code"
          className="w-full h-[56px] mb-4 rounded-lg text-center text-xl font-medium font-mono tracking-widest bg-surface text-content border border-border-2 outline-none transition-colors focus:border-pink-500"
        />

        {errorBox}

        <button type="submit" disabled={normalize(typed).length !== CODE_LETTERS} className={primaryButtonClass}>
          Continue
        </button>
      </form>
    );
  }

  // The code in the same boxes /login uses for emailed codes, dash between groups.
  const boxes = (group: string) =>
    Array.from(group).map((ch, i) => (
      <span
        key={i}
        className="w-[48px] h-[56px] flex items-center justify-center rounded-lg text-xl font-medium font-mono bg-surface text-content border border-border-2"
      >
        {ch}
      </span>
    ));

  return card(
    <>
      <h1 className="text-3xl font-normal text-content mb-2">Sign in to {client}</h1>
      <p className="text-sm text-muted mb-8">
        Approve only if {client} shows this code
        {email && <> and you meant to sign it in as <span className="text-content">{email}</span></>}.
      </p>

      <Box className="flex justify-center items-center gap-2 mb-6" aria-label={`Sign-in code ${display(code)}`}>
        {boxes(code.slice(0, 4))}
        <span className="text-muted text-xl" aria-hidden>–</span>
        {boxes(code.slice(4))}
      </Box>

      {errorBox}

      <button type="button" onClick={() => decide(true)} disabled={state === 'deciding'} className={`${primaryButtonClass} mb-3`}>
        {state === 'deciding' && <CircularProgress size={18} sx={{ color: 'inherit' }} />}
        Approve
      </button>
      <button type="button" onClick={() => decide(false)} disabled={state === 'deciding'} className={`${secondaryButtonClass} mb-6`}>
        Deny
      </button>

      <Box className="text-center">
        <p className="text-sm text-muted">
          Didn&apos;t start signing in? Deny it; nothing is signed in.
        </p>
      </Box>
    </>
  );
}

export default function Device() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <DeviceContent />
    </Suspense>
  );
}
