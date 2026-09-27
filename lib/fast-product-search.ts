import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { buildProductsWhere, type NormalizedProductsQuery } from "@/lib/product-filter-query";

const PRODUCT_FIELDS = new Set([
  "id", "title", "fullTitle", "storeId", "status", "asin", "ebayItemId",
  "internalNote", "price", "amazonPrice", "quantity", "amazonStockLeft",
  "priceCheckError", "lastPriceCheck", "createdAt", "errorMessage",
  "promotedAdStatus", "promotedAdRateStrategy", "promotedAdPercent", "promotedAdSyncedAt",
]);
const VARIANT_FIELDS = new Set([
  "id", "sku", "sellPrice", "buyPrice", "quantity", "feesPercent",
  "feesFixed", "automation",
]);
const HISTORY_FIELDS = new Set(["appliedAt"]);

type Row = Record<string, unknown>;

function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unsupported product search filter");
  }
  return value as Row;
}

function fieldSql(alias: "p" | "v" | "h", name: string) {
  const allowed = alias === "p" ? PRODUCT_FIELDS : alias === "v" ? VARIANT_FIELDS : HISTORY_FIELDS;
  if (!allowed.has(name)) throw new Error(`Unsupported product search field: ${name}`);
  // Prisma binds enum filter values as text in raw queries. Comparing the
  // enum column as text keeps the parameterized filter equivalent to Prisma.
  if (alias === "p" && ["status", "promotedAdStatus", "promotedAdRateStrategy"].includes(name)) {
    return Prisma.raw(`${alias}."${name}"::text`);
  }
  return Prisma.raw(`${alias}."${name}"`);
}

function containsPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function fieldCondition(column: Prisma.Sql, raw: unknown): Prisma.Sql {
  if (raw === null) return Prisma.sql`${column} IS NULL`;
  if (typeof raw !== "object" || Array.isArray(raw) || raw instanceof Date) {
    return Prisma.sql`${column} = ${raw as string | number | Date}`;
  }
  const value = record(raw);
  if ("path" in value) {
    const path = value.path;
    if (!Array.isArray(path) || path.length !== 1 || !["Brand", "brand"].includes(path[0])) {
      throw new Error("Unsupported product search JSON path");
    }
    const text = Prisma.sql`${column} ->> ${path[0]}`;
    const pattern = containsPattern(String(value.string_contains ?? ""));
    return value.mode === "insensitive"
      ? Prisma.sql`${text} ILIKE ${pattern}` : Prisma.sql`${text} LIKE ${pattern}`;
  }
  const parts: Prisma.Sql[] = [];
  for (const [op, operand] of Object.entries(value)) {
    if (op === "mode") continue;
    if (op === "not") parts.push(operand === null
      ? Prisma.sql`${column} IS NOT NULL` : Prisma.sql`${column} <> ${operand as string | number}`);
    else if (op === "in") parts.push(Prisma.sql`${column} IN (${Prisma.join(operand as string[])})`);
    else if (op === "gte") parts.push(Prisma.sql`${column} >= ${operand as number | Date}`);
    else if (op === "gt") parts.push(Prisma.sql`${column} > ${operand as number | Date}`);
    else if (op === "lte") parts.push(Prisma.sql`${column} <= ${operand as number | Date}`);
    else if (op === "lt") parts.push(Prisma.sql`${column} < ${operand as number | Date}`);
    else if (op === "equals") parts.push(Prisma.sql`${column} = ${operand as string | number}`);
    else if (op === "contains") {
      const pattern = containsPattern(String(operand));
      parts.push(value.mode === "insensitive"
        ? Prisma.sql`${column} ILIKE ${pattern}` : Prisma.sql`${column} LIKE ${pattern}`);
    } else throw new Error(`Unsupported product search operator: ${op}`);
  }
  return parts.length ? Prisma.sql`(${Prisma.join(parts, " AND ")})` : Prisma.sql`TRUE`;
}

