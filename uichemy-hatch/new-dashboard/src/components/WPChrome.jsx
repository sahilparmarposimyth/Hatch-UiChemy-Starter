import React from 'react';

/**
 * Faux WP-Admin canvas wrapper. The real WP admin bar + sidebar live
 * outside the React mount, so this just provides the calm background
 * the design calls for.
 */
export default function WPChrome({ children }) {
  return (
    <div className="wp">
      <div className="wp-content">{children}</div>
    </div>
  );
}
