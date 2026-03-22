import { createTRPCReact } from '@trpc/react-query';
import { createWSClient, wsLink, httpBatchLink, splitLink } from '@trpc/client';
import type { AppRouter } from '../../trpc/router';

export const trpc = createTRPCReact<AppRouter>();

export function createTrpcClient() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsClient = createWSClient({
        url: `${protocol}//${window.location.host}/trpc`,
        retryDelayMs: () => 5000,
    });
    return trpc.createClient({
        links: [
            splitLink({
                condition: op => op.type === 'subscription',
                true: wsLink({ client: wsClient }),
                false: httpBatchLink({ url: '/trpc' }),
            }),
        ],
    });
}
