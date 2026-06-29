import type { MiddlewareHandler } from 'hono';

import { hasReaderDatabase, persistRouteData } from '@/api/reader/store';
import { config } from '@/config';
import logger from '@/utils/logger';

const middleware: MiddlewareHandler = async (ctx, next) => {
    await next();

    if (!config.reader.persistFetchedItems || !hasReaderDatabase() || ctx.req.path.startsWith('/api') || ctx.req.header('x-rsshub-reader-scheduler') === '1') {
        return;
    }

    const data = ctx.get('data');
    if (!data?.item?.length) {
        return;
    }

    void persistRouteData(ctx.req.url, data).catch((error) => {
        logger.warn(`Reader persistence skipped for ${ctx.req.url}: ${error instanceof Error ? error.message : error}`);
    });
};

export default middleware;