function compileWhere(input: unknown, alias: "p" | "v" | "h" = "p"): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const [name, value] of Object.entries(record(input))) {
    if (name === "AND" || name === "OR") {
      const items = Array.isArray(value) ? value : [value];
      const predicates = items.map((item) => compileWhere(item, alias));
      parts.push(predicates.length
        ? Prisma.sql`(${Prisma.join(predicates, name === "AND" ? " AND " : " OR ")})`
        : Prisma.sql`${name === "AND"}`);
    } else if (name === "variants" || name === "priceHistory") {
      if (alias !== "p") throw new Error("Nested search relation is unsupported");
      const relation = record(value);
      const type = name === "variants" ? "v" : "h";
      const table = name === "variants" ? "Variant" : "PriceHistory";
      for (const [operator, nested] of Object.entries(relation)) {
        if (operator !== "some" && operator !== "none") throw new Error("Unsupported relation filter");
        const clause = compileWhere(nested, type);
        const exists = Prisma.sql`EXISTS (SELECT 1 FROM ${Prisma.raw(`"${table}"`)} ${Prisma.raw(type)} WHERE ${Prisma.raw(type)}."productId" = p."id" AND ${clause})`;
        parts.push(operator === "none" ? Prisma.sql`NOT (${exists})` : exists);
      }
    } else {
      parts.push(fieldCondition(name === "itemSpecifics"
        ? Prisma.raw(`${alias}."itemSpecifics"`) : fieldSql(alias, name), value));
    }
  }
  return parts.length ? Prisma.sql`(${Prisma.join(parts, " AND ")})` : Prisma.sql`TRUE`;
}

function matchedProducts(storeId: string, search: string) {
  const pattern = containsPattern(search);
  const branches: Prisma.Sql[] = [];
  const add = (table: "Product" | "Variant", expression: string, ranks: [number, number, number]) => {
    const column = Prisma.raw(expression);
    const from = table === "Product"
      ? Prisma.sql`"Product" p` : Prisma.sql`"Variant" v JOIN "Product" p ON p."id" = v."productId"`;
    branches.push(Prisma.sql`
      SELECT p."id" AS id,
        CASE WHEN lower(${column}) = lower(${search}) THEN ${ranks[0]}
             WHEN ${column} ILIKE ${`${search.replace(/[\\%_]/g, "\\$&")}%`} THEN ${ranks[1]}
             ELSE ${ranks[2]} END AS score
      FROM ${from}
      WHERE p."storeId" = ${storeId} AND p."status" IN ('IMPORTED', 'ON_HOLD')
        AND ${column} ILIKE ${pattern}`);
  };
  add("Product", 'p."id"', [0, 4, 4]);
  add("Product", 'p."asin"', [0, 4, 4]);
  add("Product", 'p."ebayItemId"', [0, 4, 4]);
  add("Product", 'p."title"', [1, 2, 5]);
  add("Product", 'p."fullTitle"', [3, 3, 6]);
  add("Product", 'p."internalNote"', [6, 6, 6]);
  add("Product", `p."itemSpecifics" ->> 'Brand'`, [6, 6, 6]);
  add("Product", `p."itemSpecifics" ->> 'brand'`, [6, 6, 6]);
  add("Variant", 'v."id"', [0, 4, 4]);
  add("Variant", 'v."sku"', [0, 4, 4]);
  add("Variant", `v."itemSpecifics" ->> 'Brand'`, [6, 6, 6]);
  add("Variant", `v."itemSpecifics" ->> 'brand'`, [6, 6, 6]);
  return Prisma.sql`WITH matches AS (
    SELECT id, MIN(score) AS score FROM (${Prisma.join(branches, " UNION ALL ")}) hits GROUP BY id
  )`;
}

function profitExpression(alias: string) {
  const row = Prisma.raw(alias);
  return Prisma.sql`ROUND(GREATEST(${row}."sellPrice", 0) - GREATEST(${row}."buyPrice", 0) -
    ROUND(GREATEST(${row}."sellPrice", 0) * GREATEST(${row}."feesPercent"::numeric, 0) / 100 +
      GREATEST(${row}."feesFixed"::numeric, 0), 2), 2)`;
}

