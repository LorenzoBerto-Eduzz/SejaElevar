import { ThemeToggleButton } from './ThemeToggleButton';

type FeaturePlaceholderPageProps = {
  title: string;
};

export function FeaturePlaceholderPage({ title }: FeaturePlaceholderPageProps) {
  const titleId = `${title.toLowerCase().replace(/\s+/g, '-')}-title`;

  return (
    <section className="feature-page" aria-labelledby={titleId}>
      <div className="feature-heading">
        <div>
          <h1 id={titleId}>{title}</h1>
        </div>
        <div className="table-toolbar" aria-label="Ações da página">
          <div className="table-toolbar-track">
            <ThemeToggleButton />
          </div>
        </div>
      </div>

      <div className="empty-data-state placeholder-state" role="region">
        <h2>Em preparação</h2>
      </div>
    </section>
  );
}
