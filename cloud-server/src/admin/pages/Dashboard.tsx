import React from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../api';

function StatCard({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
        </div>
    );
}

function relativeTime(date: Date | string | null): string {
    if (!date) return 'Never';
    const d = new Date(date);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function Dashboard() {
    const { data: devices } = trpc.admin.devices.list.useQuery();
    const { data: usageSummary } = trpc.admin.devices.usageSummary.useQuery();

    const totalDevices = devices?.length ?? 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeToday = devices?.filter(d => d.lastSeenAt && new Date(d.lastSeenAt) >= today).length ?? 0;
    const totalMinutesThisMonth = usageSummary?.reduce((sum, u) => sum + u.minutesThisMonth, 0) ?? 0;

    return (
        <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Dashboard</h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                <StatCard label="Total Devices" value={totalDevices} />
                <StatCard label="Active Today" value={activeToday} />
                <StatCard label="Minutes This Month" value={totalMinutesThisMonth.toFixed(1)} />
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Recent Devices</h3>
                    <Link to="/admin/devices" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">View all</Link>
                </div>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                            <th className="px-6 py-3 font-medium">Name</th>
                            <th className="px-6 py-3 font-medium">Last Seen</th>
                            <th className="px-6 py-3 font-medium">Today (min)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {devices?.slice(0, 10).map(d => (
                            <tr key={d.id} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                                <td className="px-6 py-3">
                                    <Link to={`/admin/devices/${d.id}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">{d.name}</Link>
                                </td>
                                <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{relativeTime(d.lastSeenAt)}</td>
                                <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{d.todayMinutes.toFixed(1)}</td>
                            </tr>
                        ))}
                        {!devices?.length && (
                            <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-400">No devices yet</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
