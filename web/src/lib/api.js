'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/** Calls the local server API. Throws ApiError with a readable (Uzbek) message. */
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Server bilan aloqa yo\'q. Server kompyuteri yoqilganmi?', 0);
  }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (res.status === 401 && !['/session', '/login', '/setup'].includes(path)) {
    window.dispatchEvent(new Event('davomat:unauthorized'));
  }
  if (!res.ok) throw new ApiError((data && data.error) || `Xato (HTTP ${res.status})`, res.status);
  return data;
}

/** GET with optional auto refresh: { data, error, loading, reload } */
export function useApi(path, { refreshMs = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api(path);
      if (alive.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    setState((s) => ({ ...s, loading: true }));
    load();
    let timer;
    if (refreshMs) {
      timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, refreshMs);
    }
    return () => { alive.current = false; clearInterval(timer); };
  }, [load, refreshMs]);

  return { ...state, reload: load };
}

export const faceUrl = (e) => `/api/employees/${e.id}/face.jpg?v=${e.version}`;
