import { describe, expect, it } from 'vitest';

import { toSQL } from '../src/sql';
import type { Schema } from '../src/types';

const schema: Schema = {
	tables: [{ name: 'orders', columns: [{ name: 'id', type: 'number' }, { name: 'customer', type: 'text' }, { name: 'total', type: 'number' }, { name: 'placed_at', type: 'date' }, { name: 'shipped', type: 'bool' }] }],
};

describe('toSQL', () => {
	// The shapes, plain, filtered, like, bool, postgres placeholders
	it('builds parameterized selects', () => {
		expect(toSQL(schema, { table: 'orders', columns: [], limit: 50 })).toEqual({ sql: 'SELECT * FROM "orders" LIMIT 50', params: [] });
		expect(toSQL(schema, { table: 'orders', columns: ['customer', 'total'], filter: { column: 'total', operator: 'greater_than', value: 100 }, orderBy: { column: 'total', descending: true }, limit: 5 })).toEqual({
			sql: 'SELECT "customer", "total" FROM "orders" WHERE "total" > ? ORDER BY "total" DESC LIMIT 5',
			params: [100],
		});
		const like = toSQL(schema, { table: 'orders', columns: [], filter: { column: 'customer', operator: 'contains', value: '50%_off' }, limit: 10 });
		expect(like.sql).toContain(`LIKE ? ESCAPE '\\'`);
		expect(like.params).toEqual(['%50\\%\\_off%']);
		expect(toSQL(schema, { table: 'orders', columns: [], filter: { column: 'customer', operator: 'equals', value: 'Ann' }, limit: 10 }).sql).toContain('LOWER("customer") = LOWER(?)');
		expect(toSQL(schema, { table: 'orders', columns: [], filter: { column: 'shipped', operator: 'equals', value: true }, limit: 10 }).params).toEqual([1]);
		expect(toSQL(schema, { table: 'orders', columns: [], filter: { column: 'total', operator: 'at_least', value: 1 }, limit: 10 }, '$').sql).toContain('"total" >= $1');
	});

	// Anything not in the schema is refused
	it('refuses unknown identifiers and bad operators', () => {
		expect(() => toSQL(schema, { table: 'users', columns: [], limit: 1 })).toThrow(/unknown table/);
		expect(() => toSQL(schema, { table: 'orders', columns: ['password'], limit: 1 })).toThrow(/unknown column/);
		expect(() => toSQL(schema, { table: 'orders', columns: [], filter: { column: 'customer', operator: 'greater_than', value: 'x' }, limit: 1 })).toThrow(/not allowed/);
		expect(() => toSQL(schema, { table: 'orders', columns: [], orderBy: { column: 'nope', descending: false }, limit: 1 })).toThrow(/unknown column/);
		expect(() => toSQL(schema, { table: 'orders', columns: [], limit: Number.NaN })).toThrow(/limit/);
		expect(() => toSQL(schema, { table: 'orders', columns: [], limit: 1.5 })).toThrow(/limit/);
	});
});
