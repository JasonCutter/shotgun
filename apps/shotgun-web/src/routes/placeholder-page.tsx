import { EmptyState } from '../components/empty-state.js';

export const PlaceholderPage = ({
  heading,
  nextSection,
}: {
  readonly heading: string;
  readonly nextSection: string;
}) => (
  <section className="route-page">
    <p className="eyebrow">Workspace route</p>
    <h1 tabIndex={-1}>{heading}</h1>
    <EmptyState detail={`${nextSection}에서 실제 서버 기능을 연결합니다.`} />
  </section>
);
