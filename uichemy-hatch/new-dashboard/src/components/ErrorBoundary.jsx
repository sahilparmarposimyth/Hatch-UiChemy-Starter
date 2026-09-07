import React from 'react';
import { __ } from '@wordpress/i18n';
import { Button } from '../design-system';

/**
 * Last-resort guard so a render-time exception in any wizard / dashboard
 * screen shows a calm card with a Reload button instead of a blank
 * white page. The original error is logged to the console for debugging.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[uich-nd] render error', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div data-vs="uichemy" data-accent="full">
        <div className="wp">
          <div className="wp-content">
            <div className="wizwrap">
              <div className="wiz">
                <div className="wiz-card">
                  <div className="wiz-body">
                    <div className="calm">
                      <div className="calm__icon calm__icon--warn">!</div>
                      <h2>{__('Something went wrong in the dashboard', 'uichemy')}</h2>
                      <p>{String(this.state.error?.message || this.state.error || __('Unknown error', 'uichemy'))}</p>
                      <div className="calm__actions">
                        <Button variant="solid" tone="brand" onClick={() => window.location.reload()}>{__('Reload', 'uichemy')}</Button>
                        <Button variant="ghost" tone="neutral" asChild>
                          <a href="https://store.posimyth.com/helpdesk" target="_blank" rel="noreferrer">{__('Contact support', 'uichemy')}</a>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
