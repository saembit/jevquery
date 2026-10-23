import { asc, desc, eq, getTableColumns, gt, gte, lt, lte, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import type { Plan, Schema, Table } from '../types';

// The shape of a drizzle table object this adapter can read
type DrizzleTable = Parameters<typeof getTableColumns>[0];

// A drizzle database that can select, pg, mysql and sqlite all have this shape
interface DrizzleDb {
	select(fields?: Record<string, AnyColumn>): { from(table: DrizzleTable): { where(cond: SQL | undefined): { orderBy(...order: SQL[]): { limit(n: number): Promise<unknown[]> } } } };
}

// What the caller may say about a table, a description, column descriptions and column kinds drizzle can't know, such as a date kept in a text column
export interface Describe {
	table?: string;
	columns?: Record<string, string>;
	types?: Record<string, 'text' | 'number' | 'date' | 'bool'>;
}

/**
 * fromDrizzle
 * Builds a JevQuery schema from drizzle table objects, descriptions and kind overrides come from the second argument
 * @param tables {Record<string, DrizzleTable>} - the tables keyed by the name Jev will see
 * @param describe {Record<string, Describe>} - descriptions and kind overrides per table
 * @param context {string | undefined} - shared facts every question can see
 * @return {Schema}
 **/
export function fromDrizzle(tables: Record<string, DrizzleTable>, describe: Record<string, Describe> = {}, context?: string): Schema {
	const out: Table[] = [];
	for (const [name, t] of Object.entries(tables)) {
		const columns = Object.entries(getTableColumns(t)).map(([key, c]) => ({
			name: key,
			type: describe[name]?.types?.[key] ?? columnType(c.dataType),
			description: describe[name]?.columns?.[key],
		}));
		out.push({ name, description: describe[name]?.table, columns });
	}
	return { context, tables: out };
}

/**
 * columnType
 * Maps a drizzle data type to a JevQuery column kind
 * @param dataType {string} - the drizzle data type
 * @return {'text' | 'number' | 'date' | 'bool'}
 **/
function columnType(dataType: string): 'text' | 'number' | 'date' | 'bool' {
	if (dataType === 'number' || dataType === 'bigint') return 'number';
	if (dataType === 'boolean') return 'bool';
	if (dataType === 'date') return 'date';
	return 'text';
}

/**
 * toDrizzle
 * Runs a plan through a drizzle database, the where, order and limit built from the typed parts
 * @param db {DrizzleDb} - the database
 * @param tables {Record<string, DrizzleTable>} - the same tables fromDrizzle saw
 * @param plan {Plan} - the plan
 * @return {Promise<unknown[]>}
 **/
export async function toDrizzle(db: DrizzleDb, tables: Record<string, DrizzleTable>, plan: Plan): Promise<unknown[]> {
	if (!Object.hasOwn(tables, plan.table)) throw new Error(`unknown table "${plan.table}"`);
	const table = tables[plan.table];
	const columns = getTableColumns(table);
	const col = (name: string): AnyColumn => {
		if (!Object.hasOwn(columns, name)) throw new Error(`unknown column "${name}"`);
		return columns[name];
	};

	// The projection, all columns or the picked ones
	const fields = plan.columns.length > 0 ? Object.fromEntries(plan.columns.map((c) => [c, col(c)])) : undefined;

	// The where
	let where: SQL | undefined;
	if (plan.filter) {
		const c = col(plan.filter.column);
		const v = plan.filter.value;
		// Only a real text column compares case insensitively, a date kept as text or a number is compared as is
		const isText = c.dataType === 'string' && typeof v === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(v);
		switch (plan.filter.operator) {
			case 'equals':
				where = isText ? sql`lower(${c}) = lower(${v})` : eq(c, v);
				break;
			case 'contains':
				where = sql`${c} LIKE ${`%${escapeLike(String(v))}%`} ESCAPE '\\'`;
				break;
			case 'starts_with':
				where = sql`${c} LIKE ${`${escapeLike(String(v))}%`} ESCAPE '\\'`;
				break;
			case 'greater_than':
			case 'after':
				where = gt(c, v);
				break;
			case 'less_than':
			case 'before':
				where = lt(c, v);
				break;
			case 'at_least':
				where = gte(c, v);
				break;
			case 'at_most':
				where = lte(c, v);
				break;
			default:
				throw new Error(`unknown operator "${String(plan.filter.operator)}"`);
		}
	}

	// The order
	const order = plan.orderBy ? [plan.orderBy.descending ? desc(col(plan.orderBy.column)) : asc(col(plan.orderBy.column))] : [];

	// Run it
	if (!Number.isSafeInteger(plan.limit) || plan.limit < 1) throw new Error(`limit must be a positive whole number, got ${String(plan.limit)}`);
	return db.select(fields).from(table).where(where).orderBy(...order).limit(plan.limit);
}

/**
 * escapeLike
 * Escapes the LIKE wildcards so they match themselves
 * @param v {string} - the value
 * @return {string}
 **/
function escapeLike(v: string): string {
	return v.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
