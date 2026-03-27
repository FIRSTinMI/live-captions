import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { clearToken } from './api';

export function Layout({ children }: { children: React.ReactNode }) {
    const location = useLocation();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    function handleLogout() {
        clearToken();
        navigate('/admin/login');
    }

    const navLinks = [
        { to: '/admin/', label: 'Dashboard' },
        { to: '/admin/devices', label: 'Devices' },
        { to: '/admin/device-groups', label: 'Device Groups' },
        { to: '/admin/api-keys', label: 'API Keys' },
        { to: '/admin/users', label: 'Users' },
        { to: '/admin/phrase-sets', label: 'Phrase Sets' },
    ];

    function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
        return (
            <>
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
                                onClick={onNavigate}
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
            </>
        );
    }

    return (
        <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
            {/* Mobile backdrop */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-30 bg-black/50 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Mobile sidebar overlay — separate from desktop, avoids fixed/static conflicts */}
            {sidebarOpen && (
                <aside className="fixed inset-y-0 left-0 z-40 w-56 bg-gray-900 dark:bg-gray-950 text-white flex flex-col md:hidden">
                    <NavLinks onNavigate={() => setSidebarOpen(false)} />
                </aside>
            )}

            {/* Desktop sidebar — stays in flex flow, no position tricks needed */}
            <aside className="hidden md:flex md:flex-col w-56 flex-shrink-0 bg-gray-900 dark:bg-gray-950 text-white">
                <NavLinks />
            </aside>

            {/* Main content */}
            <main className="flex-1 overflow-auto min-w-0 min-h-0">
                {/* Mobile top bar */}
                <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-gray-900 text-white sticky top-0 z-20">
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="p-1 rounded hover:bg-gray-700"
                        aria-label="Open menu"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                    <span className="text-sm font-semibold">Live Captions</span>
                </div>
                <div className="p-4 md:p-8">
                    {children}
                </div>
            </main>
        </div>
    );
}
