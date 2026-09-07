import React, { useId } from 'react';
import { __, _n, sprintf } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Button } from '../../design-system';

/* ============================================================
   License picker (session-limit gate).

   Reuses the wizard's `choice` cards + `nd-badge` chips so it
   matches the Builder / Mode steps. Presentational only –
   selection state, the register-session call and the footer
   button live in App (the WizardShell footer drives it).

   Only `active` and `inactive` licenses can register a session;
   App filters out `disabled` / `expired` before they reach here.
   ============================================================ */

const STATUS_LABEL = {
  active: __('Active', 'uichemy'),
  inactive: __('Inactive', 'uichemy'),
};

function BuilderLogo({ type, className }) {
  // Unique per instance so repeated clipPath IDs don't collide across cards.
  const uid = useId();
  switch (type?.toLowerCase()) {
    case 'elementor':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 82 82" className={`${className ?? ''} rounded-full`} aria-hidden="true">
          <path fill="#92003B" d="M77.9 0H4.1C1.874 0 0 1.874 0 4.1v73.8C0 80.125 1.874 82 4.1 82h73.8c2.226 0 4.1-1.874 4.1-4.1V4.1C82 1.874 80.126 0 77.9 0ZM30.106 59.157h-7.263V22.843h7.263v36.314Zm29.168 0H37.37v-7.263h21.905v7.263Zm0-14.526H37.37v-7.263h21.905v7.263Zm0-14.525H37.37v-7.263h21.905v7.263Z" />
        </svg>
      );
    case 'bricks':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 82 82" className={className} aria-hidden="true">
          <g clipPath={`url(#${uid}-a)`}>
            <path fill="#FFD53E" d="M82 41C82 18.356 63.644 0 41 0S0 18.356 0 41s18.356 41 41 41 41-18.356 41-41Z" />
            <path fill="#212121" d="m35.295 17.571.732.458v12.72c2.583-1.707 5.44-2.562 8.573-2.562 4.514 0 8.256 1.576 11.226 4.729 2.928 3.152 4.393 7.037 4.393 11.653 0 4.637-1.475 8.521-4.424 11.653-2.969 3.153-6.7 4.729-11.195 4.729-3.925 0-7.281-1.404-10.067-4.21v3.447h-8.176v-41.61l8.938-1.007Zm7.749 18.883c-2.156 0-3.956.733-5.4 2.197-1.444 1.505-2.166 3.477-2.166 5.918 0 2.44.722 4.403 2.166 5.888 1.424 1.484 3.224 2.227 5.4 2.227 2.298 0 4.159-.773 5.582-2.319 1.404-1.525 2.105-3.457 2.105-5.796 0-2.339-.711-4.281-2.135-5.827-1.424-1.525-3.274-2.288-5.552-2.288Z" />
          </g>
          <defs>
            <clipPath id={`${uid}-a`}><path fill="#fff" d="M0 0h82v82H0z" /></clipPath>
          </defs>
        </svg>
      );
    case 'gutenberg':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 82 82" className={className} aria-hidden="true">
          <g clipPath={`url(#${uid}-a)`}>
            <rect width="82" height="82" fill="#B87878" rx="41" />
            <path fill="#287CB2" d="M77.9 0H4.1C1.874 0 0 1.874 0 4.1v73.8C0 80.125 1.874 82 4.1 82h73.8c2.226 0 4.1-1.874 4.1-4.1V4.1C82 1.874 80.126 0 77.9 0Z" />
            <path fill="#fff" d="M32.426 24.678c-6.248 2.716-8.64 8.537-8.175 19.726.266 5.69.598 7.76 1.728 9.83 2.858 5.433 7.577 7.761 14.49 7.179 4.918-.323 8.44-2.199 10.036-5.174.664-1.229 1.196-4.204 1.395-7.373.266-5.11.333-5.303 2.06-5.691 2.46-.518 6.714-4.01 6.714-5.562 0-1.811-1.795-1.553-4.387.647-1.462 1.228-3.456 2.134-6.048 2.651-7.378 1.423-8.707 1.94-10.767 4.204-2.26 2.522-2.593 4.01-.998 4.657.665.258 1.662-.389 2.991-1.94 1.861-2.135 5.384-4.01 6.182-3.234.2.258.398 1.94.398 3.88 0 6.855-2.858 9.895-9.172 9.895-3.855 0-7.045-1.81-9.039-5.174-1.196-1.94-1.396-3.363-1.396-10.348 0-9.248.997-12.158 4.919-14.68 4.785-3.105 12.23-1.359 13.957 3.362 1.463 3.751 2.792 4.527 4.055 2.2.598-1.035.465-1.876-.665-4.14-2.659-5.433-11.698-7.826-18.278-4.915Z" />
          </g>
          <defs>
            <clipPath id={`${uid}-a`}><rect width="82" height="82" fill="#fff" rx="41" /></clipPath>
          </defs>
        </svg>
      );
    default:
      return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 82 82" className={className} aria-hidden="true">
          <rect width="82" height="82" fill="#F0EEEE" rx="41" />
          <g clipPath={`url(#${uid}-a)`}>
            <path fill="#FFD53E" d="M77 31c0-9.941-8.059-18-18-18s-18 8.059-18 18 8.059 18 18 18 18-8.059 18-18Z" />
            <path fill="#212121" d="m56.495 20.714.322.201V26.5a6.677 6.677 0 0 1 3.763-1.125c1.982 0 3.625.692 4.929 2.076 1.286 1.384 1.928 3.09 1.928 5.116 0 2.036-.647 3.741-1.941 5.116-1.304 1.384-2.942 2.076-4.916 2.076-1.723 0-3.196-.616-4.42-1.848v1.513h-3.589V21.156l3.925-.442Zm3.402 8.29c-.946 0-1.736.322-2.37.965-.634.66-.951 1.527-.951 2.598 0 1.072.317 1.933.95 2.585.626.652 1.416.978 2.371.978 1.01 0 1.826-.34 2.451-1.018.616-.67.924-1.518.924-2.545s-.312-1.88-.937-2.558c-.625-.67-1.438-1.005-2.438-1.005Z" />
          </g>
          <g clipPath={`url(#${uid}-b)`}>
            <rect width="36" height="36" x="23" y="44" fill="#B87878" rx="18" />
            <path fill="#287CB2" d="M57.2 44H24.8c-.977 0-1.8.823-1.8 1.8v32.4c0 .977.823 1.8 1.8 1.8h32.4c.977 0 1.8-.823 1.8-1.8V45.8c0-.977-.823-1.8-1.8-1.8Z" />
            <path fill="#fff" d="M37.236 54.834c-2.743 1.193-3.793 3.748-3.59 8.66.117 2.499.263 3.407.76 4.316 1.254 2.385 3.326 3.407 6.36 3.152 2.16-.142 3.706-.966 4.407-2.272.292-.54.525-1.845.613-3.237.116-2.243.145-2.328.904-2.498 1.08-.227 2.947-1.76 2.947-2.442 0-.795-.788-.681-1.926.284-.642.54-1.517.937-2.655 1.164-3.239.625-3.822.852-4.727 1.846-.992 1.107-1.138 1.76-.438 2.044.292.114.73-.17 1.313-.852.817-.937 2.364-1.76 2.714-1.42.088.114.175.852.175 1.704 0 3.01-1.255 4.344-4.027 4.344-1.692 0-3.093-.795-3.968-2.271-.525-.852-.613-1.477-.613-4.543 0-4.06.438-5.338 2.16-6.446 2.1-1.362 5.368-.596 6.127 1.477.642 1.647 1.226 1.987 1.78.965.263-.454.204-.823-.292-1.817-1.167-2.385-5.135-3.435-8.024-2.158Z" />
          </g>
          <g clipPath={`url(#${uid}-c)`}>
            <path fill="#92003B" d="M39.2 13H6.8c-.977 0-1.8.823-1.8 1.8v32.4c0 .977.823 1.8 1.8 1.8h32.4c.977 0 1.8-.823 1.8-1.8V14.8c0-.977-.823-1.8-1.8-1.8ZM18.217 38.971H15.03V23.03h3.188v15.94Zm12.806 0h-9.617v-3.188h9.617v3.188Zm0-6.377h-9.617v-3.188h9.617v3.188Zm0-6.377h-9.617V23.03h9.617v3.188Z" />
          </g>
          <defs>
            <clipPath id={`${uid}-a`}><path fill="#fff" d="M41 13h36v36H41z" /></clipPath>
            <clipPath id={`${uid}-b`}><rect width="36" height="36" x="23" y="44" fill="#fff" rx="18" /></clipPath>
            <clipPath id={`${uid}-c`}><rect width="36" height="36" x="5" y="13" fill="#fff" rx="18" /></clipPath>
          </defs>
        </svg>
      );
  }
}

