type DependencyAwareDeleteDialogProps = {
  blocked: boolean;
  effects: string[];
  itemLabel: string;
  itemName: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DependencyAwareDeleteDialog({
  blocked,
  effects,
  itemLabel,
  itemName,
  onCancel,
  onConfirm,
}: DependencyAwareDeleteDialogProps) {
  return (
    <div
      className="page-modal-backdrop"
      role="presentation"
      onMouseDown={onCancel}
    >
      <section
        className="recovery-dialog dependency-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dependency-delete-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="recovery-dialog-header">
          <h2 id="dependency-delete-dialog-title">
            {blocked ? 'Exclusão bloqueada' : 'Confirmar exclusão'}
          </h2>
          <button
            className="dialog-close-button"
            type="button"
            aria-label="Fechar"
            onClick={onCancel}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="dependency-delete-dialog-body">
          <p>
            {blocked
              ? `${itemLabel} ${itemName || 'sem nome'} possui vínculos ativos.`
              : `Você está prestes a excluir ${itemLabel} ${
                  itemName || 'sem nome'
                }.`}
          </p>
          <ul>
            {effects.map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
          {!blocked && (
            <p>
              Registros históricos confirmados serão preservados e esta ação
              poderá ser desfeita.
            </p>
          )}
        </div>
        <footer className="recovery-dialog-actions">
          <button type="button" onClick={onCancel}>
            {blocked ? 'Fechar' : 'Cancelar'}
          </button>
          {!blocked && (
            <button
              className="primary-action recovery-confirm-action dependency-delete-confirm-action"
              type="button"
              onClick={onConfirm}
            >
              Excluir
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
