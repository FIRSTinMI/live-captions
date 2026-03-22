import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { trpc, getToken } from './api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { DeviceDetail } from './pages/DeviceDetail';
import { Users } from './pages/Users';
import { Layout } from './Layout';

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1 } },
});

const trpcClient = trpc.createClient({
    links: [
        httpBatchLink({
            url: '/trpc',
            headers: () => {
                const token = getToken();
                return token ? { Authorization: `Bearer ${token}` } : {};
            },
        }),
    ],
});

function RequireAuth({ children }: { children: React.ReactNode }) {
    if (!getToken()) return <Navigate to="/admin/login" replace />;
    return <>{children}</>;
}

export function App() {
    return (
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <Routes>
                        <Route path="/admin/login" element={<Login />} />
                        <Route
                            path="/admin/*"
                            element={
                                <RequireAuth>
                                    <Layout>
                                        <Routes>
                                            <Route path="/" element={<Dashboard />} />
                                            <Route path="/devices" element={<Devices />} />
                                            <Route path="/devices/:id" element={<DeviceDetail />} />
                                            <Route path="/users" element={<Users />} />
                                        </Routes>
                                    </Layout>
                                </RequireAuth>
                            }
                        />
                        <Route path="*" element={<Navigate to="/admin/" replace />} />
                    </Routes>
                </BrowserRouter>
            </QueryClientProvider>
        </trpc.Provider>
    );
}
