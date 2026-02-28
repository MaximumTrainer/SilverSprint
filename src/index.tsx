import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css'; // Ensure Tailwind directives are in this file

/**
 * SilverSprint Entry Point
 * Initializes the React 18 root and renders the orchestrated application flow.
 */
const container = document.getElementById('root');

if (!container) {
  throw new Error(
    "Root container not found. Failed to initialize SilverSprint. " +
    "Check if <div id='root'></div> exists in your index.html."
  );
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);