import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../trpc/router';

export const trpc = createTRPCReact<AppRouter>();

export function getToken(): string | null {
    return localStorage.getItem('adminToken');
}

export function setToken(token: string) {
    localStorage.setItem('adminToken', token);
}

export function clearToken() {
    localStorage.removeItem('adminToken');
}
