import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { plan } from '../src/plan';
import { NONE, selectedColumns, tokenCandidates } from '../src/questions';
import type { Answer, Decider, Question, Schema } from '../src/types';

// The schema used by the tests
const schema: Schema = {
	context: 'an online shop',
	tables: [
		{ name: 'orders', description: 'customer orders', columns: [{ name: 'id', type: 'number' }, { name: 'customer', type: 'text', description: 'the customer name' }, { name: 'total', type: 'number' }, { name: 'placed_at', type: 'date' }, { name: 'shipped', type: 'bool' }] },
		{ name: 'customers', description: 'people', columns: [{ name: 'id', type: 'number' }, { name: 'name', type: 'text' }] },
	],
};

// A choice answer
const choice = (pick: string, probs: Record<string, number>): Answer => ({ type: 'choice', choice: pick, probabilities: probs, confidence: 0.8 });

// A noul answer
const noul = (v: number): Answer => ({ type: 'noul', noul: v });

// A decider that answers each request from a queue in order and remembers the questions
function scripted(queue: Array<Record<string, Answer>>) {
	const asked: Array<Record<string, Question>> = [];
	const decide: Decider = async (_state, questions): Promise<Record<string, Answer>> => {
		asked.push(questions);
		return queue.shift() ?? {};
	};
	return { decide, asked };
}

// Finds the numbered option for a candidate text in the filter questions
function optionFor(questions: Record<string, Question>, name: string, text: string): string {
	const opts = questions[name].criteria as Record<string, string | null>;
	const entry = Object.entries(opts).find(([, v]) => v === text);
	if (!entry) throw new Error(`no option for ${text} in ${name}`);
	return entry[0];
}

describe('plan', () => {
	// The full path, table then filter and columns, with the value typed
	it('builds a filtered sorted plan with picked columns', async () => {
		let filterQs: Record<string, Question> = {};
		const decide: Decider = async (_state, questions): Promise<Record<string, Answer>> => {
			if ('pick' in questions) return { pick: choice('orders', { orders: 0.9, customers: 0.05, [NONE]: 0.05 }) };
			if ('filter_column' in questions) {
				filterQs = questions;
				return {
					filter_column: choice(optionFor(questions, 'filter_column', 'total'), { [optionFor(questions, 'filter_column', 'total')]: 0.9 }),
					operator: choice(optionFor(questions, 'operator', 'greater_than'), { [optionFor(questions, 'operator', 'greater_than')]: 0.9 }),
					value: choice(optionFor(questions, 'value', '100'), { [optionFor(questions, 'value', '100')]: 0.9 }),
					order_column: choice(optionFor(questions, 'order_column', 'total'), { [optionFor(questions, 'order_column', 'total')]: 0.8 }),
					order_dir: choice(optionFor(questions, 'order_dir', 'descending'), { [optionFor(questions, 'order_dir', 'descending')]: 0.8 }),
					limit: choice(NONE, { [NONE]: 0.9 }),
				};
			}
			return { wants_specific: noul(0.9), col_customer: noul(0.9), col_total: noul(0.8), col_id: noul(0.1) };
		};
		const out = await plan(decide, schema, 'orders over 100 dollars, biggest first, customer and total');
		expect(out.plan).toEqual({ table: 'orders', columns: ['customer', 'total'], filter: { column: 'total', operator: 'greater_than', value: 100 }, orderBy: { column: 'total', descending: true }, limit: 50 });
		expect(out.ranked[0].table).toBe('orders');
		expect(out.warnings).toEqual([]);
		expect(Object.keys(filterQs)).toContain('value');
	});

	// None winning or a weak table throws
	it('throws when no table fits', async () => {
		const { decide } = scripted([{ pick: choice(NONE, { orders: 0.1, customers: 0.1, [NONE]: 0.8 }) }]);
		await expect(plan(decide, schema, 'tell me a joke')).rejects.toThrow(/no table fits/);
	});

	// A half filter is a warning, not a silent drop, and the limit is capped
	it('warns on a partial filter and caps the limit', async () => {
		const decide: Decider = async (_state, questions): Promise<Record<string, Answer>> => {
			if ('pick' in questions) return { pick: choice('orders', { orders: 0.9 }) };
			if ('filter_column' in questions) {
				return {
					filter_column: choice(optionFor(questions, 'filter_column', 'total'), { [optionFor(questions, 'filter_column', 'total')]: 0.9 }),
					limit: choice(optionFor(questions, 'limit', '9000'), { [optionFor(questions, 'limit', '9000')]: 0.9 }),
				};
			}
			return { wants_specific: noul(0.1) };
		};
		const out = await plan(decide, schema, 'top 9000 orders by total');
		expect(out.plan.filter).toBeUndefined();
		expect(out.plan.limit).toBe(500);
		expect(out.plan.columns).toEqual([]);
		expect(out.warnings.join(' ')).toMatch(/only part of it/);
		expect(out.warnings.join(' ')).toMatch(/cut to 500/);
	});

	// A Standard Schema validator on a value can reject it, zod implements the spec
	it('runs a standard schema on the value and the plan', async () => {
		const decide: Decider = async (_state, questions): Promise<Record<string, Answer>> => {
			if ('pick' in questions) return { pick: choice('orders', { orders: 0.9 }) };
			if ('filter_column' in questions) {
				return {
					filter_column: choice(optionFor(questions, 'filter_column', 'total'), { [optionFor(questions, 'filter_column', 'total')]: 0.9 }),
					operator: choice(optionFor(questions, 'operator', 'greater_than'), { [optionFor(questions, 'operator', 'greater_than')]: 0.9 }),
					value: choice(optionFor(questions, 'value', '-5'), { [optionFor(questions, 'value', '-5')]: 0.9 }),
				};
			}
			return { wants_specific: noul(0.1) };
		};
		await expect(plan(decide, schema, 'orders over -5', { valueSchemas: { total: z.number().nonnegative() } })).rejects.toThrow(/value for total rejected/);
		const planSchema = z.object({ table: z.literal('customers') });
		await expect(plan(decide, schema, 'orders over -5', { planSchema: planSchema as never })).rejects.toThrow(/plan rejected/);
		const widening = z.object({ table: z.string(), columns: z.array(z.string()), limit: z.number().transform(() => 9999) }).passthrough();
		await expect(plan(decide, schema, 'orders over -5', { planSchema: widening as never })).rejects.toThrow(/plan limit/);
	});
});

