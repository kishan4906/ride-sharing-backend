// Run with: npm run seed
// Idempotent-ish: uses upsert-by-email so re-running won't create duplicates,
// though it will error on unique phone/licensePlate collisions if you've
// since changed the schema — safe to `prisma migrate reset` in dev if needed.

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password123!';

async function main() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  // ── Riders ─────────────────────────────────────────────────────────────
  const riderNames = ['Aditi Sharma', 'Rahul Verma', 'Priya Patel'];
  const riders = [];
  for (let i = 0; i < riderNames.length; i++) {
    const rider = await prisma.user.upsert({
      where: { email: `rider${i + 1}@demo.com` },
      update: {},
      create: {
        name: riderNames[i],
        email: `rider${i + 1}@demo.com`,
        phone: `+9198765000${i + 1}`,
        passwordHash,
        role: 'RIDER',
      },
    });
    riders.push(rider);
  }

  // ── Drivers (around Vadodara, Gujarat, for realistic geo clustering) ────
  const driverSeed = [
    { name: 'Sanjay Rathod', lat: 22.3072, lng: 73.1812, vehicleType: 'SEDAN' as const, make: 'Honda', model: 'City', plate: 'GJ06AB1234', color: 'White' },
    { name: 'Meena Joshi', lat: 22.3126, lng: 73.1699, vehicleType: 'AUTO' as const, make: 'Bajaj', model: 'RE', plate: 'GJ06CD5678', color: 'Yellow' },
    { name: 'Vikram Solanki', lat: 22.2965, lng: 73.1911, vehicleType: 'BIKE' as const, make: 'Hero', model: 'Splendor', plate: 'GJ06EF9012', color: 'Black' },
    { name: 'Farhan Sheikh', lat: 22.3220, lng: 73.1680, vehicleType: 'SUV' as const, make: 'Mahindra', model: 'XUV700', plate: 'GJ06GH3456', color: 'Grey' },
    { name: 'Kavita Nair', lat: 22.3005, lng: 73.1755, vehicleType: 'SEDAN' as const, make: 'Maruti', model: 'Ciaz', plate: 'GJ06IJ7890', color: 'Silver' },
  ];

  for (let i = 0; i < driverSeed.length; i++) {
    const d = driverSeed[i];
    const user = await prisma.user.upsert({
      where: { email: `driver${i + 1}@demo.com` },
      update: {},
      create: {
        name: d.name,
        email: `driver${i + 1}@demo.com`,
        phone: `+9198765100${i + 1}`,
        passwordHash,
        role: 'DRIVER',
      },
    });

    const driver = await prisma.driver.upsert({
      where: { userId: user.id },
      update: {
        currentLatitude: d.lat,
        currentLongitude: d.lng,
        status: 'AVAILABLE',
        lastLocationUpdate: new Date(),
      },
      create: {
        userId: user.id,
        status: 'AVAILABLE',
        currentLatitude: d.lat,
        currentLongitude: d.lng,
        lastLocationUpdate: new Date(),
      },
    });

    await prisma.vehicle.upsert({
      where: { driverId: driver.id },
      update: {},
      create: {
        driverId: driver.id,
        vehicleType: d.vehicleType,
        make: d.make,
        model: d.model,
        licensePlate: d.plate,
        color: d.color,
      },
    });
  }

  // ── One admin ─────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      name: 'Platform Admin',
      email: 'admin@demo.com',
      phone: '+919876599999',
      passwordHash,
      role: 'ADMIN',
    },
  });

  console.log('✅ Seed complete.');
  console.log(`   Demo password for every account: ${DEMO_PASSWORD}`);
  console.log('   Riders: rider1@demo.com .. rider3@demo.com');
  console.log('   Drivers: driver1@demo.com .. driver5@demo.com (all AVAILABLE, near Vadodara)');
  console.log('   Admin:   admin@demo.com');
  console.log('   NOTE: driver AVAILABILITY in the Postgres row is seeded, but the Redis');
  console.log('   geo pool is NOT pre-populated by this script (Redis is ephemeral runtime');
  console.log('   state, not seed data) — each driver needs to call PATCH /drivers/status');
  console.log('   { "status": "AVAILABLE" } once after logging in to enter the matching pool.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
