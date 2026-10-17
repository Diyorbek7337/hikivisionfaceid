'use client';
import { useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';

/** Live query results: [rows, loading, error]. `makeQuery` returns a Firestore query or null. */
export function useLiveQuery(makeQuery, deps) {
  const [state, setState] = useState({ rows: [], loading: true, error: null });
  useEffect(() => {
    const q = makeQuery();
    if (!q) { setState({ rows: [], loading: false, error: null }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(q,
      (snap) => setState({ rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false, error: null }),
      (error) => setState({ rows: [], loading: false, error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [state.rows, state.loading, state.error];
}

/** Live single document: [data|null, loading]. */
export function useLiveDoc(makeRef, deps) {
  const [state, setState] = useState({ data: null, loading: true });
  useEffect(() => {
    const ref = makeRef();
    if (!ref) { setState({ data: null, loading: false }); return undefined; }
    return onSnapshot(ref,
      (doc) => setState({ data: doc.exists() ? { id: doc.id, ...doc.data() } : null, loading: false }),
      () => setState({ data: null, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [state.data, state.loading];
}
