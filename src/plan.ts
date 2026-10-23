import type { StandardSchemaV1 } from '@standard-schema/spec';

import { buildFilter, buildPick, buildSelect, NONE, OPERATORS, pickedValue, selectedColumns } from './questions';
import type { Column, Decider, Filter, Operator, Plan, PlanOptions, Planned, Schema, Table } from './types';

/**
 * validateSchema
 * Checks every identifier is clean and unique, throws otherwise
 * @param schema {Schema} - the schema
 **/
export function validateSchema(schema: Schema): void {
	const ident = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
	if (schema.tables.length === 0) throw new Error('schema has no tables');
	const seen = new Set<string>();
	for (const t of schema.tables) {
		if (!ident.test(t.name)) throw new Error(`table "${t.name}": bad name`);
		if (seen.has(t.name)) throw new Error(`table "${t.name}": duplicate name`);
		seen.add(t.name);
		if (t.columns.length === 0) throw new Error(`table "${t.name}": no columns`);
		const cols = new Set<string>();
		for (const c of t.columns) {
			if (!ident.test(c.name)) throw new Error(`table "${t.name}": column "${c.name}": bad name`);
			if (cols.has(c.name)) throw new Error(`table "${t.name}": column "${c.name}": duplicate name`);
			cols.add(c.name);
			if (!Object.hasOwn(OPERATORS, c.type)) throw new Error(`table "${t.name}": column "${c.name}": type must be text, number, date or bool`);
		}
	}
}

/**
 * typedValue
 * Turns the picked text into the value the column takes, throws when it can't
 * @param column {Column} - the column
 * @param raw {string} - the picked text
 * @return {string | number | boolean}
 **/
export function typedValue(column: Column, raw: string): string | number | boolean {
	const v = raw.trim();
	switch (column.type) {
		case 'number': {
			const n = Number(v);
			if (!Number.isFinite(n)) throw new Error(`value "${raw}" is not a number`);
			return n;
		}
		case 'bool': {
			if (['true', 'yes', 'on', '1'].includes(v.toLowerCase())) return true;
			if (['false', 'no', 'off', '0'].includes(v.toLowerCase())) return false;
			throw new Error(`value "${raw}" is not a bool`);
		}
		case 'date': {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new Error(`value "${raw}" is not a date like 2026-01-31`);
			return v;
		}
		default:
			return raw;
	}
}

/**
 * runStandard
 * Runs a Standard Schema validator and throws its issues as one error
 * @param schema {StandardSchemaV1} - the validator
 * @param value {unknown} - the value
 * @param what {string} - what is being checked, for the error
 * @return {Promise<unknown>}
 **/
async function runStandard(schema: StandardSchemaV1, value: unknown, what: string): Promise<unknown> {
	const result = await schema['~standard'].validate(value);
	if (result.issues && result.issues.length > 0) throw new Error(`${what} rejected: ${result.issues.map((i) => i.message).join('; ')}`);
	if (result.issues) return value;
	return result.value;
}

/**
 * validatePlan
 * Checks a plan against the schema, the table and columns exist, the operator fits the column, the limit is a whole number under the cap
 * @param schema {Schema} - the schema
 * @param p {Plan} - the plan
 * @param maxLimit {number} - the most rows allowed
 **/
export function validatePlan(schema: Schema, p: Plan, maxLimit: number): void {
	const table = schema.tables.find((t) => t.name === p.table);
	if (!table) throw new Error(`plan names unknown table "${p.table}"`);
	const col = (name: string): Column => {
		const c = table.columns.find((x) => x.name === name);
		if (!c) throw new Error(`plan names unknown column "${name}"`);
		return c;
	};
	for (const c of p.columns) col(c);
	if (p.filter) {
		const c = col(p.filter.column);
		if (!OPERATORS[c.type].includes(p.filter.operator)) throw new Error(`plan uses operator "${p.filter.operator}" on ${c.type} column "${c.name}"`);
		const v = p.filter.value;
		if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new Error('plan filter value must be a string, number or boolean');
	}
	if (p.orderBy) col(p.orderBy.column);
	if (!Number.isSafeInteger(p.limit) || p.limit < 1 || p.limit > maxLimit) throw new Error(`plan limit must be a whole number from 1 to ${maxLimit}`);
}

/**
 * plan
 * Turns a sentence into a typed plan in three requests, which table, the filter and order, the columns
 * @param decide {Decider} - the function that asks Jev
 * @param schema {Schema} - the schema
 * @param input {string} - the sentence
 * @param options {PlanOptions} - the knobs
 * @return {Promise<Planned>}
 **/
