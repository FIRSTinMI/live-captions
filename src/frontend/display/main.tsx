import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryProvider } from '../shared/QueryProvider';
import { DisplayApp } from './DisplayApp';
import './display.css';

const root = createRoot(document.getElementById('root')!);
root.render(
    <QueryProvider>
        <DisplayApp />
    </QueryProvider>
);
