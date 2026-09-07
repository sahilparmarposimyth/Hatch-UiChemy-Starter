import './design-system/styles/tokens.css';
import './design-system/styles/component-tokens.css';
import './styles/main.scss';

import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

import App from './App.jsx';
import bootConditionLauncher from './screens/dashboard/TBConditionLauncher.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { TooltipProvider } from './design-system';

if (process.env.NODE_ENV === 'development') {
  import('react-grab');
}

const MOUNT_ID = (window.uich_nd_boot && window.uich_nd_boot.mountId) || 'uich-new-dash';

domReady(() => {
  // The block editor loads this same bundle for the one-time Edit Condition
  // launcher, where the dashboard's mount does not exist. It self-checks and
  // returns immediately on the dashboard page, so it is safe to call first.
  bootConditionLauncher();

  const el = document.getElementById(MOUNT_ID);
  if (!el) return;
  // Design-system light-content surface scope: makes every --uc-* token
  // resolve on the mount (the legacy --* tokens in tokens.scss are remapped
  // onto these), sets the Zalando Sans baseline, and applies border-box.
  el.classList.add('uc-content');
  const root = createRoot(el);
  root.render(
    <ErrorBoundary>
      <TooltipProvider delayDuration={200}>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  );
});