export async function plan(decide: Decider, schema: Schema, input: string, options: PlanOptions = {}): Promise<Planned> {
	validateSchema(schema);
	const floor = options.floor ?? 0.35;
	const argFloor = options.argFloor ?? 0.5;
	const defaultLimit = options.defaultLimit ?? 50;
	const maxLimit = options.maxLimit ?? 500;
	for (const [k, v] of Object.entries({ floor, argFloor, defaultLimit, maxLimit })) {
		if (!Number.isFinite(v) || v < 0) throw new Error(`option ${k} must be a number, got ${String(v)}`);
	}
	const warnings: string[] = [];

	// Which table
	const pick = buildPick(schema, input);
	const pickAnswers = await decide(pick.state, pick.questions);
	const probs = pickAnswers.pick?.probabilities ?? {};
	const probOf = (k: string) => (Object.hasOwn(probs, k) && typeof probs[k] === 'number' ? probs[k] : 0);
	const ranked = schema.tables.map((t) => ({ table: t.name, probability: probOf(t.name) })).sort((a, b) => b.probability - a.probability || a.table.localeCompare(b.table));
	const none = probOf(NONE);
	if (ranked.length === 0 || ranked[0].probability < floor || ranked[0].probability <= none) {
		throw new Error(`no table fits the sentence well enough (best ${ranked[0]?.probability.toFixed(2) ?? '0'}, none ${none.toFixed(2)})`);
	}
	const table = schema.tables.find((t) => t.name === ranked[0].table) as Table;

	// The filter, order and limit, and the columns, two independent requests at once
	const filterReq = buildFilter(table, input, schema.context);
	const selectReq = buildSelect(table, input, schema.context);
	const [filterAnswers, selectAnswers] = await Promise.all([
		Object.keys(filterReq.questions).length > 0 ? decide(filterReq.state, filterReq.questions) : Promise.resolve({}),
		decide(selectReq.state, selectReq.questions),
	]);
	const get = (name: string) => pickedValue(filterAnswers, name, filterReq.candidates[name] ?? [], argFloor);

	// The filter only counts whole, a partial one is reported
	let filter: Filter | undefined;
	const fc = get('filter_column');
	const op = get('operator') as Operator | undefined;
	const raw = get('value');
	if (fc && op && raw !== undefined) {
		const column = table.columns.find((c) => c.name === fc) as Column;
		if (!OPERATORS[column.type].includes(op)) {
			warnings.push(`filter dropped, operator "${op}" does not fit ${column.type} column "${fc}"`);
		} else {
			try {
				let value = typedValue(column, raw);
				if (options.valueSchemas && Object.hasOwn(options.valueSchemas, fc)) {
					const checked = await runStandard(options.valueSchemas[fc], value, `value for ${fc}`);
					if (typeof checked !== 'string' && typeof checked !== 'number' && typeof checked !== 'boolean') throw new Error(`value for ${fc} rejected: validator returned something that is not a string, number or boolean`);
					value = checked;
				}
				filter = { column: fc, operator: op, value };
			} catch (err) {
				if (/rejected/.test((err as Error).message)) throw err;
				warnings.push(`filter dropped, ${(err as Error).message}`);
			}
		}
	} else if (fc || op || raw !== undefined) {
		warnings.push(`filter dropped, only part of it was found (column "${fc ?? ''}" operator "${op ?? ''}" value "${raw ?? ''}")`);
	}

	// The order
	const oc = get('order_column');
	const orderBy = oc ? { column: oc, descending: get('order_dir') === 'descending' } : undefined;

	// The cap, a limit the sentence gave that isn't a whole positive number is reported
	const rawLimit = get('limit');
	const asked = rawLimit === undefined ? undefined : Number(rawLimit);
	let limit = defaultLimit;
	if (asked !== undefined && Number.isSafeInteger(asked) && asked > 0) limit = asked;
	else if (asked !== undefined) warnings.push(`limit "${rawLimit}" ignored, not a whole positive number`);
	if (limit > maxLimit) {
		warnings.push(`limit ${limit} cut to ${maxLimit}`);
		limit = maxLimit;
	}

	// The plan, through the caller's validator when they gave one, then checked again since a validator can transform it
	let built: Plan = { table: table.name, columns: selectedColumns(selectAnswers, table, argFloor), filter, orderBy, limit };
	if (options.planSchema) built = (await runStandard(options.planSchema, built, 'plan')) as Plan;
	validatePlan(schema, built, maxLimit);
	return { plan: built, ranked, none, warnings };
}
