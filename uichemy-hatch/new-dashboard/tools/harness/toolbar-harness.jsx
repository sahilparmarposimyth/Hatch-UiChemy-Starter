// Runs the REAL CanvasToolbarContent so the tooltips and the dock
// magnification are the actual shipping code, not a redraw.
import React from 'react';
import { CanvasToolbarContent } from '../../src/uichemy-composer/composer-toolbar';

function App() {
  const [picking, setPicking] = React.useState(false);
  const [outline, setOutline] = React.useState(false);
  // Matches the product: composer-app starts with layersHidden = true, so the
  // Layers button is OFF until the user turns it on.
  const [layers, setLayers] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <CanvasToolbarContent
      picking={picking} onTogglePick={() => setPicking(v => !v)}
      outlineOn={outline} onToggleOutline={() => setOutline(v => !v)}
      layersOn={layers} onToggleLayers={() => setLayers(v => !v)}
      onDraw={() => {}} drawActive={false}
      panelCollapsed={collapsed} onToggleCollapse={() => setCollapsed(v => !v)}
      proLocked={false}
    />
  );
}

const mount = document.getElementById('root');
mount.className = 'uich-composer-host uich-tw dark uich-canvas-toolbar-host';
mount.dataset.theme = 'dark';
window.wp.element.createRoot(mount).render(<App />);
document.getElementById('themeBtn').addEventListener('click', () => {
  const d = mount.dataset.theme === 'dark';
  mount.dataset.theme = d ? 'light' : 'dark';
  mount.classList.toggle('dark', !d);
  document.body.classList.toggle('lt', d);
});
