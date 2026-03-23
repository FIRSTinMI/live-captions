import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { clearToken } from './api';

export function Layout({ children }: { children: React.ReactNode }) {
    const location = useLocation();
    const navigate = useNavigate();

    function handleLogout() {
        clearToken();
        navigate('/admin/login');
    }

    const navLinks = [
        { to: '/admin/', label: 'Dashboard' },
        { to: '/admin/devices', label: 'Devices' },
        { to: '/admin/api-keys', label: 'API Keys' },
        { to: '/admin/users', label: 'Users' },
    ];

    return (
        <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
            {/* Sidebar */}
            <aside className="w-56 bg-gray-900 dark:bg-gray-950 text-white flex flex-col flex-shrink-0">
                <div className="px-6 py-5 border-b border-gray-700 dark:border-gray-800">
                    <h1 className="text-lg font-bold">Live Captions</h1>
                    <p className="text-xs text-gray-400">Admin Panel</p>
                </div>
                <nav className="flex-1 px-3 py-4 space-y-1">
                    {navLinks.map(link => {
                        const active = location.pathname === link.to ||
                            (link.to !== '/admin/' && location.pathname.startsWith(link.to));
                        return (
                            <Link
                                key={link.to}
                                to={link.to}
                                className={`block px-3 py-2 rounded text-sm font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
                            >
                                {link.label}
                            </Link>
                        );
                    })}
                </nav>
                <div className="px-3 py-4 border-t border-gray-700 dark:border-gray-800">
                    <button
                        onClick={handleLogout}
                        className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    >
                        Log out
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <main className="flex-1 overflow-auto">
                <div className="p-8">
                    {children}
                </div>
            </main>
        </div>
    );
}
