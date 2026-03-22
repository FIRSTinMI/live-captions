import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryProvider } from '../shared/QueryProvider';
import { SettingsApp } from './SettingsApp';

const root = createRoot(document.getElementById('root')!);
root.render(
    <QueryProvider>
        <SettingsApp />
    </QueryProvider>
);
