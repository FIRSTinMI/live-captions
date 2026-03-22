import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trpc, setToken } from '../api';

export function Login() {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

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
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="bg-white rounded-lg shadow p-8 w-full max-w-sm">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Live Captions</h1>
                <p className="text-sm text-gray-500 mb-6">Admin Panel</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            </div>
        </div>
    );
}
