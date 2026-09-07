// Elementor responsive breakpoints, parity with legacy panel.
import React from 'react';
import { I } from './composer-icons';

/** Canonical UI order (Elementor responsive bar, largest → smallest). */
const BREAKPOINT_SORT_ORDER = [
  'widescreen',
  'desktop',
  'laptop',
  'tablet_extra',
  'tablet',
  'mobile_extra',
  'mobile',
];

const DESKTOP_BREAKPOINT = {
  key: 'desktop',
  label: 'Desktop',
  value: 0,
  direction: 'max',
};

const FALLBACK_BREAKPOINTS = [
  { ...DESKTOP_BREAKPOINT },
  { key: 'tablet', label: 'Tablet', value: 1024, direction: 'max' },
  { key: 'mobile', label: 'Mobile', value: 767, direction: 'max' },
];

function sortBreakpointList(list) {
  return [...list].sort((a, b) => {
    const ai = BREAKPOINT_SORT_ORDER.indexOf(a.key);
    const bi = BREAKPOINT_SORT_ORDER.indexOf(b.key);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return String(a.key).localeCompare(String(b.key));
  });
}

/** Elementor often omits desktop from activeBreakpoints, always include it first in the bar. */
function ensureDesktopBreakpoint(list) {
  const out = Array.isArray(list) ? list.map((b) => ({ ...b })) : [];
  const desktopIdx = out.findIndex((b) => b.key === 'desktop');
  if (desktopIdx === -1) {
    const widescreenIdx = out.findIndex((b) => b.key === 'widescreen');
    const insertAt = widescreenIdx >= 0 ? widescreenIdx + 1 : 0;
    out.splice(insertAt, 0, { ...DESKTOP_BREAKPOINT });
  } else {
    out[desktopIdx] = {
      ...out[desktopIdx],
      label: out[desktopIdx].label || 'Desktop',
    };
  }
  return sortBreakpointList(out);
}

function sortBreakpointKeys(keys) {
  return [...keys].sort((a, b) => {
    const ai = BREAKPOINT_SORT_ORDER.indexOf(a);
    const bi = BREAKPOINT_SORT_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.localeCompare(b);
  });
}

function readBreakpointsSourceObject() {
  try {
    const fe = typeof window !== 'undefined' ? window.elementorFrontend : null;
    if (fe?.config?.responsive) {
      const r = fe.config.responsive;
      return r.activeBreakpoints || r.breakpoints || null;
    }
    const el = typeof window !== 'undefined' ? window.elementor : null;
    if (el?.config?.responsive) {
      const r = el.config.responsive;
      return r.activeBreakpoints || r.breakpoints || null;
    }
  } catch (_) { /* ignore */ }
  return null;
}

/** Enabled Elementor breakpoints (same source as legacy getElementorActiveBreakpointsList). */
export function getElementorActiveBreakpointsList() {
  try {
    const source = readBreakpointsSourceObject();
    if (!source || typeof source !== 'object') return [...FALLBACK_BREAKPOINTS];
    const keys = sortBreakpointKeys(Object.keys(source));
    const out = [];
    keys.forEach((k) => {
      const v = source[k] || {};
      if (v.is_enabled === false) return;
      out.push({
        key: k,
        value: Number(v.value) || 0,
        direction: String(v.direction || 'max'),
        label: String(v.label || k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      });
    });
    return ensureDesktopBreakpoint(out.length ? out : [...FALLBACK_BREAKPOINTS]);
  } catch (_) {
    return ensureDesktopBreakpoint([...FALLBACK_BREAKPOINTS]);
  }
}

export function getElementorCurrentDeviceMode() {
  try {
    const el = typeof window !== 'undefined' ? window.elementor : null;
    if (el?.channels?.deviceMode && typeof el.channels.deviceMode.request === 'function') {
      const mode = String(el.channels.deviceMode.request('currentMode') || '').trim();
      if (mode) return mode;
    }
  } catch (_) { /* ignore */ }
  return 'desktop';
}

function clickElementorResponsiveBarButton(deviceKey) {
  const key = String(deviceKey || '').trim();
  if (!key || typeof document === 'undefined') return false;
  const selectors = [
    `.elementor-device-${key}`,
    `[data-device="${key}"]`,
    `.e-ui-responsive-bar__button[data-device-mode="${key}"]`,
    `#elementor-preview-responsive-wrapper [data-device-mode="${key}"]`,
    `.elementor-responsive-bar-switcher [data-device="${key}"]`,
  ];
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn && typeof btn.click === 'function') {
      btn.click();
      return true;
    }
  }
  return false;
}

/** Switch Elementor editor preview device (panel → Elementor sync). */
export function setElementorDeviceMode(deviceKey) {
  const key = String(deviceKey || 'desktop').trim() || 'desktop';
  if (getElementorCurrentDeviceMode() === key) return true;

  try {
    const el = typeof window !== 'undefined' ? window.elementor : null;
    if (el && typeof el.changeDeviceMode === 'function') {
      el.changeDeviceMode(key);
      if (getElementorCurrentDeviceMode() === key) return true;
    }
  } catch (_) { /* ignore */ }

  try {
    const $e = typeof window !== 'undefined' ? window.$e : null;
    if ($e?.run && typeof $e.run === 'function') {
      const attempts = [
        ['preview/change-device-mode', { device: key }],
        ['panel/change-device-mode', { device: key }],
        ['editor/change-device-mode', { device: key }],
      ];
      for (const [command, args] of attempts) {
        try {
          $e.run(command, args);
          if (getElementorCurrentDeviceMode() === key) return true;
        } catch (_) { /* command may not exist in this Elementor version */ }
      }
    }
  } catch (_) { /* ignore */ }

  try {
    const el = typeof window !== 'undefined' ? window.elementor : null;
    if (el?.channels?.deviceMode && typeof el.channels.deviceMode.trigger === 'function') {
      el.channels.deviceMode.trigger('change', key);
    }
  } catch (_) { /* ignore */ }

  clickElementorResponsiveBarButton(key);
  return getElementorCurrentDeviceMode() === key;
}

