import type { Plan, Schema, Table } from '../types';

// The slice of Prisma's DMMF this adapter reads
interface DMMFLike {
	datamodel: { models: Array<{ name: string; documentation?: string; fields: Array<{ name: string; type: string; kind: string; isList: boolean; documentation?: string }> }> };
}

// Scalar types that take none of the operators, left out of the schema
const SKIPPED_TYPES = new Set(['Json', 'Bytes']);

/**
 * fromPrisma
 * Builds a JevQuery schema from Prisma's DMMF, scalar fields only, doc comments become descriptions
 * @param dmmf {DMMFLike} - Prisma.dmmf
 * @param context {string | undefined} - shared facts every question can see
 * @return {Schema}
 **/
export function fromPrisma(dmmf: DMMFLike, context?: string): Schema {
	const tables: Table[] = dmmf.datamodel.models.map((m) => ({
		name: m.name,
		description: m.documentation,
		columns: m.fields
			.filter((f) => f.kind === 'scalar' && !f.isList && !SKIPPED_TYPES.has(f.type))
			.map((f) => ({ name: f.name, type: fieldType(f.type), description: f.documentation })),
	}));
	return { context, tables };
}

/**
 * fieldType
 * Maps a Prisma scalar type to a JevQuery column kind
 * @param type {string} - the Prisma type
 * @return {'text' | 'number' | 'date' | 'bool'}
 **/
function fieldType(type: string): 'text' | 'number' | 'date' | 'bool' {
	if (['Int', 'Float', 'Decimal', 'BigInt'].includes(type)) return 'number';
	if (type === 'Boolean') return 'bool';
	if (type === 'DateTime') return 'date';
	return 'text';
}

// The findMany arguments this adapter produces
export interface PrismaFindMany {
	select?: Record<string, true>;
	where?: Record<string, unknown>;
	orderBy?: Record<string, 'asc' | 'desc'>;
	take: number;
}

// The knobs on toPrisma
export interface PrismaOptions {
	// Compare text ignoring case, only postgres, cockroach and mongo take mode insensitive, default false
	caseInsensitive?: boolean;
}

/**
 * dayRange
 * Gives the utc start of a date and the start of the next day, so a date compares as a whole day
 * @param v {string} - the date as YYYY-MM-DD
 * @return {{ start: Date; next: Date }}
 **/
function dayRange(v: string): { start: Date; next: Date } {
	const start = new Date(`${v}T00:00:00.000Z`);
	const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
	return { start, next };
}

/**
 * toPrisma
 * Turns a plan into findMany arguments, call prisma[model].findMany(args) yourself, the model is plan.table
 * @param plan {Plan} - the plan
 * @param options {PrismaOptions} - the knobs
 * @return {PrismaFindMany}
 **/
export function toPrisma(plan: Plan, options: PrismaOptions = {}): PrismaFindMany {
	if (!Number.isSafeInteger(plan.limit) || plan.limit < 1) throw new Error(`limit must be a positive whole number, got ${String(plan.limit)}`);
	const args: PrismaFindMany = { take: plan.limit };
	if (plan.columns.length > 0) args.select = Object.fromEntries(plan.columns.map((c) => [c, true]));
	if (plan.filter) {
		const v = plan.filter.value;
		const op = plan.filter.operator;
		const isDate = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
		const mode = options.caseInsensitive && typeof v === 'string' && !isDate ? { mode: 'insensitive' } : {};
		let cond: unknown;
		if (isDate) {
			// A date is a whole day, after means from the next day on, before means up to the day's start
			const { start, next } = dayRange(v as string);
			const byOp: Record<string, unknown> = { equals: { gte: start, lt: next }, after: { gte: next }, greater_than: { gte: next }, before: { lt: start }, less_than: { lt: start }, at_least: { gte: start }, at_most: { lt: next } };
			cond = byOp[op];
		} else {
			const byOp: Record<string, unknown> = {
				equals: { equals: v, ...mode },
				contains: { contains: v, ...mode },
				starts_with: { startsWith: v, ...mode },
				greater_than: { gt: v },
				after: { gt: v },
				less_than: { lt: v },
				before: { lt: v },
				at_least: { gte: v },
				at_most: { lte: v },
			};
			cond = byOp[op];
		}
		if (cond === undefined) throw new Error(`unknown operator "${String(op)}"`);
		args.where = { [plan.filter.column]: cond };
	}
	if (plan.orderBy) args.orderBy = { [plan.orderBy.column]: plan.orderBy.descending ? 'desc' : 'asc' };
	return args;
}