describe('typed value failures', () => {
	// A value that doesn't fit the column drops the filter with a warning instead of throwing
	it('warns when the picked value is not a number', async () => {
		const decide: Decider = async (_state, questions): Promise<Record<string, Answer>> => {
			if ('pick' in questions) return { pick: choice('orders', { orders: 0.9 }) };
			if ('filter_column' in questions) {
				return {
					filter_column: choice(optionFor(questions, 'filter_column', 'total'), { [optionFor(questions, 'filter_column', 'total')]: 0.9 }),
					operator: choice(optionFor(questions, 'operator', 'greater_than'), { [optionFor(questions, 'operator', 'greater_than')]: 0.9 }),
					value: choice(optionFor(questions, 'value', 'lots'), { [optionFor(questions, 'value', 'lots')]: 0.9 }),
				};
			}
			return { wants_specific: noul(0.1) };
		};
		const out = await plan(decide, schema, 'orders over lots');
		expect(out.plan.filter).toBeUndefined();
		expect(out.warnings.join(' ')).toMatch(/not a number/);
	});
});

describe('helpers', () => {
	// Tokens include the useful pieces and skip stopwords
	it('tokenCandidates', () => {
		const got = tokenCandidates('customers in Portland who joined after 2026-01-01 and spent over 100');
		expect(got).toContain('2026-01-01');
		expect(got).toContain('100');
		expect(got).toContain('Portland');
		expect(got).not.toContain('who');
	});

	// Specific but nothing over the floor gives the best column
	it('selectedColumns picks the best when specific', () => {
		const t = schema.tables[0];
		expect(selectedColumns({ wants_specific: noul(0.2) }, t, 0.5)).toEqual([]);
		expect(selectedColumns({ wants_specific: noul(0.9), col_customer: noul(0.4), col_total: noul(0.2) }, t, 0.5)).toEqual(['customer']);
	});
});
