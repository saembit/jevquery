import { OPERATORS } from './questions';
import type { Plan, Schema } from './types';

// The sql for each operator, the value is always the single parameter
const OPERATOR_SQL: Record<string, string> = {
	equals: '= ?',
	contains: "LIKE ? ESCAPE '\\'",
	starts_with: "LIKE ? ESCAPE '\\'",
	greater_than: '> ?',
	less_than: '< ?',
	at_least: '>= ?',
	at_most: '<= ?',
	after: '> ?',
	before: '< ?',
};

// Only an identifier that matches this ever reaches the sql
const SAFE_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * toSQL
 * Builds a parameterized SELECT from a plan, every identifier rechecked against the schema, ? or $n placeholders
 * @param schema {Schema} - the schema
 * @param plan {Plan} - the plan
 * @param placeholder {'?' | '$'} - the placeholder style, $ gives $1 $2 for postgres
 * @return {{ sql: string; params: Array<string | number | boolean> }}
 **/
export function toSQL(schema: Schema, plan: Plan, placeholder: '?' | '$' = '?'): { sql: string; params: Array<string | number | boolean> } {
	const table = schema.tables.find((t) => t.name === plan.table);
	if (!table || !SAFE_IDENT.test(table.name)) throw new Error(`unknown table "${plan.table}"`);
	const q = (id: string) => `"${id}"`;
	const col = (name: string) => {
		const c = table.columns.find((x) => x.name === name);
		if (!c || !SAFE_IDENT.test(name) || !Object.hasOwn(OPERATORS, c.type)) throw new Error(`unknown column "${name}"`);
		return c;
	};

	// The next placeholder, ? or $1 $2, made while emitting so nothing else is ever rewritten
	let n = 0;
	const ph = () => (placeholder === '$' ? `$${++n}` : '?');

	// The columns
	const cols = plan.columns.length > 0 ? plan.columns.map((c) => q(col(c).name)).join(', ') : '*';
	let sql = `SELECT ${cols} FROM ${q(table.name)}`;
	const params: Array<string | number | boolean> = [];

	// The filter
	if (plan.filter) {
		const c = col(plan.filter.column);
		if (!OPERATORS[c.type].includes(plan.filter.operator)) throw new Error(`operator "${plan.filter.operator}" not allowed on ${c.type} column "${c.name}"`);
		let value = plan.filter.value;
		if (typeof value === 'string' && plan.filter.operator === 'contains') value = `%${escapeLike(value)}%`;
		if (typeof value === 'string' && plan.filter.operator === 'starts_with') value = `${escapeLike(value)}%`;
		if (typeof value === 'boolean') value = value ? 1 : 0;
		sql += c.type === 'text' && plan.filter.operator === 'equals' ? ` WHERE LOWER(${q(c.name)}) = LOWER(${ph()})` : ` WHERE ${q(c.name)} ${OPERATOR_SQL[plan.filter.operator].replace('?', ph())}`;
		params.push(value);
	}

	// The order and cap
	if (plan.orderBy) sql += ` ORDER BY ${q(col(plan.orderBy.column).name)}${plan.orderBy.descending ? ' DESC' : ''}`;
	sql += ` LIMIT ${safeLimit(plan.limit)}`;
	return { sql, params };
}

/**
 * safeLimit
 * Checks a limit is a positive whole number, throws otherwise so NaN never reaches the sql
 * @param n {number} - the limit
 * @return {number}
 **/
export function safeLimit(n: number): number {
	if (!Number.isSafeInteger(n) || n < 1) throw new Error(`limit must be a positive whole number, got ${String(n)}`);
	return n;
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
