'use client';
import { useEffect } from 'react';
import { useEditor } from './editor';

/** Registered by the 3D viewport so saves can attach a small thumbnail. */
export const thumbnailProvider: { current: null | (() => string | null) } = { current: null };

/** A thumbnail the user picked explicitly (Set thumbnail); used by the next save. */
export const thumbnailOverride: { current: string | null } = { current: null };

let inflight: Promise<boolean> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 4000;
let savesSinceThumb = 99;

const draftKey = (id: string) => `nivas:draft:${id}`;

export function writeDraft() {
  const s = useEditor.getState();
  if (!s.projectId) return;
  try {
    localStorage.setItem(draftKey(s.projectId), JSON.stringify({ doc: s.doc, baseVersion: s.baseVersion, ts: Date.now() }));
  } catch {
    /* storage full or unavailable - the server save is still the source of truth */
  }
}

export function clearDraft(id: string) {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    /* ignore */
  }
}

export function readDraft(id: string): { doc: unknown; baseVersion: number; ts: number } | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Saves the current document. The status only becomes "saved" after the server has confirmed that the
 * new version is committed; on any failure the document stays dirty (and a local draft is kept).
 */
export function saveNow(opts: { manual?: boolean; label?: string } = {}): Promise<boolean> {
  if (inflight) return inflight;
  const s = useEditor.getState();
  if (!s.projectId || s.access === 'VIEW') return Promise.resolve(false);
  if (s.saveStatus === 'conflict') {
    s.toast('error', 'Reload the project before saving - it was changed elsewhere.');
    return Promise.resolve(false);
  }
  if (s.saveStatus === 'saved' && !opts.manual) return Promise.resolve(true);
  const doc = s.doc;
  const id = s.projectId;
  s.markSaving();
  writeDraft();
  let thumbnail: string | null | undefined;
  if (opts.manual || savesSinceThumb >= 4) {
    try {
      thumbnail = thumbnailOverride.current ?? thumbnailProvider.current?.() ?? undefined;
      thumbnailOverride.current = null;
    } catch {
      thumbnail = undefined;
    }
    savesSinceThumb = 0;
  } else savesSinceThumb++;
  inflight = (async () => {
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: doc, baseVersion: s.baseVersion, thumbnail, revisionLabel: opts.manual ? (opts.label ?? 'Manual save') : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(body.details) ? ` ${body.details.slice(0, 3).join('; ')}` : '';
        if (res.status === 409) {
          useEditor.getState().markSaveFailed('conflict', body.error ?? 'Version conflict.');
          return false;
        }
        if (res.status === 401) {
          useEditor.getState().markSaveFailed('error', 'Your session expired. Sign in again in another tab; your work is kept here.');
          return false;
        }
        throw new Error((body.error ?? `Server error ${res.status}`) + detail);
      }
      useEditor.getState().markSaved(body.version, body.updatedAt, doc);
      retryDelay = 4000;
      if (useEditor.getState().saveStatus === 'saved') clearDraft(id);
      if (opts.manual) useEditor.getState().toast('success', 'Saved.');
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      useEditor.getState().markSaveFailed('error', `${msg}. Your changes are still in this browser and will be retried.`);
      if (opts.manual) useEditor.getState().toast('error', `Save failed: ${msg}`);
      scheduleRetry();
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (useEditor.getState().saveStatus === 'error') saveNow();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60_000);
}

/** Debounced autosave + local draft backup + unload protection. Mount once in the editor. */
export function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let draftTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.doc !== prev.doc && !s.tx && s.saveStatus === 'dirty') {
        if (draftTimer) clearTimeout(draftTimer);
        draftTimer = setTimeout(writeDraft, 400);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => saveNow(), 1500);
      }
    });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      const st = useEditor.getState().saveStatus;
      if (st === 'dirty' || st === 'saving' || st === 'error') {
        writeDraft();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
      if (draftTimer) clearTimeout(draftTimer);
      window.removeEventListener('beforeunload', beforeUnload);
      // flush on unmount (navigating to another section)
      const st = useEditor.getState();
      if (st.saveStatus === 'dirty' || st.saveStatus === 'error') {
        writeDraft();
        saveNow();
      }
    };
  }, []);
}
