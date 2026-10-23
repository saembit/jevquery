# jevquery

[img](path)

A sentence becomes a typed query plan your ORM runs

# TOC
- [About](#about)
- [Install](#install)
- [Usage](#usage)
- [Drizzle](#drizzle)
- [Prisma](#prisma)
- [tRPC](#trpc)
- [Validators](#validators)
- [Plain SQL](#plain-sql)
- [Todo](#todo)

# About

JevQuery turns a sentence like "orders over 100 dollars, biggest first" into a plan, which table, which column is filtered how against what value, which columns come back, the order and the cap, by asking Jev to pick each part from what the schema offers. Jev is the TypeSafe model that gives back a probability for each answer you define instead of writing text, so it can choose a column but it can never write a query, and the plan is just data that Drizzle, Prisma or a SQL builder turns into a real query with every identifier checked against the schema and the value bound as a parameter. Three requests per sentence, about a thousandth of a cent. This is the TypeScript version of the query half of jeff-act. It may not be perfect but it's better than nothing.

Not affiliated with TypeSafe, Drizzle or Prisma.

# Install

```bash
npm install jevquery
```

# Usage

```ts
import { plan, typesafeDecider } from 'jevquery';

const decide = typesafeDecider(process.env.TYPESAFE_API_KEY);
const schema = {
  context: 'An online shop. Money is in dollars.',
  tables: [
    { name: 'orders', description: 'orders placed by customers', columns: [
      { name: 'id', type: 'number' },
      { name: 'total', type: 'number', description: 'the order total in dollars' },
      { name: 'status', type: 'text', description: 'pending, shipped, delivered or refunded' },
      { name: 'placed_at', type: 'date' },
    ] },
  ],
};

const { plan: p, warnings } = await plan(decide, schema, 'orders over 100 dollars, biggest first');
// p = { table: 'orders', columns: [], filter: { column: 'total', operator: 'greater_than', value: 100 }, orderBy: { column: 'total', descending: true }, limit: 50 }
```

Column types are text, number, date and bool and they decide which operators Jev is offered and how the value is typed, a text equals is case insensitive, contains and starts_with escape the LIKE wildcards, dates have to look like 2026-01-31. A filter that was only half found comes back as a warning instead of being dropped quietly, a limit over maxLimit (500) is cut and reported. The decider is just a function from state and questions to answers so a proxy, a cache or a test double can stand in for the api, keep the key on the server.

# Drizzle

```ts
import { fromDrizzle, toDrizzle } from 'jevquery/drizzle';

const tables = { orders, customers };
const schema = fromDrizzle(tables, { orders: { table: 'customer orders', columns: { total: 'dollars' } } }, 'a shop');
const { plan: p } = await plan(decide, schema, 'customers in portland');
const rows = await toDrizzle(db, tables, p);
```

fromDrizzle reads the columns and their kinds off the table objects, the descriptions are yours to add since drizzle doesn't carry them, and types lets you say a column is a date when the database keeps it as text, { orders: { types: { placedAt: 'date' } } }, otherwise after and before are never offered on it. toDrizzle builds the select with eq, gt, like and friends, the identifiers are the table objects' own so nothing from the sentence is ever a name.

# Prisma

```ts
import { Prisma } from '@prisma/client';
import { fromPrisma, toPrisma } from 'jevquery/prisma';

const schema = fromPrisma(Prisma.dmmf, 'a shop');
const { plan: p } = await plan(decide, schema, 'orders over 100');
const rows = await prisma[p.table].findMany(toPrisma(p));
```

fromPrisma reads the scalar fields off the DMMF, Json and Bytes left out, doc comments in schema.prisma become the descriptions. toPrisma gives findMany arguments, a date filter covers the whole day in UTC so after 2026-01-01 means from the 2nd on, and text compares case sensitively unless you pass { caseInsensitive: true }, which only postgres, cockroach and mongo accept.

# tRPC

A procedure is just the plan and the adapter behind an input validator, the sentence is the only input.

```ts
const router = t.router({
  ask: t.procedure.input(z.object({ sentence: z.string().max(300) })).query(async ({ input }) => {
    const { plan: p, warnings } = await plan(decide, schema, input.sentence, { maxLimit: 100 });
    return { rows: await toDrizzle(db, tables, p), plan: p, warnings };
  }),
});
```

# Validators

Anything that implements Standard Schema works, zod 3.24 and up, valibot, arktype, etc. valueSchemas runs a validator on the typed filter value per column before it is used, planSchema runs one on the whole plan last, so you can refuse a negative total, a limit over 20 or a table you don't want exposed without jevquery knowing about your validator.

```ts
import { z } from 'zod';

await plan(decide, schema, sentence, {
  valueSchemas: { total: z.number().nonnegative() },
  planSchema: z.object({ table: z.enum(['orders']), limit: z.number().max(20) }).passthrough(),
});
```

# Plain SQL

```ts
import { toSQL } from 'jevquery';

const { sql, params } = toSQL(schema, p, '$');   // $1 style for postgres, ? by default
```

toSQL writes postgres and sqlite flavoured sql, double quoted identifiers and a backslash ESCAPE on LIKE, mysql wants backticks and treats the backslash differently so use the drizzle or prisma adapter there. The adapters live on subpaths, jevquery/drizzle and jevquery/prisma, so the core never pulls an orm in.

# Todo

- [ ] Add the image
- [ ] Joins through relations, drizzle and prisma both know them
- [ ] More than one filter
- [ ] Date words like yesterday and last week resolved in code
- [ ] Kysely and knex adapters
