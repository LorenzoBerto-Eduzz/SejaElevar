type FeaturePlaceholderPageProps = {
  title: string;
};

export function FeaturePlaceholderPage({ title }: FeaturePlaceholderPageProps) {
  const titleId = `${title.toLowerCase().replace(/\s+/g, '-')}-title`;

  return (
    <section className="feature-page" aria-labelledby={titleId}>
      <h1 className="visually-hidden" id={titleId}>
        {title}
      </h1>
      <div className="empty-data-state placeholder-state" role="region">
        <h2>{"Em prepara\u00e7\u00e3o"}</h2>
      </div>
    </section>
  );
}
