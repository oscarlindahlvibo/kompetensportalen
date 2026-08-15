import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { courses, discountCodes, priceRules } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import DiscountManager from "@/app/admin/rabatter/discount-manager";
import PriceRuleManager from "@/app/admin/rabatter/price-rule-manager";
import { parseCourseIds } from "@/lib/platform";
export const dynamic = "force-dynamic";
export default async function DiscountsPage() { const identity = await requireChatGPTUser("/admin/rabatter"); const db = getDb(); const actor = await ensureDbUser(db, identity); requirePermission(actor.role, "course:read"); const [rows, courseRows, ruleRows] = await Promise.all([db.select().from(discountCodes).orderBy(discountCodes.code), db.select({ id: courses.id, name: courses.name }).from(courses).orderBy(courses.name), db.select().from(priceRules)]); return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Försäljning</p><h1>Priser som<br />går att styra.</h1><p>Skapa rabattkoder och mängdregler med server-side prisberäkning.</p></section><DiscountManager initialCourses={courseRows} initialCodes={rows.map((code) => ({ id: code.id, code: code.code, type: code.type, value: code.value, uses: code.uses, maxUses: code.maxUses, active: code.active, startsAt: code.startsAt, endsAt: code.endsAt, courseIds: parseCourseIds(code.courseIdsJson) }))} /><PriceRuleManager initialCourses={courseRows} initialRules={ruleRows} /></PageShell>; }
