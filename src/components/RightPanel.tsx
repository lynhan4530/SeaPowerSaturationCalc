import { ResultsPanel } from './ResultsPanel';

export function RightPanel() {
  return (
    <section className="flex-1 overflow-y-auto bg-navy text-sm text-textPrimary">
      <ResultsPanel />
      <p className="px-4 pb-4 text-xs italic text-textSecondary">
        Timeline will appear here (Stage 5).
      </p>
    </section>
  );
}
