import 'dotenv/config';
import path from 'path';
import bcrypt from 'bcrypt';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, schema } from './db';
import { createServer } from './server';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

async function seedInitialAdmin() {
    const userCount = await db.$count(schema.users);
    if (userCount > 0) return;

    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password) {
        console.warn('[seed] No ADMIN_USERNAME/ADMIN_PASSWORD set — skipping initial admin creation.');
        console.warn('[seed] Set these env vars and restart if this is a fresh install.');
        return;
    }

    const hash = await bcrypt.hash(password, 10);
    await db.insert(schema.users).values({ username, password: hash });
    console.log(`[seed] Created initial admin user: ${username}`);
}

async function main() {
    // Run DB migrations
    const migrationsFolder = path.join(__dirname, 'drizzle');
    try {
        await migrate(db, { migrationsFolder });
        console.log('[db] Migrations applied');
    } catch (err) {
        console.error('[db] Migration failed:', err);
        process.exit(1);
    }

    await seedInitialAdmin();

    const app = createServer();
    app.listen(PORT, () => {
        console.log(`Live Captions Cloud Server running on port ${PORT}`);
        console.log(`Admin panel: http://localhost:${PORT}/admin`);
    });
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
