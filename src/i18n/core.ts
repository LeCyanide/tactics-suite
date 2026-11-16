/**
 * Localisation, without a library.
 *
 * The English text is the key: `t('Save')` reads as what it shows, and a
 * string nobody has translated yet simply stays English. Each other language
 * is a flat dictionary from that English text to its own; a plural is an
 * object with a form per category Intl.PluralRules reports.
 *
 * Parameters are written `{name}` in the text and filled in at call time, so
 * a translation can move them wherever its grammar wants them.
 *
 * Strings that live in module-level tables are marked with `N_()`, which
 * does nothing at runtime but lets `scripts/check-i18n.mjs` find them; they
 * are passed through `t()` where they are shown.
 *
 * This module has no DOM or React dependency, so the main process can use it
 * for its native dialogs too.
 */

import { de } from './de';
import { es } from './es';
import { fr } from './fr';

export type Language = 'en' | 'es' | 'fr' | 'de';

/** Plural forms by Intl.PluralRules category; `other` is always required. */
export type PluralEntry = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;
export type Entry = string | PluralEntry;
export type Dictionary = Record<string, Entry>;

/** In the order the language picker offers them; each named in itself. */
export const LANGUAGES: { id: Language; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'es', name: 'Español' },
  { id: 'fr', name: 'Français' },
];

export const DICTIONARIES: Record<Exclude<Language, 'en'>, Dictionary> = { de, es, fr };

export type Params = Record<string, string | number>;

let active: Language = 'en';

export function isLanguage(v: unknown): v is Language {
  return v === 'en' || v === 'es' || v === 'fr' || v === 'de';
}

export function setActiveLanguage(lang: Language): void {
  active = isLanguage(lang) ? lang : 'en';
}

export function activeLanguage(): Language {
  return active;
}

/** Marks a string for extraction without translating it. */
export function N_<S extends string>(s: S): S {
  return s;
}

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

function lookup(lang: Language, key: string): Entry | undefined {
  return lang === 'en' ? undefined : DICTIONARIES[lang][key];
}

/** Translates `key` (the English text) into the active language. */
export function t(key: string, params?: Params): string {
  return tIn(active, key, params);
}

export function tIn(lang: Language, key: string, params?: Params): string {
  const hit = lookup(lang, key);
  const text = typeof hit === 'string' ? hit : (hit?.other ?? key);
  return fill(text, params);
}

/**
 * A count-dependent string. `one` and `other` are the English forms, and the
 * key is `other`; `{n}` is the count unless params say otherwise.
 */
export function tn(n: number, one: string, other: string, params?: Params): string {
  const all = { n, ...params };
  const hit = lookup(active, other);
  if (hit === undefined) return fill(n === 1 ? one : other, all);
  if (typeof hit === 'string') return fill(hit, all);
  const rule = new Intl.PluralRules(active).select(n);
  return fill(hit[rule] ?? hit.other, all);
}

/** BCP 47 tag for Intl formatting (dates, numbers) in the active language. */
export function intlLocale(): string {
  return active;
}

/** Key names that keyboards label differently by language (Strg, Maj, Supr…). */
export const KEY_NAMES = ['Ctrl', 'Shift', 'Del', 'Delete', 'Esc', 'Enter', 'Arrow keys', 'Arrows', 'Tab'] as const;

/**
 * A shortcut as the user's keyboard labels it: "Ctrl+Shift+Z" becomes
 * "Strg+Umschalt+Z" in German. Looked up as `key:<name>`, so a key name never
 * collides with the same word used as a label ("Delete" the action).
 */
export function keyLabel(shortcut: string): string {
  if (active === 'en') return shortcut;
  return shortcut.replace(/Arrow keys|[A-Za-z]+/g, (tok) => {
    const hit = (KEY_NAMES as readonly string[]).includes(tok) ? lookup(active, `key:${tok}`) : undefined;
    return typeof hit === 'string' ? hit : tok;
  });
}
