import type { StandardSchemaV1 } from '@standard-schema/spec';

// The column kinds, they decide which operators are offered and how a value is typed
export type ColumnType = 'text' | 'number' | 'date' | 'bool';

// One column Jev may pick
export interface Column {
	// The column name as the database knows it
	name: string;
	// The kind
	type: ColumnType;
	// What it holds, shown to Jev
	description?: string;
}

// One table Jev may query
export interface Table {
	// The table name as the database knows it
	name: string;
	// What it holds, shown to Jev
	description?: string;
	// The columns
	columns: Column[];
}

// The whole list of what may be queried
export interface Schema {
	// Shared facts every question can see
	context?: string;
	// The tables
	tables: Table[];
}

// The operators, by name
export type Operator = 'equals' | 'contains' | 'starts_with' | 'greater_than' | 'less_than' | 'at_least' | 'at_most' | 'after' | 'before';

// A filter on one column
export interface Filter {
	// The column
	column: string;
	// The operator
	operator: Operator;
	// The value, typed for the column
	value: string | number | boolean;
}

// The typed parts a query is built from, every identifier checked against the schema
export interface Plan {
	// The table
	table: string;
	// The columns to return, all when empty
	columns: string[];
	// The filter, none when undefined
	filter?: Filter;
	// The order column, none when undefined
	orderBy?: { column: string; descending: boolean };
	// The row cap
	limit: number;
}

// One typed question in the TypeSafe api shape
export interface Question {
	type: 'noul' | 'choice' | 'score';
	instructions: unknown;
	criteria?: unknown;
}

// One typed answer
export interface Answer {
	type: string;
	noul?: number;
	choice?: string;
	probabilities?: Record<string, number>;
	confidence?: number;
}

// Anything that takes a state and questions and gives back answers
export type Decider = (state: unknown, questions: Record<string, Question>) => Promise<Record<string, Answer>>;

// The knobs on planning
export interface PlanOptions {
	// The probability the table pick needs, default 0.35
	floor?: number;
	// The probability an argument or column pick needs, default 0.5
	argFloor?: number;
	// The row cap when the sentence gives none, default 50
	defaultLimit?: number;
	// The most rows a sentence may ask for, default 500
	maxLimit?: number;
	// A Standard Schema validator per column for the filter value, zod, valibot, arktype, anything that implements the spec
	valueSchemas?: Record<string, StandardSchemaV1>;
	// A Standard Schema validator for the whole plan, run last
	planSchema?: StandardSchemaV1<Plan>;
}

// What planning produced
export interface Planned {
	// The plan
	plan: Plan;
	// Every table ranked, highest first
	ranked: Array<{ table: string; probability: number }>;
	// The probability nothing fit
	none: number;
	// Things the caller should know, such as a filter that was only half found
	warnings: string[];
}
