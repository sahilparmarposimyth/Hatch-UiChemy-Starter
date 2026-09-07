import React from 'react';
import { __ } from '@wordpress/i18n';
import {
  Dialog,
  DialogContent,
  DialogCard,
  DialogClose,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '../../design-system';

/**
 * Modal, now a thin adapter over the design-system Dialog (Radix), keeping the
 * original API (open / onClose / title / description / children / footer /
 * className) so consumers (BuilderModal) are unchanged.
 *
 * DS Dialog portals to <body> and carries `uc-portal` (so --uc-* tokens
 * resolve). The webpage content inside still uses `--uich-wpc-*` tokens, which
 * are declared on `.uich-wpc`, so that class is added to DialogCard and
 * DialogFooter (the two containers holding webpage-tokened markup + buttons).
 * `.uich-wpc` only sets width:100% + a text color, so it doesn't fight the
 * dialog's own sizing.
 *
 * Radix owns focus trap, Escape and backdrop dismiss. The DS close button is
 * turned OFF (`showClose={false}`): it is positioned outside the dialog's
 * top-right corner, which reads as detached from a panel this size. This flow
 * puts its own × in the header row instead, which is where its design had it.
 */
const CloseGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export default function Modal({ open, onClose, title, description, children, footer, className = '' }) {
  return (
    <Dialog open={!!open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      {/* `uich-wpc-modal` is the styling hook for this flow's own sizing and
          spacing (see components/modal.scss). It has to sit on the CONTENT, not
          on a child: the width is set on the portal wrapper via :has(). */}
      <DialogContent
        className={['uich-wpc-modal', className].filter(Boolean).join(' ')}
        showClose={false}
      >
        <DialogCard className="uich-wpc">
          <DialogHeader>
            {/* The row renders even with no title, so the × keeps its corner. */}
            <div className="uich-wpc-modal__title-row">
              {title ? <DialogTitle>{title}</DialogTitle> : <span />}
              <DialogClose className="uich-wpc-modal__close" aria-label={ __( 'Close', 'uichemy' ) }>
                <CloseGlyph />
              </DialogClose>
            </div>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <DialogBody>{children}</DialogBody>
        </DialogCard>
        {footer ? <DialogFooter className="uich-wpc">{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
