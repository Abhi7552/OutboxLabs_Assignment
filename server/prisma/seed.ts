import 'dotenv/config';
import { prisma } from '../src/db.js';

async function main() {
  const user = await prisma.user.upsert({ where: { email: 'oliver.brown@domain.io' }, update: {}, create: { name: 'Oliver Brown', email: 'oliver.brown@domain.io', avatarUrl: 'https://i.pravatar.cc/80?img=12' } });
  await prisma.sender.upsert({ where: { email: 'oliver.brown@domain.io' }, update: {}, create: { name: 'Oliver Brown', email: 'oliver.brown@domain.io', userId: user.id } });
  console.log(`Seeded demo account ${user.id}`);
}

main().finally(() => prisma.$disconnect());
