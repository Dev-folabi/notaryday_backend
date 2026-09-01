import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { UserRole, PlanTier } from '../generated/prisma';
import * as pg from 'pg';
import * as bcrypt from 'bcrypt';
import * as dns from 'dns';

// Prefer IPv4 when the hostname resolves to both families (avoids hanging on
// unreachable IPv6 routes in some environments).
dns.setDefaultResultOrder('ipv4first');

const BCRYPT_SALT_ROUNDS = 12;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });

  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const email = (process.env.ADMIN_EMAIL ?? 'admin@notaryday.app').toLowerCase();
  const password =
    process.env.ADMIN_PASSWORD ?? 'admin-change-me-please-2026';
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: UserRole.ADMIN },
    create: {
      email,
      username: 'admin',
      full_name: 'Notary Day Admin',
      password_hash: passwordHash,
      role: UserRole.ADMIN,
      plan: PlanTier.FREE,
      onboarding_completed: true,
      onboarding_step: 4,
      settings: {
        create: {
          irs_rate_per_mile: 0.725,
          booking_page_enabled: true,
        },
      },
    },
  });

  console.log(`✅ Admin user ready: ${admin.email} (role=${admin.role})`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      `⚠️  ADMIN_PASSWORD env not set — using default. Set ADMIN_EMAIL/ADMIN_PASSWORD in .env and re-run seed.`,
    );
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
