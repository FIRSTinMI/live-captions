import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trpc, setToken } from '../api';

const OIDC_ERROR_MESSAGES: Record<string, string> = {
    oidc_disabled: 'Authelia login is not configured.',
    oidc_denied: 'Authelia login was cancelled.',
    oidc_state: 'Authelia login expired. Please try again.',
    oidc_forbidden: 'Your Authelia account is not an admin.',
    oidc_failed: 'Authelia login failed. Please try again.',
};

export function Login() {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const oidcEnabled = trpc.admin.oidcEnabled.useQuery(undefined, {
        staleTime: Infinity,
        retry: false,
    });

    // Handle the OIDC callback handoff: the server redirects here with the freshly
    // minted admin JWT in the URL fragment (never sent to the server). Store it the
    // same way the password login does, then continue into the panel. Also surface
    // any ?error= reported by the OIDC callback.
    useEffect(() => {
        const hash = window.location.hash;
        const tokenMatch = hash.match(/token=([^&]+)/);
        if (tokenMatch) {
            const token = decodeURIComponent(tokenMatch[1]);
            // Strip the token from the URL before navigating.
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            setToken(token);
            navigate('/admin/');
            return;
        }
        const params = new URLSearchParams(window.location.search);
        const err = params.get('error');
        if (err) {
            setError(OIDC_ERROR_MESSAGES[err] ?? 'Login failed. Please try again.');
            window.history.replaceState(null, '', window.location.pathname);
        }
    }, [navigate]);

    const login = trpc.admin.login.useMutation({
        onSuccess: (data) => {
            setToken(data.token);
            navigate('/admin/');
        },
        onError: () => setError('Invalid username or password'),
    });

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        login.mutate({ username, password });
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 w-full max-w-sm">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Live Captions</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Admin Panel</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                        />
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <button
                        type="submit"
                        disabled={login.isPending}
                        className="w-full bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {login.isPending ? 'Signing in...' : 'Sign in'}
                    </button>
                </form>

                {oidcEnabled.data?.enabled && (
                    <>
                        <div className="flex items-center gap-3 my-6">
                            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                            <span className="text-xs text-gray-400 uppercase tracking-wide">or</span>
                            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                        </div>
                        <a
                            href="/admin/oidc/login"
                            className="block w-full text-center border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                            Log in with Authelia
                        </a>
                    </>
                )}
            </div>
        </div>
    );
}
