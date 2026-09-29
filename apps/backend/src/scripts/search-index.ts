import { prisma } from "../db/prisma.js";
import { logger } from "../utils/logger.js";
import { ensureEmailsIndex, indexEmailDocument } from "../integrations/elasticsearch.js";
import { toEmailDocument } from "../services/search.service.js";

// One-off/dev script: indexes all PostgreSQL emails. Run with:
//   npm run search:index
// Never runs on application startup.
const run = async () => {
  await ensureEmailsIndex();
  let indexed = 0;
  let failed = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.email.findMany({
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;
    for (const email of batch) {
      const doc = toEmailDocument(email);
      try {
        await indexEmailDocument(doc);
        indexed += 1;
      } catch (err) {
        failed += 1;
        logger.error({ emailId: email.id, err }, "reindex failed");
      }
      cursor = email.id;
    }
  }
  logger.info({ indexed, failed }, "search reindex complete");
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((err) => {
  logger.error({ err }, "search reindex crashed");
  process.exit(1);
});