export function getMediaTextForElementorBreakpointKey(breakpointKey) {
  if (!breakpointKey || breakpointKey === 'desktop') return '';
  const list = getElementorActiveBreakpointsList();
  const bp = list.find((b) => b.key === breakpointKey);
  if (!bp || !bp.value) return '';
  return `(${bp.direction}-width: ${bp.value}px)`;
}

/**
 * Breakpoints that can supply values at the current device, most-specific first,
 * then larger viewports down to desktop base ('').
 * e.g. Mobile → ['mobile', 'tablet', ''], Tablet → ['tablet', ''].
 */
export function buildResponsiveFallbackChainForBreakpoint(currentBpKey) {
  const activeBp = String(currentBpKey || 'desktop').toLowerCase();
  if (!activeBp || activeBp === 'desktop') return [''];
  const bpList = getElementorActiveBreakpointsList();
  const currentBp = bpList.find((b) => b.key === activeBp);
  if (!currentBp || !currentBp.direction) return [activeBp, ''];
  const applicable = bpList.filter((bp) => {
    if (!bp.value) return false;
    if (bp.direction === 'max' && currentBp.direction === 'max') {
      return (bp.value || 0) >= (currentBp.value || 0);
    }
    if (bp.direction === 'min' && currentBp.direction === 'min') {
      return (bp.value || 0) <= (currentBp.value || 0);
    }
    return false;
  });
  applicable.sort((a, b) => {
    if (a.direction === 'max' && b.direction === 'max') {
      return (a.value || 0) - (b.value || 0);
    }
    if (a.direction === 'min' && b.direction === 'min') {
      return (b.value || 0) - (a.value || 0);
    }
    return 0;
  });
  const chain = applicable.map((bp) => bp.key);
  chain.push('');
  return chain;
}

export function breakpointLabelForKey(breakpointKey, breakpoints) {
  const key = String(breakpointKey || '').trim();
  if (!key || key === 'desktop') return 'Desktop';
  const bp = (breakpoints || []).find((b) => b.key === key);
  return bp?.label || key.replace(/_/g, ' ');
}

export function formatBreakpointHint(bp) {
  if (!bp) return '';
  if (!bp.value || bp.key === 'desktop') return 'Base styles';
  if (bp.direction === 'min') return `≥ ${bp.value}px`;
  return `≤ ${bp.value}px`;
}

export function breakpointIconForKey(breakpointKey) {
  const key = String(breakpointKey || '').toLowerCase();
  if (key === 'desktop' || key === 'widescreen' || key === 'laptop') return I.desktop;
  if (key.indexOf('tablet') === 0) return I.tablet;
  if (key.indexOf('mobile') === 0) return I.mobile;
  return I.desktop;
}

/**
 * Active device + breakpoint list, synced with Elementor's responsive toggle.
 */
export function useElementorDeviceMode() {
  const [device, setDeviceState] = React.useState(() => getElementorCurrentDeviceMode() || 'desktop');
  const [breakpoints, setBreakpoints] = React.useState(() => getElementorActiveBreakpointsList());
  const suppressElementorEchoRef = React.useRef(false);

  React.useEffect(() => {
    function refreshBreakpoints() {
      setBreakpoints(getElementorActiveBreakpointsList());
    }

    function syncFromElementor() {
      if (suppressElementorEchoRef.current) return;
      const mode = getElementorCurrentDeviceMode() || 'desktop';
      setDeviceState(mode);
      refreshBreakpoints();
    }

    refreshBreakpoints();
    syncFromElementor();

    const el = typeof window !== 'undefined' ? window.elementor : null;
    if (el?.channels?.deviceMode && typeof el.channels.deviceMode.on === 'function') {
      el.channels.deviceMode.on('change', syncFromElementor);
    }

    const poll = setInterval(() => {
      refreshBreakpoints();
      syncFromElementor();
    }, 1200);

    return () => {
      clearInterval(poll);
      if (el?.channels?.deviceMode && typeof el.channels.deviceMode.off === 'function') {
        try { el.channels.deviceMode.off('change', syncFromElementor); } catch (_) {}
      }
    };
  }, []);

  const setDevice = React.useCallback((nextKey) => {
    const key = String(nextKey || 'desktop').trim() || 'desktop';
    setDeviceState(key);
    suppressElementorEchoRef.current = true;
    setElementorDeviceMode(key);
    window.setTimeout(() => {
      suppressElementorEchoRef.current = false;
      const mode = getElementorCurrentDeviceMode();
      if (mode) setDeviceState(mode);
    }, 350);
  }, []);

  return { device, setDevice, breakpoints };
}
