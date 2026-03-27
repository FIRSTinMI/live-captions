import React from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { trpc, getToken, clearToken } from './api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { DeviceDetail } from './pages/DeviceDetail';
import { ApiKeys } from './pages/ApiKeys';
import { Users } from './pages/Users';
import { AdminCredentials } from './pages/AdminCredentials';
import { PhraseSets } from './pages/PhraseSets';
import { DeviceGroups } from './pages/DeviceGroups';
import { DeviceGroupDetail } from './pages/DeviceGroupDetail';
import { Layout } from './Layout';

function handleAuthError(error: unknown) {
    if ((error as any)?.data?.code === 'UNAUTHORIZED') {
        clearToken();
        window.location.href = '/admin/login';
    }
}

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1 } },
    queryCache: new QueryCache({ onError: handleAuthError }),
    mutationCache: new MutationCache({ onError: handleAuthError }),
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
                                            <Route path="/api-keys" element={<ApiKeys />} />
                                            <Route path="/users" element={<Users />} />
                                            <Route path="/credentials" element={<AdminCredentials />} />
                                            <Route path="/phrase-sets" element={<PhraseSets />} />
                                            <Route path="/device-groups" element={<DeviceGroups />} />
                                            <Route path="/device-groups/:id" element={<DeviceGroupDetail />} />
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
