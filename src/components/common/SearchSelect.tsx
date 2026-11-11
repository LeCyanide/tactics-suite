import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { foldForSearch } from '@/lib/util';

export interface SearchOption {
  value: string;
  label: string;
  /** Options sharing a group are listed under its heading, after the ungrouped ones. */
  group?: string;
}

/**
 * A dropdown with a search box, for lists too long to scroll through. Looks
 * like the plain select it replaces until opened. The list is drawn on the
 * document body so a sidebar's scroll area cannot clip it.
 */
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder = 'Search…',
  title,
}: {
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value);

  const matches = useMemo(() => {
    const q = foldForSearch(query.trim());
    const hit = q ? options.filter((o) => foldForSearch(o.label).includes(q)) : options;
    // Ungrouped first, then each group in the order it first appears.
    const order = [...new Set(hit.map((o) => o.group ?? ''))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));
    return order.flatMap((g) => hit.filter((o) => (o.group ?? '') === g));
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const pick = (option: SearchOption | undefined) => {
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    close();
    buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    setRect(buttonRef.current?.getBoundingClientRect() ?? null);
    setActive(Math.max(0, matches.findIndex((o) => o.value === value)));
    // Only on opening: typing resets the highlight itself.
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !buttonRef.current?.contains(t)) close();
    };
    const onResize = () => close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('.search-select-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The board's shortcuts must not see keys typed into the search box.
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  // Below the button, or above it when the window has no room underneath.
  const maxHeight = 320;
  const below = rect ? window.innerHeight - rect.bottom - 8 : maxHeight;
  const flip = rect ? below < 200 && rect.top > below : false;

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="search-select-button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
      >
        <span>{current?.label ?? ''}</span>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={popRef}
            className="search-select-pop"
            style={{
              left: rect.left,
              width: Math.max(rect.width, 220),
              ...(flip ? { bottom: window.innerHeight - rect.top + 2 } : { top: rect.bottom + 2 }),
              maxHeight: Math.min(maxHeight, flip ? rect.top - 8 : below),
            }}
          >
            <div className="search-select-search">
              <Search size={12} />
              <input
                autoFocus
                type="search"
                placeholder={placeholder}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
              />
            </div>
            <div ref={listRef} className="search-select-list" role="listbox">
              {matches.map((o, i) => {
                const heading = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                return (
                  <div key={o.value} style={{ display: 'contents' }}>
                    {heading && <div className="search-select-group">{heading}</div>}
                    <div
                      role="option"
                      aria-selected={o.value === value}
                      className={`search-select-item${i === active ? ' active' : ''}${o.value === value ? ' current' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o)}
                    >
                      {o.label}
                    </div>
                  </div>
                );
              })}
              {!matches.length && <div className="search-select-empty">No match</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
