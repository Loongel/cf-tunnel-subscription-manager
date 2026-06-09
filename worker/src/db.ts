export async function all<T>(db: D1Database, query: string, ...params: unknown[]): Promise<T[]> {
  const result = await db.prepare(query).bind(...params).all<T>();
  return result.results || [];
}

export async function first<T>(db: D1Database, query: string, ...params: unknown[]): Promise<T | null> {
  return await db.prepare(query).bind(...params).first<T>();
}

export async function run(db: D1Database, query: string, ...params: unknown[]): Promise<void> {
  await db.prepare(query).bind(...params).run();
}
