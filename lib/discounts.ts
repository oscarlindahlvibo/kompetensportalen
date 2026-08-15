import { mutationChanges } from "@/lib/db-compat";
import { and, eq, sql } from "drizzle-orm";
import { discountCodes } from "@/db/schema";
import { getDb } from "@/db";

type Database = ReturnType<typeof getDb>;

// Supabase Postgres is the source of truth for reservations. The conditional update makes
// simultaneous checkouts compete for the same remaining usage atomically.
export async function reserveDiscountUse(
  db: Database,
  discountCodeId: string,
): Promise<boolean> {
  const result = await db
    .update(discountCodes)
    .set({ reservedUses: sql`${discountCodes.reservedUses} + 1` })
    .where(
      and(
        eq(discountCodes.id, discountCodeId),
        eq(discountCodes.active, true),
        sql`(${discountCodes.maxUses} IS NULL OR ${discountCodes.uses} + ${discountCodes.reservedUses} < ${discountCodes.maxUses})`,
      ),
    )
    ;
  return (mutationChanges(result) ?? 0) === 1;
}

export async function releaseDiscountUse(db: Database, discountCodeId: string) {
  await db
    .update(discountCodes)
    .set({ reservedUses: sql`MAX(${discountCodes.reservedUses} - 1, 0)` })
    .where(
      and(
        eq(discountCodes.id, discountCodeId),
        sql`${discountCodes.reservedUses} > 0`,
      ),
    )
    ;
}

export async function consumeReservedDiscountUse(
  db: Database,
  discountCodeId: string,
): Promise<boolean> {
  const result = await db
    .update(discountCodes)
    .set({
      uses: sql`${discountCodes.uses} + 1`,
      reservedUses: sql`MAX(${discountCodes.reservedUses} - 1, 0)`,
    })
    .where(
      and(
        eq(discountCodes.id, discountCodeId),
        sql`${discountCodes.maxUses} IS NULL OR ${discountCodes.uses} < ${discountCodes.maxUses}`,
      ),
    )
    ;
  return (mutationChanges(result) ?? 0) === 1;
}

export async function restoreConsumedDiscountUse(
  db: Database,
  discountCodeId: string,
) {
  await db
    .update(discountCodes)
    .set({
      uses: sql`MAX(${discountCodes.uses} - 1, 0)`,
      reservedUses: sql`${discountCodes.reservedUses} + 1`,
    })
    .where(eq(discountCodes.id, discountCodeId))
    ;
}
