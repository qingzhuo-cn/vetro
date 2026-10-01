import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { startGlassFx } from './fx';
import './style.css';

// 按键反光：全局单 pointermove + rAF，与 React 树无关，挂载前启动即可
startGlassFx();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
