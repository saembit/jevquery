import type { Answer, Column, ColumnType, Operator, Question, Schema, Table } from './types';

// The option that means nothing fits
export const NONE = 'none';

// The operators each column kind takes
export const OPERATORS: Record<ColumnType, Operator[]> = {
	text: ['equals', 'contains', 'starts_with'],
	number: ['equals', 'greater_than', 'less_than', 'at_least', 'at_most'],
	date: ['equals', 'after', 'before'],
	bool: ['equals'],
};

/**
 * buildPick
 * Makes the state and the one choice over the tables plus none
 * @param schema {Schema} - the schema
 * @param input {string} - the sentence
 * @return {{ state: unknown; questions: Record<string, Question> }}
 **/
export function buildPick(schema: Schema, input: string): { state: unknown; questions: Record<string, Question> } {
	// Each table as Jev sees it
	const listed: Record<string, string> = {};
	for (const t of schema.tables) {
		listed[t.name] = `${t.description ?? t.name}. Columns: ${t.columns.map((c) => c.name).join(', ')}`;
	}
	const options: Record<string, string | null> = { ...listed, [NONE]: 'No table holds what the sentence asks about' };
	const state: Record<string, unknown> = { sentence: input, tables: listed };
	if (schema.context) state.context = schema.context;
	return {
		state,
		questions: {
			pick: { type: 'choice', instructions: 'Which entry in `tables` holds the rows `sentence` is asking about?', criteria: options },
		},
	};
}

/**
 * buildFilter
 * Makes the state and the choices for the filter column, operator, value, order column, direction and limit, one request
 * @param table {Table} - the table
 * @param input {string} - the sentence
 * @param context {string | undefined} - the schema context
 * @return {{ state: unknown; questions: Record<string, Question>; candidates: Record<string, string[]> }}
 **/
export function buildFilter(table: Table, input: string, context?: string): { state: unknown; questions: Record<string, Question>; candidates: Record<string, string[]> } {
	// The candidates per argument
	const cols = table.columns.map((c) => c.name);
	const ops = [...new Set(table.columns.flatMap((c) => OPERATORS[c.type]))];
	const candidates: Record<string, string[]> = {
		filter_column: cols,
		operator: ops,
		value: tokenCandidates(input),
		order_column: cols,
		order_dir: ['ascending', 'descending'],
		limit: numberCandidates(input),
	};

	// The descriptions
	const what: Record<string, string> = {
		filter_column: 'the column the rows are filtered on',
		operator: 'how the filter column is compared to the value',
		value: 'the value the filter column is compared to, a number, a date, a name, a word from the sentence',
		order_column: 'the column the rows are sorted by',
		order_dir: 'the sort direction',
		limit: 'how many rows at most',
	};

	// One numbered choice per argument that has candidates
	const questions: Record<string, Question> = {};
	for (const [name, list] of Object.entries(candidates)) {
		if (list.length === 0) continue;
		const options: Record<string, string | null> = {};
		list.forEach((v, i) => (options[String(i + 1)] = v));
		options[NONE] = 'The sentence does not say';
		questions[name] = {
			type: 'choice',
			instructions: { argument: what[name], question: `Which candidate in \`candidates.${name}\` is the value of this argument in \`sentence\`, for looking up rows in ${table.description ?? table.name}?` },
			criteria: options,
		};
	}

	// The state
	const columns: Record<string, string> = {};
	for (const c of table.columns) columns[c.name] = c.description ?? c.type;
	const state: Record<string, unknown> = { sentence: input, table: table.description ?? table.name, columns, candidates };
	if (context) state.context = context;
	return { state, questions, candidates };
}

/**
 * buildSelect
 * Makes one yes/no per column asking whether the sentence wants it back, plus whether it was specific at all
 * @param table {Table} - the table
 * @param input {string} - the sentence
 * @param context {string | undefined} - the schema context
 * @return {{ state: unknown; questions: Record<string, Question> }}
 **/
