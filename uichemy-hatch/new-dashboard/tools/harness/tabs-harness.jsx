// Renders the REAL Tabs primitive in both variants, plus the exact markup
// composer-app's modeSwitch now uses, inside the panel's own classes.
import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '../../src/uichemy-composer/components/ui/tabs';
import { I as T } from '../../src/uichemy-composer/composer-icons';

function ModeSwitch({ mode, setMode }) {
  return (
    <Tabs value={mode} onValueChange={(v) => v && setMode(v)}>
      <TabsList variant="line" className="mode-switch h-auto gap-3" aria-label="Editing mode">
        <TabsTrigger value="simple" className="gap-1.5 text-xs font-semibold"><T.design size={12} />Design</TabsTrigger>
        <TabsTrigger value="pro" className="gap-1.5 text-xs font-semibold"><T.code size={12} />Developer</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function App() {
  const [mode, setMode] = React.useState('simple');
  const [t2, setT2] = React.useState('overview');
  return (
    <div className="panel dock-right" data-theme="dark" style={{ padding: 0 }}>
      <div className="panel-mode-row" style={{ padding: '10px 16px 2px' }}>
        <ModeSwitch mode={mode} setMode={setMode} />
      </div>
      <div style={{ padding: '18px 16px', borderTop: '1px solid var(--panel-line)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-hi)' }}>Content</div>
      </div>
      <div style={{ padding: '18px 16px' }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>variant="line" — the snippet's own example</div>
        <Tabs value={t2} onValueChange={setT2}>
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
        </Tabs>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', margin: '22px 0 8px' }}>variant="pill" — unchanged default</div>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}

const mount = document.getElementById('root');
mount.className = 'uich-composer-host uich-tw dark';
mount.dataset.theme = 'dark';
window.wp.element.createRoot(mount).render(<App />);
