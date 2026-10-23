import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import { fromDrizzle, toDrizzle } from '../src/adapters/drizzle';
import { validateSchema } from '../src/plan';

// A small drizzle schema
const orders = sqliteTable('orders', {
	id: integer('id').primaryKey(),
	customer: text('customer').notNull(),
	total: real('total').notNull(),
	placedAt: text('placed_at').notNull(),
});
const customers = sqliteTable('customers', { id: integer('id').primaryKey(), name: text('name').notNull(), city: text('city').notNull() });

// An in memory database with a few rows
function setup() {
	const sqlite = new Database(':memory:');
	sqlite.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, total REAL NOT NULL, placed_at TEXT NOT NULL);
	CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL);
	INSERT INTO orders VALUES (1,'Ann Lee',42.5,'2026-08-01'),(2,'Bob Ray',180,'2026-09-02'),(3,'Cy Park',250.25,'2026-10-01');
	INSERT INTO customers VALUES (1,'Ann Lee','Portland'),(2,'Bob Ray','Austin');`);
	return drizzle(sqlite);
}

describe('drizzle adapter', () => {
	// The schema comes out of the table objects with the right kinds
	it('reads a schema from drizzle tables', () => {
		const schema = fromDrizzle({ orders, customers }, { orders: { table: 'customer orders', columns: { total: 'dollars' } } }, 'a shop');
		expect(() => validateSchema(schema)).not.toThrow();
		const o = schema.tables.find((t) => t.name === 'orders')!;
		expect(o.description).toBe('customer orders');
		expect(o.columns.find((c) => c.name === 'total')).toEqual({ name: 'total', type: 'number', description: 'dollars' });
		expect(o.columns.find((c) => c.name === 'customer')!.type).toBe('text');
		const dated = fromDrizzle({ orders }, { orders: { types: { placedAt: 'date' } } });
		expect(dated.tables[0].columns.find((c) => c.name === 'placedAt')!.type).toBe('date');
	});

	// The plan runs against a real database
	it('runs a plan', async () => {
		const db = setup();
		const rows = (await toDrizzle(db, { orders, customers }, { table: 'orders', columns: ['customer', 'total'], filter: { column: 'total', operator: 'greater_than', value: 100 }, orderBy: { column: 'total', descending: true }, limit: 10 })) as Array<{ customer: string; total: number }>;
		expect(rows.map((r) => r.customer)).toEqual(['Cy Park', 'Bob Ray']);
		expect(Object.keys(rows[0])).toEqual(['customer', 'total']);
		const ann = (await toDrizzle(db, { orders, customers }, { table: 'customers', columns: [], filter: { column: 'city', operator: 'equals', value: 'portland' }, limit: 5 })) as Array<{ name: string }>;
		expect(ann.map((r) => r.name)).toEqual(['Ann Lee']);
		const like = (await toDrizzle(db, { orders, customers }, { table: 'orders', columns: [], filter: { column: 'customer', operator: 'contains', value: 'ray' }, limit: 5 })) as Array<{ id: number }>;
		expect(like.map((r) => r.id)).toEqual([2]);
		const underscore = (await toDrizzle(db, { orders, customers }, { table: 'orders', columns: [], filter: { column: 'customer', operator: 'contains', value: 'b_' }, limit: 5 })) as Array<{ id: number }>;
		expect(underscore).toEqual([]);
		const dated = (await toDrizzle(db, { orders, customers }, { table: 'orders', columns: ['id'], filter: { column: 'placedAt', operator: 'after', value: '2026-09-01' }, limit: 5 })) as Array<{ id: number }>;
		expect(dated.map((r) => r.id).sort()).toEqual([2, 3]);
	});

	// Unknown names never reach drizzle
	it('refuses unknown identifiers', async () => {
		const db = setup();
		await expect(toDrizzle(db, { orders }, { table: 'users', columns: [], limit: 1 })).rejects.toThrow(/unknown table/);
		await expect(toDrizzle(db, { orders }, { table: 'orders', columns: ['password'], limit: 1 })).rejects.toThrow(/unknown column/);
		await expect(toDrizzle(db, { orders }, { table: 'constructor', columns: [], limit: 1 })).rejects.toThrow(/unknown table/);
		await expect(toDrizzle(db, { orders }, { table: 'orders', columns: ['toString'], limit: 1 })).rejects.toThrow(/unknown column/);
	});
});
