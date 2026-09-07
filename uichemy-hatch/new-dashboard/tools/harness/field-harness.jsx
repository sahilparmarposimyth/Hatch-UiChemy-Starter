// Mounts the REAL InspectorV2 (and its real shadcn primitives + LengthInput)
// in the four composer skins. Not a copy of the markup — the actual components.
// Built by tools/harness/webpack.harness.js into build-harness/; neither file
// is part of the plugin build.
import React from 'react';
import { InspectorV2 } from '../../src/uichemy-composer/composer-inspector-v2';
import '../../src/uichemy-composer/composer-inspector-v2.css';

const SKINS = [
  { id: 'brand-dark',  title: 'Brand · dark',      theme: 'dark',  skin: null },
  { id: 'brand-light', title: 'Brand · light',     theme: 'light', skin: null },
  { id: 'el-dark',     title: 'Elementor · dark',  theme: 'dark',  skin: 'elementor' },
  { id: 'el-light',    title: 'Elementor · light', theme: 'light', skin: 'elementor' },
];

function Panel({ title, theme, skin }) {
  // Same classes + attributes composer-app.jsx's applyTheme / applySkin set.
  const hostCls = ['uich-composer-host', 'uich-tw',
    theme === 'dark' ? 'dark' : '',
    skin === 'elementor' ? 'skin-elementor' : '',
  ].filter(Boolean).join(' ');
  const attrs = {
    'data-theme': theme,
    'data-uich-composer-theme': theme,
    ...(skin ? { 'data-uich-composer-skin': skin } : {}),
  };
  return (
    <div className="skin">
      <h2>{title}</h2>
      <div className="frame">
        <div className={hostCls} {...attrs} style={{ colorScheme: theme }}>
          <div className={`panel dock-right${skin === 'elementor' ? ' skin-elementor' : ''}`} {...attrs}>
            <InspectorV2 />
          </div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return <div className="skins">{SKINS.map((s) => <Panel key={s.id} {...s} />)}</div>;
}

const mount = document.getElementById('root');
if (window.wp && window.wp.element && window.wp.element.createRoot) {
  window.wp.element.createRoot(mount).render(<App />);
} else {
  // eslint-disable-next-line global-require
  require('react-dom').render(<App />, mount);
}
