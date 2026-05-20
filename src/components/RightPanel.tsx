import { ResultsPanel } from './ResultsPanel';
import { Timeline } from './Timeline';

export function RightPanel() {
  return (
    <section className="flex-1 overflow-y-auto bg-navy text-sm text-textPrimary">
      <ResultsPanel />
      <div className="border-t border-panelBorder">
        <Timeline />
      </div>
    </section>
  );
}
