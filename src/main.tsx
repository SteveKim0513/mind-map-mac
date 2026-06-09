import React from 'react';
import ReactDOM from 'react-dom/client';
// Pretendard, bundled & self-hosted so text renders even when the font isn't installed on the OS.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
