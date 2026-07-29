export const EmptyState = ({
  detail,
  title = 'Nothing to show',
  description,
}: {
  readonly detail?: string;
  readonly title?: string;
  readonly description?: string;
}) => (
  <section className="state-card state-card--empty" aria-label={title}>
    <p>
      <strong>{title}</strong>
    </p>
    <p>{description ?? detail}</p>
  </section>
);
