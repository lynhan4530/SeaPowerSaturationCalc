import { ResultsPanel } from './ResultsPanel';
import { TacticalPlot } from './TacticalPlot';
import { Timeline } from './Timeline';

export function RightPanel() {
  return (
    <section className="flex-1 overflow-y-auto bg-navy text-sm text-textPrimary">
      <ResultsPanel />
      <div className="border-t border-panelBorder">
        <TacticalPlot />
      </div>
      <div className="border-t border-panelBorder">
        <Timeline />
      </div>
    </section>
  );
}
