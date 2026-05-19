import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ScenarioProvider } from './hooks/useScenario';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ScenarioProvider>
      <App />
    </ScenarioProvider>
  </React.StrictMode>,
);
