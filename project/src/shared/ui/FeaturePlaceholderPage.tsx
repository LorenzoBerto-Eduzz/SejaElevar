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
      </div>

      <div className="empty-data-state placeholder-state" role="region">
        <h2>Em preparação</h2>
      </div>
    </section>
  );
}
