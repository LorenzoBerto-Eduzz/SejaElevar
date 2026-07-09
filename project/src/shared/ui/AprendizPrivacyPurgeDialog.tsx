import type { AprendizPrivacyPurgePreview } from '../data/aprendizPrivacy';

type AprendizPrivacyPurgeDialogProps = {
  aprendizName: string;
  confirmationValue: string;
  error: string;
  isPending: boolean;
  preview: AprendizPrivacyPurgePreview;
  onCancel: () => void;
  onChangeConfirmation: (value: string) => void;
  onConfirm: () => void;
};

export function AprendizPrivacyPurgeDialog({
  aprendizName,
  confirmationValue,
  error,
  isPending,
  preview,
  onCancel,
  onChangeConfirmation,
  onConfirm,
}: AprendizPrivacyPurgeDialogProps) {
  const canConfirm =
    confirmationValue.trim() === aprendizName.trim() && !isPending;

  return (
    <div className="page-modal-backdrop" role="presentation">
      <section
        className="recovery-dialog aprendiz-privacy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aprendiz-privacy-dialog-title"
      >
        <header className="recovery-dialog-header">
          <h2 id="aprendiz-privacy-dialog-title">Excluir dados pessoais</h2>
        </header>
        <div className="aprendiz-privacy-dialog-body">
          <p>
            Esta operação excluirá permanentemente <strong>{aprendizName}</strong> e
            todos os dados pessoais administrados pelo aplicativo.
          </p>
          <ul>
            <li>{preview.aprendizRowCount} cadastro</li>
            <li>{preview.planoEnsinoRows} linhas do Plano de Ensino</li>
            <li>{preview.presencaRows} registros de presença</li>
            <li>{preview.horasAplicadasRows} registros de horas aplicadas</li>
            <li>{preview.planoProgressoRows} linhas de progresso</li>
          </ul>
          <p className="aprendiz-privacy-warning">
            Esta ação não pode ser desfeita. O histórico de desfazer/refazer e os
            arquivos de recuperação serão apagados para impedir a restauração dos
            dados.
          </p>
          <label className="aprendiz-privacy-confirmation">
            <span>Digite o nome completo para confirmar:</span>
            <input
              autoFocus
              type="text"
              value={confirmationValue}
              disabled={isPending}
              onChange={(event) => onChangeConfirmation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canConfirm) {
                  onConfirm();
                }
              }}
            />
          </label>
          {error && <p className="aprendiz-privacy-error">{error}</p>}
        </div>
        <footer className="recovery-dialog-actions">
          <button type="button" disabled={isPending} onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="primary-action recovery-confirm-action aprendiz-privacy-confirm-action"
            type="button"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {isPending ? 'Excluindo...' : 'Excluir permanentemente'}
          </button>
        </footer>
      </section>
    </div>
  );
}
