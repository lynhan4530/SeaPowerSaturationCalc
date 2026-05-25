import { useState } from 'react';
import { Header } from './components/Header';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { MissileLibrary } from './components/MissileLibrary';
import { useDbLoader } from './hooks/useDbLoader';

export function App() {
  const [missileLibraryOpen, setMissileLibraryOpen] = useState(false);
  const { loading, error } = useDbLoader();

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-navy text-textPrimary">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-panelBorder border-t-amberAccent"></div>
          <h2 className="text-lg font-bold uppercase tracking-widest text-textSecondary">
            Loading Sea Power database...
          </h2>
          <p className="text-xs text-textSecondary">Seeding IndexedDB (first load may take a moment)</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-navy text-textPrimary">
        <div className="max-w-md rounded border border-redAccent/30 bg-panel p-6 text-center shadow-lg">
          <h2 className="mb-2 text-lg font-bold text-redAccent uppercase tracking-widest">
            Database Load Error
          </h2>
          <p className="mb-4 text-sm text-textSecondary">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded bg-redAccent/20 px-4 py-2 text-sm text-redAccent hover:bg-redAccent/30"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-navy text-textPrimary">
      <Header onOpenMissileLibrary={() => setMissileLibraryOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <LeftPanel />
        <RightPanel />
      </div>
      {missileLibraryOpen && (
        <MissileLibrary onClose={() => setMissileLibraryOpen(false)} />
      )}
    </div>
  );
}
