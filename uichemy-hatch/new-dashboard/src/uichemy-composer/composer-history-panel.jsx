// History panel (Phase 2) — a lightweight floating card listing the session's
// undo snapshots for the active widget, newest first. Clicking a row jumps the
// document to that point (like an undo/redo straight to it). Session-only; DB
// persistence + cross-user attribution is a later phase.
import React from 'react';
import ReactDOM from 'react-dom';
import { cn } from '@/lib/utils';
import { I } from './composer-icons';

function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  // No live seconds ticker — under a minute reads "just now", then minutes/hours.
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

/**
 * History rows only (no card/portal) — dropped into the Layers popup's History
 * tab. Uses the composer's own design-system classes so it matches the panel.
 *
 * @param {Array}    entries  from getHistory().entries (newest first)
 * @param {function} onJump   (absoluteIndex) => void
 */
export function HistoryList({ entries, onJump }) {
  return (
    <div className="layers-history-list" style={{ padding: '4px 0' }}>
      {(!entries || entries.length === 0) && (
        <div className="layers-empty" style={{ padding: '16px 12px', textAlign: 'center' }}>No changes yet.</div>
      )}
      {entries && entries.map((e) => {
        // `restorable` defaults to true (undefined = old callers / active scope).
        const canRestore = e.restorable !== false;
        return (
          <button
            key={(e.scope || '') + ':' + e.i}
            type="button"
            className={cn('layers-history-row', e.isCurrent && 'is-current', !canRestore && 'is-viewonly')}
            onClick={canRestore ? () => onJump(e.scope, e.i) : undefined}
            disabled={!canRestore}
            title={canRestore
              ? (e.isCurrent ? 'Current state' : 'Restore to this point')
              : 'Select this element on the canvas to restore its history'}
          >
            <span className={cn('lh-dot', e.isCurrent && 'is-current')} aria-hidden="true" />
            <span className="lh-body">
              <span className="lh-label">
                {e.scopeTag ? <span className="lh-scope">{e.scopeTag}</span> : null}
                {e.label}
              </span>
              <span className="lh-meta">{(e.who ? e.who + ' · ' : '') + timeAgo(e.time)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * @param {object}   props
 * @param {Array}    props.entries  from getHistory().entries (newest first)
 * @param {function} props.onJump   (absoluteIndex) => void
 * @param {function} props.onClose
 * @param {Document} props.portalDoc
 * @param {string}   props.theme    'dark' | 'light'
 */
export function FloatingHistory({ entries, onJump, onClose, portalDoc, theme }) {
  const doc = portalDoc || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;
  const dark = theme === 'dark';
  const panelBg = dark ? '#1c1d21' : '#ffffff';
  const border = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
  const text = dark ? '#e7e7ea' : '#1a1a1a';
  const sub = dark ? 'rgba(231,231,234,0.55)' : 'rgba(0,0,0,0.5)';
  const curBg = dark ? 'rgba(236,8,104,0.22)' : 'rgba(236,8,104,0.12)';
  const rowHover = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  return ReactDOM.createPortal(
    <div
      className="uich-tw"
      style={{
        position: 'fixed', right: '16px', bottom: '84px', width: '260px', maxHeight: '340px',
        display: 'flex', flexDirection: 'column', background: panelBg, color: text,
        border: `1px solid ${border}`, borderRadius: '10px', zIndex: 2147483000,
        boxShadow: '0 12px 34px -8px rgba(0,0,0,0.45)', overflow: 'hidden',
        font: '13px/1.4 ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${border}` }}>
        <I.history size={14} />
        <span style={{ fontWeight: 600, flex: 1 }}>History</span>
        <button
          type="button" aria-label="Close history" onClick={onClose}
          style={{ border: 0, background: 'transparent', color: sub, cursor: 'pointer', display: 'inline-flex', padding: 2 }}
        >
          <I.x size={14} />
        </button>
      </div>
      <div style={{ overflowY: 'auto', padding: '4px 0' }}>
        {(!entries || entries.length === 0) && (
          <div style={{ padding: '16px 12px', color: sub, textAlign: 'center' }}>No changes yet.</div>
        )}
        {entries && entries.map((e) => (
          <button
            key={e.i}
            type="button"
            onClick={() => onJump(e.i)}
            title={e.isCurrent ? 'Current state' : 'Restore to this point'}
            style={{
              display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', textAlign: 'left',
              padding: '7px 12px', border: 0, cursor: 'pointer', color: text,
              background: e.isCurrent ? curBg : 'transparent',
            }}
            onMouseEnter={(ev) => { if (!e.isCurrent) ev.currentTarget.style.background = rowHover; }}
            onMouseLeave={(ev) => { if (!e.isCurrent) ev.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', flex: '0 0 auto', marginTop: 5, background: e.isCurrent ? '#EC0868' : (dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.25)') }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: e.isCurrent ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
              <span style={{ display: 'block', color: sub, fontSize: 11 }}>
                {(e.who ? e.who + ' · ' : '') + timeAgo(e.time)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>,
    doc.body || doc.documentElement,
  );
}
