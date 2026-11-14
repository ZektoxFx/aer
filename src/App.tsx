import { useEffect, useState } from 'react';
import type { DataPack } from './data/types';
import { Shell } from './ui/Shell';

export default function App() {
  const [pack, setPack] = useState<DataPack | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/data/fake.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setPack)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="critical">Data pack failed to load: {error}</p>;
  if (!pack) return <p>LOADING DATA PACK…</p>;
  return <Shell pack={pack} />;
}
