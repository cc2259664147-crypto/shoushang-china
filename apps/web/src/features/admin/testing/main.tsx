import { createRoot } from 'react-dom/client';
import { AdminPage } from '../index';
import '@shoushang/ui/styles.css';
const root = document.getElementById('root');
if (!root)
    throw new Error('Missing root');
createRoot(root).render(<AdminPage />);
