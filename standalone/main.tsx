import React from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import AsciiSky from '../game/AsciiSky';

const root = document.getElementById('root');
if (!root) throw new Error('ASCII SKY root element is missing.');

createRoot(root).render(
  <React.StrictMode>
    <AsciiSky />
  </React.StrictMode>,
);
