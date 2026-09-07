// Entry for the UiChemy admin dashboard React app. Mounts onto the root div
// that the PHP admin page prints, reading which screen to render from data-screen.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../shadcn.css';
// Admin-only brand skin. Imported AFTER shadcn.css so it re-skins the shadcn
// tokens to the UiChemy palette; it compiles into build/admin.css only, so the
// composer bundle (build/index.css) keeps the neutral zinc theme untouched.
import './brand.css';
import { AdminApp } from './App';

const el = document.getElementById('uichemy-dashboard-root');
if (el) {
  const initialScreen = el.getAttribute('data-screen') || 'dashboard';
  // Captured BEFORE HashRouter mounts: does the URL already carry an in-app
  // location (e.g. #/white)? A fresh WP-page load has none, so we honor the
  // page's data-screen; on reload after in-app nav the hash wins, so whatever
  // screen you were viewing is preserved instead of snapping back to the page.
  const hasHashLocation = window.location.hash.replace(/^#/, '') !== '';
  createRoot(el).render(<AdminApp initialScreen={initialScreen} hasHashLocation={hasHashLocation} />);
}
