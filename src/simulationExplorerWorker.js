import { runSimulationExplorer } from './simulationExplorerEngine.js';

self.onmessage = event => {
  try {
    const result = runSimulationExplorer(event.data);
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
