import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { useStore, type ModalId } from '@/state/store';
import type { PatchNotesArg } from '@/lib/patchNotes';
import { Modal } from '../common/ui';

/**
 * The patch notes, either by themselves on the first launch after an update or
 * from Settings → Updates. After an update the footer offers "Don't show
 * again", which turns off the setting of the same name in Settings.
 */
export function PatchNotesModal() {
  const arg = useStore((s) => s.modalArg) as PatchNotesArg | null;
  const versions = arg?.versions ?? [];
  const afterUpdate = arg?.afterUpdate ?? false;

  const close = () => {
    const s = useStore.getState();
    if (arg?.returnTo) s.openModal(arg.returnTo as ModalId);
    else s.closeModal();
  };

  const mute = () => {
    const s = useStore.getState();
    s.patchSettings({ showPatchNotes: false });
    s.toast('Patch notes will no longer open after updates. Turn them back on in Settings → Updates.');
    close();
  };

  const latest = versions[0]?.version;
  // One version after an update: its number is in the title, so it needs no heading of its own.
  const headed = !(afterUpdate && versions.length === 1);

  return (
    <Modal
      title={afterUpdate && latest ? `What's new in ${latest}` : 'Patch notes'}
      subtitle={afterUpdate && versions.length > 1 ? `${versions.length} updates since you last looked` : undefined}
      icon={afterUpdate ? <Sparkles size={13} style={{ color: 'var(--accent)', flex: 'none' }} /> : undefined}
      onClose={close}
      footer={
        <>
          {afterUpdate && (
            <button className="btn sm ghost patch-notes-mute" onClick={mute} title="Turn back on in Settings → Updates">
              Don't show again
            </button>
          )}
          <span className="spacer" />
          <button className="btn primary" onClick={close} autoFocus>
            Close
          </button>
        </>
      }
    >
      {versions.length === 0 ? (
        <div className="faint">No patch notes in this build.</div>
      ) : (
        <div className="patch-notes">
          {versions.map((v) => (
            <section key={v.version} className="patch-notes-version">
              {headed && (
                <h3>
                  {v.version}
                  {v.version === latest && afterUpdate && <span className="patch-notes-current">installed</span>}
                </h3>
              )}
              {v.sections.map((section) => (
                <div key={section.title} className="patch-notes-section">
                  <div className={`patch-notes-kind ${kindClass(section.title)}`}>{section.title}</div>
                  <ul>
                    {section.notes.map((note, i) => (
                      <li key={i}>{inline(note)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** A colour per kind of section, by the headings PATCHNOTES.md uses. Anything else stays neutral. */
function kindClass(title: string): string {
  const t = title.toLowerCase();
  if (t === 'new') return 'new';
  if (t === 'fixes' || t === 'fixed') return 'fix';
  if (t === 'in testing') return 'testing';
  return '';
}

/**
 * The inline Markdown a note can carry: `[text](https://…)`, `**bold**` and
 * `` `code` ``. Links open in the browser: the main process sends any new
 * window for an http(s) address to the system browser and denies the rest.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = m.index;
    if (m[1] !== undefined)
      out.push(
        <a key={key} href={m[2]} target="_blank" rel="noreferrer">
          {m[1]}
        </a>,
      );
    else if (m[3] !== undefined) out.push(<strong key={key}>{m[3]}</strong>);
    else out.push(<code key={key}>{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
