import { describe, expect, it } from 'vitest';

import { fromPrisma, toPrisma } from '../src/adapters/prisma';

// A slice of a DMMF the way Prisma exposes it
const dmmf = {
	datamodel: {
		models: [
			{
				name: 'Order',
				documentation: 'customer orders',
				fields: [
					{ name: 'id', type: 'Int', kind: 'scalar', isList: false },
					{ name: 'total', type: 'Float', kind: 'scalar', isList: false, documentation: 'dollars' },
					{ name: 'placedAt', type: 'DateTime', kind: 'scalar', isList: false },
					{ name: 'customer', type: 'Customer', kind: 'object', isList: false },
					{ name: 'tags', type: 'String', kind: 'scalar', isList: true },
					{ name: 'meta', type: 'Json', kind: 'scalar', isList: false },
				],
			},
		],
	},
};

describe('prisma adapter', () => {
	// Scalars only, relations and lists dropped
	it('reads a schema from the dmmf', () => {
		const schema = fromPrisma(dmmf);
		expect(schema.tables[0].name).toBe('Order');
		expect(schema.tables[0].columns.map((c) => c.name)).toEqual(['id', 'total', 'placedAt']);
		expect(schema.tables[0].columns[1]).toEqual({ name: 'total', type: 'number', description: 'dollars' });
		expect(schema.tables[0].columns[2].type).toBe('date');
	});

	// The findMany arguments
	it('turns a plan into findMany args', () => {
		expect(toPrisma({ table: 'Order', columns: ['total'], filter: { column: 'total', operator: 'at_least', value: 100 }, orderBy: { column: 'placedAt', descending: true }, limit: 5 })).toEqual({
			select: { total: true },
			where: { total: { gte: 100 } },
			orderBy: { placedAt: 'desc' },
			take: 5,
		});
		const text = toPrisma({ table: 'Order', columns: [], filter: { column: 'customer', operator: 'contains', value: 'ray' }, limit: 5 });
		expect(text.where).toEqual({ customer: { contains: 'ray' } });
		const pg = toPrisma({ table: 'Order', columns: [], filter: { column: 'customer', operator: 'equals', value: 'Ray' }, limit: 5 }, { caseInsensitive: true });
		expect(pg.where).toEqual({ customer: { equals: 'Ray', mode: 'insensitive' } });
		const date = toPrisma({ table: 'Order', columns: [], filter: { column: 'placedAt', operator: 'after', value: '2026-01-01' }, limit: 5 });
		expect((date.where as { placedAt: { gte: Date } }).placedAt.gte.toISOString()).toBe('2026-01-02T00:00:00.000Z');
		const same = toPrisma({ table: 'Order', columns: [], filter: { column: 'placedAt', operator: 'equals', value: '2026-01-01' }, limit: 5 });
		expect(same.where).toEqual({ placedAt: { gte: new Date('2026-01-01T00:00:00.000Z'), lt: new Date('2026-01-02T00:00:00.000Z') } });
		expect(() => toPrisma({ table: 'Order', columns: [], limit: Number.NaN })).toThrow(/limit/);
	});
});
