export const EmptyState = ({ detail }: { readonly detail: string }) => (
  <section className="state-card state-card--empty" aria-label="기능 연결 상태">
    <p>이 기능은 아직 Frontend Section 1에 연결되지 않았습니다.</p>
    <p>{detail}</p>
  </section>
);