function profitFilter(query: NormalizedProductsQuery): Prisma.Sql {
  if (query.profitMin === null && query.profitMax === null) return Prisma.sql`TRUE`;
  const value = profitExpression("v");
  const bounds = (profit: Prisma.Sql) => Prisma.sql`${query.profitMin === null ? Prisma.sql`TRUE` : Prisma.sql`${profit} >= ${query.profitMin}`} AND
    ${query.profitMax === null ? Prisma.sql`TRUE` : Prisma.sql`${profit} <= ${query.profitMax}`}`;
  const fallback = Prisma.sql`ROUND(GREATEST(p."price", 0) - GREATEST(p."amazonPrice", 0), 2)`;
  return Prisma.sql`(EXISTS (SELECT 1 FROM "Variant" v WHERE v."productId" = p."id" AND ${bounds(value)}) OR
    (NOT EXISTS (SELECT 1 FROM "Variant" v WHERE v."productId" = p."id") AND p."amazonPrice" IS NOT NULL AND ${bounds(fallback)}))`;
}

function orderBy(query: NormalizedProductsQuery): Prisma.Sql {
  if (!query.sortBy) return Prisma.sql`m.score ASC, p."updatedAt" DESC, p."id" ASC`;
  const direction = Prisma.raw(query.sortOrder === "asc" ? "ASC" : "DESC");
  const sortValues: Record<string, Prisma.Sql> = {
    price: Prisma.sql`COALESCE((SELECT MIN(v."sellPrice") FROM "Variant" v WHERE v."productId" = p."id"), p."price")`,
    profit: Prisma.sql`COALESCE((SELECT MIN(${profitExpression("v")}) FROM "Variant" v WHERE v."productId" = p."id"), ROUND(GREATEST(p."price", 0) - GREATEST(p."amazonPrice", 0), 2))`,
    sold: Prisma.sql`COALESCE(p."quantitySold", 0)`,
    views: Prisma.sql`p."ebayViewCount"`,
    uploaded: Prisma.sql`COALESCE((SELECT MAX(u."createdAt") FROM "UploadLog" u WHERE u."productId" = p."id" AND u."status" = 'SUCCESS'), CASE WHEN p."ebayItemId" IS NOT NULL AND btrim(p."ebayItemId") <> '' THEN p."createdAt" END)`,
  };
  const sort = sortValues[query.sortBy];
  if (!sort) throw new Error("Unsupported product sort");
  return Prisma.sql`${sort} ${direction} NULLS LAST, p."createdAt" DESC, p."id" ASC`;
}

export async function getFastProductSearchPage(input: {
  storeId: string;
  query: NormalizedProductsQuery;
  minimumProductQuantity: number;
  take: number;
  skip: number;
  includeCount?: boolean;
}) {
  const { storeId, query, minimumProductQuantity, take, skip, includeCount = true } = input;
  const cte = matchedProducts(storeId, query.searchQuery);
  const filters = compileWhere(buildProductsWhere(storeId, { ...query, searchQuery: "" }, minimumProductQuantity));
  const filter = Prisma.sql`${filters} AND ${profitFilter(query)}`;
  if (!includeCount) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`${cte}
      SELECT p."id" FROM matches m JOIN "Product" p ON p."id" = m.id
      WHERE ${filter} ORDER BY ${orderBy(query)} LIMIT ${take} OFFSET ${skip}`;
    return { totalCount: 0, ids: rows.map((row) => row.id) };
  }
  const rows = await prisma.$queryRaw<Array<{ count: number; id: string | null }>>`${cte},
    filtered AS (SELECT m.id, m.score FROM matches m JOIN "Product" p ON p."id" = m.id WHERE ${filter}),
    counted AS (SELECT COUNT(*)::int AS count FROM filtered),
    paged AS (SELECT p."id" FROM filtered m JOIN "Product" p ON p."id" = m.id
      ORDER BY ${orderBy(query)} LIMIT ${take} OFFSET ${skip})
    SELECT counted.count, paged.id FROM counted LEFT JOIN paged ON TRUE`;
  return { totalCount: rows[0]?.count ?? 0, ids: rows.flatMap((row) => row.id ? [row.id] : []) };
}
