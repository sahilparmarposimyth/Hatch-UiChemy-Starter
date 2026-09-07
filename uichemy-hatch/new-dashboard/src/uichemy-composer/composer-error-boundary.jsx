// Panel-level error boundary. Without it, a render error anywhere in the
// composer unmounts the whole React tree and the shell shows only its dark
// background, the "black panel". This catches the error, keeps the panel
// usable, shows a readable message, and surfaces the cause for debugging.
import React from 'react';

export class ComposerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Loud, greppable log so the exact stack is visible in the editor console.
    // eslint-disable-next-line no-console
    console.error(`[Composer Composer] render error${this.props.label ? ` in ${this.props.label}` : ''}:`, error, info);
    this.setState({ info });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // `silent` — for children that render into the CANVAS rather than the panel
    // (the on-canvas toolbar's portals). The card below is sized for the panel
    // body; drawn over the canvas it is worse than nothing. The console.error in
    // componentDidCatch still fires, so the failure is not hidden, only unstyled
    // chrome is withheld. This is what keeps one broken canvas widget from
    // costing the whole Inspector — the same rule composer-pick's guard() states
    // for the selection overlay: a broken decoration must cost the decoration.
    if (this.props.silent) return null;

    const wrap = {
      boxSizing: 'border-box',
      height: '100%',
      minHeight: 0,
      overflow: 'auto',
      padding: '18px 16px',
      background: '#15161a',
      color: '#d6d7dc',
      font: "13px/1.5 'Plus Jakarta Sans', system-ui, sans-serif",
    };
    const title = { margin: '0 0 6px', fontSize: '14px', fontWeight: 700, color: '#f4f5f7' };
    const sub = { margin: '0 0 14px', color: '#9a9ca6' };
    const pre = {
      margin: 0,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: '11.5px',
      color: '#ff9a9a',
      background: '#1c1d22',
      border: '1px solid #2a2c33',
      borderRadius: '10px',
      padding: '10px 12px',
    };
    const btn = {
      marginTop: '14px',
      appearance: 'none',
      cursor: 'pointer',
      border: '1px solid #34363f',
      borderRadius: '10px',
      background: '#24262c',
      color: '#f4f5f7',
      font: "inherit",
      fontWeight: 600,
      padding: '8px 14px',
    };
    const stackLine = (error.stack || '').split('\n').slice(0, 4).join('\n');

    return (
      <div style={wrap} className="uich-tw">
        <p style={title}>{this.props.label ? `The ${this.props.label} hit an error` : 'The composer hit an error'}</p>
        <p style={sub}>The panel recovered instead of going blank. Details below, share them and it can be fixed fast.</p>
        <pre style={pre}>{String(error && error.message ? error.message : error)}{stackLine ? '\n\n' + stackLine : ''}</pre>
        <button style={btn} onClick={() => { try { window.location.reload(); } catch (_) {} }}>
          Reload editor
        </button>
      </div>
    );
  }
}
