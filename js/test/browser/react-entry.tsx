// Bundled by the React test: renders the wrapper and lets the test change props.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Chart } from '../../src/react';

function App() {
  const [type, setType] = useState<'bar' | 'line'>('bar');
  const [clicks, setClicks] = useState(0);
  (window as any).setType = setType;
  return (
    <div style={{ width: 480, height: 280 }}>
      <Chart type={type} data={[{ k: 'a', v: 3 }, { k: 'b', v: 5 }, { k: 'c', v: 2 }]} onClick={() => setClicks(c => c + 1)} />
      <output id="clicks">{clicks}</output>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
