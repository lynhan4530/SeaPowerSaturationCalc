import { useState } from 'react';
import { Header } from './components/Header';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { MissileLibrary } from './components/MissileLibrary';

export function App() {
  const [missileLibraryOpen, setMissileLibraryOpen] = useState(false);

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