export function buildSelect(table: Table, input: string, context?: string): { state: unknown; questions: Record<string, Question> } {
	const columns: Record<string, string> = {};
	for (const c of table.columns) columns[c.name] = c.description ?? c.type;
	const state: Record<string, unknown> = { sentence: input, table: table.description ?? table.name, columns };
	if (context) state.context = context;
	const questions: Record<string, Question> = {
		wants_specific: { type: 'noul', instructions: 'Does `sentence` ask for particular columns rather than everything about the rows?' },
	};
	for (const c of table.columns) {
		questions[`col_${c.name}`] = { type: 'noul', instructions: `Does \`sentence\` ask to see \`columns.${c.name}\` specifically?` };
	}
	return { state, questions };
}

/**
 * pickedValue
 * Reads a numbered choice back into its candidate, undefined for none or under the floor
 * @param answers {Record<string, Answer>} - the answers
 * @param name {string} - the argument
 * @param candidates {string[]} - its candidates
 * @param floor {number} - the probability the pick needs
 * @return {string | undefined}
 **/
export function pickedValue(answers: Record<string, Answer>, name: string, candidates: string[], floor: number): string | undefined {
	const a = answers[name];
	if (!a || !a.choice || a.choice === NONE || !/^[1-9]\d*$/.test(a.choice)) return undefined;
	const idx = Number(a.choice);
	const p = a.probabilities && Object.hasOwn(a.probabilities, a.choice) ? a.probabilities[a.choice] : 0;
	if (idx > candidates.length || p < floor) return undefined;
	return candidates[idx - 1];
}

/**
 * selectedColumns
 * Turns the select nouls into the columns to return, empty for all, the best one when specific but nothing cleared the floor
 * @param answers {Record<string, Answer>} - the answers
 * @param table {Table} - the table
 * @param floor {number} - the probability a column needs
 * @return {string[]}
 **/
export function selectedColumns(answers: Record<string, Answer>, table: Table, floor: number): string[] {
	if ((answers.wants_specific?.noul ?? 0) < floor) return [];
	const out: string[] = [];
	let best: Column | undefined;
	let bestP = -1;
	for (const c of table.columns) {
		const p = answers[`col_${c.name}`]?.noul;
		if (p === undefined) continue;
		if (p >= floor) out.push(c.name);
		if (p > bestP) (best = c), (bestP = p);
	}
	if (out.length === 0 && best) return [best.name];
	return out;
}

// Words that are never a value on their own
const STOPWORDS = new Set(
	'the a an and or of in on at to for with by from is are was were be me my all show list find get give who what which where when how many most more less than over under about every everything please first last top any anyone some that this'.split(' '),
);

/**
 * tokenCandidates
 * Gives the dates, numbers, quoted spans, words and two word spans in the sentence
 * @param input {string} - the sentence
 * @return {string[]}
 **/
export function tokenCandidates(input: string): string[] {
	const out: string[] = [];
	out.push(...(input.match(/\d{4}-\d{2}-\d{2}/g) ?? []));
	out.push(...(input.match(/-?\d+(?:\.\d+)?/g) ?? []));
	for (const m of input.matchAll(/"([^"]+)"|'([^']+)'/g)) out.push(m[1] ?? m[2]);
	const words = input.match(/[A-Za-z][A-Za-z'_-]+/g) ?? [];
	out.push(...words.filter((w) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase())));
	for (let i = 0; i + 1 < words.length; i++) {
		if (!STOPWORDS.has(words[i].toLowerCase()) && !STOPWORDS.has(words[i + 1].toLowerCase())) out.push(`${words[i]} ${words[i + 1]}`);
	}
	return [...new Set(out.filter((v) => v !== ''))].slice(0, 60);
}

/**
 * numberCandidates
 * Gives the numbers in the sentence
 * @param input {string} - the sentence
 * @return {string[]}
 **/
export function numberCandidates(input: string): string[] {
	return [...new Set(input.match(/-?\d+(?:\.\d+)?/g) ?? [])];
}
