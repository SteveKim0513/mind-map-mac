import React from 'react';
import ReactDOM from 'react-dom/client';
// Pretendard, bundled & self-hosted so text renders even when the font isn't installed on the OS.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import App from './App';
import { CaptureWindow } from './ui/CaptureWindow';

// The global quick-capture window (electron/main.ts) loads this same bundle
// with ?capture=1 instead of a second entry point — REDESIGN-VISION §3-1.
const isCaptureWindow = new URLSearchParams(window.location.search).get('capture') === '1';
if (isCaptureWindow) document.body.classList.add('capture-mode');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isCaptureWindow ? <CaptureWindow /> : <App />}
  </React.StrictMode>,
);
