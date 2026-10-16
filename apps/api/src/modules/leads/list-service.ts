import type { Db } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { decodeCursor, encodeCursor, type ListQuery } from './list-query.js';
import type { LeadScope } from './scope.js';
import { listLeads } from './scoped-repository.js';

export async function listLeadsPage(db: Db, scope: LeadScope, query: ListQuery, timeZone: string) {
  const { cursor, ...filters } = query;
  const after = cursor === undefined ? null : decodeCursor(cursor);
  if (cursor !== undefined && !after) {
    throw new AppError(422, 'validation_error', 'Invalid cursor', [
      { field: 'cursor', issue: 'invalid_cursor' },
    ]);
  }

  const rows = await listLeads(db, scope, { ...filters, after, timeZone });
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);
  return {
    leads: page,
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.createdAtText, id: last.id }) : null,
  };
}
