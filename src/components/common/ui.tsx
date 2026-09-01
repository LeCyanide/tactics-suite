import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

interface TipProps {
  label: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

/** Lightweight hover tooltip, positioned against the trigger element. */
export function Tip({ label, shortcut, side = 'left', children }: TipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timer.current = setTimeout(() => {
      const el = ref.current?.firstElementChild ?? ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const map = {
        left: { x: r.left - 8, y: r.top + r.height / 2 },
        right: { x: r.right + 8, y: r.top + r.height / 2 },
        top: { x: r.left + r.width / 2, y: r.top - 8 },
        bottom: { x: r.left + r.width / 2, y: r.bottom + 8 },
      };
      setPos(map[side]);
    }, 380);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  };

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const transform =
    side === 'left'
      ? 'translate(-100%, -50%)'
      : side === 'right'
        ? 'translate(0, -50%)'
        : side === 'top'
          ? 'translate(-50%, -100%)'
          : 'translate(-50%, 0)';

  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide} style={{ display: 'contents' }}>
        {children}
      </span>
      {pos && (
        <div className="tip" style={{ left: pos.x, top: pos.y, transform }}>
          <span>{label}</span>
          {shortcut && <kbd>{shortcut}</kbd>}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Collapsible panel                                                   */
/* ------------------------------------------------------------------ */

interface PanelProps {
  title: string;
  count?: number | string;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  grow?: boolean;
  flush?: boolean;
  storageKey?: string;
}

export function Panel({ title, count, actions, children, defaultOpen = true, grow, flush, storageKey }: PanelProps) {
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    try {
      const v = localStorage.getItem(`panel:${storageKey}`);
      return v === null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (storageKey) {
        try {
          localStorage.setItem(`panel:${storageKey}`, next ? '1' : '0');
        } catch {
          /* panel memory is a convenience, not data */
        }
      }
      return next;
    });
  };

  return (
    <div className={`panel${grow && open ? ' grow' : ''}`}>
      <div className={`panel-head${open ? '' : ' collapsed'}`} onClick={toggle}>
        <ChevronDown size={12} className="chev" />
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
        {actions && (
          <div className="head-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
      {open && <div className={`panel-body${flush ? ' flush' : ''}`}>{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form primitives                                                     */
/* ------------------------------------------------------------------ */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="control">{children}</div>
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
  overridden,
  onClearOverride,
  title,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  overridden?: boolean;
  onClearOverride?: () => void;
  title?: string;
}) {
  return (
    <label className={`check${checked ? ' on' : ''}`} title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      {overridden && (
        <span
          className="badge-override"
          title="Overrides the page default — click to clear"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClearOverride?.();
          }}
        >
          OVR
        </span>
      )}
    </label>
  );
}

/**
 * Numeric input that only pushes a value up when it parses, so typing "-" or
 * clearing the box mid-edit does not clobber the model with NaN.
 */
export function NumInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  width,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  width?: number;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(formatNumber(value));
  }, [value]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: width ? 'none' : 1, width }}>
      <input
        type="number"
        value={text}
        step={step}
        min={min}
        max={max}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(formatNumber(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      {suffix && <span className="faint mono" style={{ fontSize: 10.5 }}>{suffix}</span>}
    </div>
  );
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 1000) / 1000);
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1 }}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <span className="mono faint" style={{ fontSize: 10.5, width: 34, textAlign: 'right' }}>
        {format ? format(value) : Math.round(value * 100) + '%'}
      </span>
    </div>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Editable text (double-click to rename)                              */
/* ------------------------------------------------------------------ */

export function InlineEdit({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <span className={className} onDoubleClick={() => setEditing(true)} title="Double-click to rename">
        {value}
      </span>
    );
  }
  return (
    <input
      className="inline-edit"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft.trim()) onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          setEditing(false);
          if (draft.trim()) onCommit(draft.trim());
        }
        if (e.key === 'Escape') {
          setEditing(false);
          setDraft(value);
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Modal frame                                                         */
/* ------------------------------------------------------------------ */

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'normal',
  headerExtra,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'narrow' | 'normal' | 'wide';
  headerExtra?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${size === 'wide' ? ' wide' : size === 'narrow' ? ' narrow' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          {subtitle && <span className="sub">{subtitle}</span>}
          <span className="spacer" />
          {headerExtra}
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
