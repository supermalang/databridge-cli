import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import App from './App.jsx';
import { ToastProvider } from './components/Toast.jsx';
import i18n from './lib/i18n.js';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </I18nextProvider>
  </React.StrictMode>
);
