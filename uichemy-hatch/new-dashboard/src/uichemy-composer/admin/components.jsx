// Shared dashboard form bits, replicate toggle_row() + the save button.
import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

// The shadcn Switch, wrapped in a local `.uich-tw` island so its tokens and
// utilities resolve even inside the still-ptn-styled White Label screen. Keeps
// the old checkbox contract: `checked` is 0/1 and `onChange` receives 0/1.
export function Toggle({ id, checked, onChange }) {
  return (
    <span className="uich-tw inline-flex">
      <Switch id={id} checked={!!checked} onCheckedChange={(v) => onChange(v ? 1 : 0)} />
    </span>
  );
}

export function ToggleRow({ label, desc, checked, onChange }) {
  return (
    <div className="ptn-row">
      <div className="ptn-row-info">
        <label>{label}</label>
        <span>{desc}</span>
      </div>
      <div className="ptn-row-control">
        <Toggle checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}

// The shadcn Button in its own `.uich-tw` island, so it's the global component
// even on the still-ptn-styled White Label screen. Keeps the async save + status.
export function SaveButton({ onSave, label = 'Save Changes' }) {
  const [state, setState] = React.useState('');
  return (
    <span className="uich-tw">
      <span className="inline-flex items-center gap-3">
        {state === 'saved' && <span className="ptn-saved text-[13px] font-medium">Saved</span>}
        {state === 'error' && <span className="text-[13px] font-medium text-destructive">Save failed</span>}
        <Button
          size="sm"
          disabled={state === 'saving'}
          onClick={() => {
            setState('saving');
            Promise.resolve(onSave())
              .then(() => setState('saved'))
              .catch(() => setState('error'));
          }}
        >
          {state === 'saving' ? 'Saving…' : label}
        </Button>
      </span>
    </span>
  );
}
