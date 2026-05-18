import { useRef, useState, type DragEvent } from 'react';

export function AprendizesPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [importError, setImportError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const selectFile = (file: File | undefined) => {
    if (!file) {
      return;
    }

    const isXlsx =
      file.name.toLowerCase().endsWith('.xlsx') ||
      file.type ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (!isXlsx) {
      setSelectedFileName('');
      setImportError('Selecione um arquivo .xlsx.');
      return;
    }

    setImportError('');
    setSelectedFileName(file.name);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files[0]);
  };

  return (
    <section className="feature-page" aria-labelledby="aprendizes-title">
      <div className="feature-heading">
        <div>
          <h1 id="aprendizes-title">Aprendizes</h1>
        </div>
      </div>

      <div
        className={
          isDragging ? 'empty-data-state dragging' : 'empty-data-state'
        }
        role="region"
        aria-label="Importar planilha de aprendizes"
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <div className="empty-data-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 4h14v16H5V4Z" />
            <path d="M8 8h8" />
            <path d="M8 12h8" />
            <path d="M8 16h5" />
          </svg>
        </div>
        <h2>Nenhuma planilha importada</h2>
        {selectedFileName && (
          <p className="import-feedback">Selecionado: {selectedFileName}</p>
        )}
        {importError && <p className="import-error">{importError}</p>}
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => selectFile(event.target.files?.[0])}
        />
        <button
          className="primary-action"
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          Importar .xlsx
        </button>
      </div>
    </section>
  );
}
