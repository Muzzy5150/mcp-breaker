export default function Loading() {
  return (
    <main className="state-shell" aria-busy="true" aria-label="Loading assessment">
      <section className="state-panel loading-panel">
        <span className="loading-line loading-short" />
        <span className="loading-line loading-title" />
        <span className="loading-line" />
        <span className="loading-line" />
      </section>
    </main>
  );
}
