import { prisma } from "../prisma";

async function main() {
  // Create a GIN index to accelerate FTS over title + contentText
  // Note: Functional index is not representable in Prisma schema; maintain via this script.
  const sql = `
    CREATE INDEX IF NOT EXISTS "Item_fts_idx"
    ON "Item"
    USING GIN (
      to_tsvector(
        'english',
        COALESCE(title, '') || ' ' || COALESCE("contentText", '')
      )
    );
  `;
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log('FTS index ensured: Item_fts_idx');
  } catch (e) {
    console.error('Failed to create FTS index', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();