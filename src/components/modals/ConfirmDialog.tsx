import { Modal } from '../common/ui';
import { answerConfirm, useConfirmStore } from '@/state/confirm';

/** The app's yes/no question; see `confirmDialog`. */
export function ConfirmDialog() {
  const q = useConfirmStore((s) => s.open);
  if (!q) return null;

  return (
    <Modal
      title={q.title}
      size="narrow"
      onClose={() => answerConfirm(false)}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={() => answerConfirm(false)}>
            Cancel
          </button>
          <button className={`btn ${q.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => answerConfirm(true)}>
            {q.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{q.message}</div>
      {q.detail && (
        <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 6 }}>
          {q.detail}
        </div>
      )}
    </Modal>
  );
}