function LicenseCard({ license, selected, onSelect }) {
  const status = license.status;
  return (
    <button
      type="button"
      className={`choice ${selected ? 'choice--selected' : ''}`}
      onClick={() => onSelect(license)}
      aria-pressed={selected}
    >
      <span className="choice__logo" style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden' }}><BuilderLogo type={license.type} className="choice__logo-svg" /></span>
      <div className="choice__body">
        <div className="choice__title">
          {/* {license.licenseKey || __('License', 'uichemy')} */}
          {license.type?.toLowerCase() === 'aio'
            ? __('All Page Builder', 'uichemy')
            : license.type.charAt(0).toUpperCase() + license.type.slice(1).toLowerCase()} {" "}
          {/* {license.licenseKey.slice(0, 4) + '...' + license.licenseKey.slice(-4)} */}
        </div>
        <p className="choice__desc">
          {license.licenseKey.slice(0, 4) + '...' + license.licenseKey.slice(-4)}
          <span style={{ marginLeft: 10 }}>Limit : </span>
          {license.license_limit
            ? sprintf(_n('%s session', '%s sessions', license.license_limit, 'uichemy'), license.license_limit)
            : __('Connect this site to your UiChemy license.', 'uichemy')}
        </p>
      </div>
      <span className="choice__check"><Icon.Check size={13} /></span>
    </button>
  );
}

export default function LicensePickerScreen({ licenses = [], selected, onSelect }) {
  if (!licenses.length) {
    return (
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 14 }}>
          {__('No usable licenses were found on your account.', 'uichemy')}
        </p>
        <Button variant="solid" tone="brand" asChild>
          <a href="https://uichemy.com/pricing" target="_blank" rel="noreferrer">
            {__('Get a license', 'uichemy')}
          </a>
        </Button>
      </div>
    );
  }

  const selId = selected && (selected._id || selected.id);

  return (
    <>
      <div className="choices choices--3">
        {licenses.map((lic) => (
          <LicenseCard
            key={lic._id || lic.id}
            license={lic}
            selected={selId === (lic._id || lic.id)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </>
  );
}
