// ============================================================================
// Worker del muro de sesiones + ciclo de vida de la membresía.
// ----------------------------------------------------------------------------
// Tres pasadas por invocación:
//   A) Bloqueos cumplidos  → correo "ya puedes volver a estudiar".
//   B) Membresías a 3 días → recordatorio de renovación.
//   C) Membresías vencidas → aviso de fin.
//
// Auth y forma calcadas de src/app/api/route-jobs/worker/route.ts: Bearer
// CRON_SECRET comparado con timingSafeEqual, y SECRETO AUSENTE = denegar todo.
// Cron declarado en vercel.json (*/5 * * * *): para un bloqueo de 4 horas cinco
// minutos de resolución sobran, y cuesta 12× menos que los workers por minuto.
// ============================================================================
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendSessionUnlockedEmail } from "@/lib/email/sessionUnlocked";
import {
  sendMembershipReminderEmail,
  sendMembershipLapsedEmail,
} from "@/lib/email/membershipReminder";
import { renewalReminderDue, lapseNoticeDue } from "@/lib/sessionBudget";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 50;              // filas por pasada y por invocación
const REMINDER_DAYS_BEFORE = 3;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  const provided = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!secret) return false; // sin secreto configurado no se atiende a nadie
  return safeEqual(provided, secret);
}

function baseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** Enlace de vuelta a lo último que estaba consumiendo. */
function resumeUrlFor(
  base: string,
  kind: string | null,
  itemKey: string | null,
  routeId: string | null
): string {
  if (kind === "lesson" && itemKey) {
    // item_key = 'routeId:nodeId'. El nodeId puede contener ':'? No: son ids de
    // nodo del árbol. Se corta en el PRIMER ':' de todas formas por seguridad.
    const sep = itemKey.indexOf(":");
    const rid = sep >= 0 ? itemKey.slice(0, sep) : (routeId ?? "");
    const nid = sep >= 0 ? itemKey.slice(sep + 1) : "";
    if (rid && nid) return `${base}/lesson?route=${encodeURIComponent(rid)}&node=${encodeURIComponent(nid)}`;
    if (rid) return `${base}/tree?route=${encodeURIComponent(rid)}`;
  }
  if (kind === "corto") {
    return routeId ? `${base}/scroll?route=${encodeURIComponent(routeId)}` : `${base}/scroll`;
  }
  if (kind === "lectura" && itemKey) {
    // item_key = 'docId:sección', y last_route_id va null (un documento privado
    // del usuario no es una ruta), así que el id sale del propio item_key.
    const sep = itemKey.indexOf(":");
    const docId = sep >= 0 ? itemKey.slice(0, sep) : itemKey;
    if (docId) return `${base}/veloz?doc=${encodeURIComponent(docId)}`;
    return `${base}/veloz`;
  }
  if (kind === "podcast") return `${base}/podcast`;
  if (kind === "tunel") return `${base}/tunel`;
  return base;
}

interface SessionRow {
  id: string;
  user_id: string;
  last_item_kind: string | null;
  last_item_key: string | null;
  last_route_id: string | null;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const base = baseUrl();
  const premiumUrl = `${base}/premium`;
  const out = { unlocked: 0, reminded: 0, lapsed: 0, errors: 0 };

  // ── A) Bloqueos cumplidos → "ya puedes volver" ───────────────────────────
  try {
    const { data: due } = await sb
      .from("study_sessions")
      .select("id, user_id, last_item_kind, last_item_key, last_route_id")
      .not("locked_until", "is", null)
      .lte("locked_until", new Date().toISOString())
      .is("unlock_notified_at", null)
      .limit(BATCH);

    for (const s of (due ?? []) as SessionRow[]) {
      // RECLAMAR ANTES DE ENVIAR. Los workers existentes marcan notified_at
      // después de mandar, pero aquí el cron puede solaparse y un "ya puedes
      // volver" duplicado es peor que uno perdido.
      const { data: claimed } = await sb
        .from("study_sessions")
        .update({ unlock_notified_at: new Date().toISOString() })
        .eq("id", s.id)
        .is("unlock_notified_at", null)
        .select("id");
      if (!claimed?.length) continue; // otra invocación se lo llevó

      const { data: prof } = await sb
        .from("profiles")
        .select("email")
        .eq("id", s.user_id)
        .maybeSingle();
      const email = (prof?.email as string) || "";
      if (!email) continue;

      // El título pendiente (cliffhanger) sale de la lección, si la hubo.
      let nextUp: string | null = null;
      if (s.last_item_kind === "lesson" && s.last_item_key) {
        const sep = s.last_item_key.indexOf(":");
        const rid = sep >= 0 ? s.last_item_key.slice(0, sep) : null;
        const nid = sep >= 0 ? s.last_item_key.slice(sep + 1) : null;
        if (rid && nid) {
          const { data: lesson } = await sb
            .from("lessons")
            .select("title")
            .eq("route_id", rid)
            .eq("node_id", nid)
            .maybeSingle();
          nextUp = (lesson?.title as string) ?? null;
        }
      }

      const res = await sendSessionUnlockedEmail(email, {
        resumeUrl: resumeUrlFor(base, s.last_item_kind, s.last_item_key, s.last_route_id),
        nextUp,
        premiumUrl,
      });
      if (res.ok) out.unlocked++;
      else {
        out.errors++;
        console.warn(`[membership] correo de desbloqueo falló para ${email}: ${res.error}`);
      }
    }
  } catch (e) {
    out.errors++;
    console.error("[membership] pasada de desbloqueo falló:", e);
  }

  // ── B y C) Ciclo de la membresía ─────────────────────────────────────────
  try {
    const now = new Date();
    const soon = new Date(now.getTime() + REMINDER_DAYS_BEFORE * 86_400_000).toISOString();

    const { data: members } = await sb
      .from("profiles")
      .select("id, email, premium_until, renewal_notified_for, lapsed_notified_for, founder")
      .not("premium_until", "is", null)
      .lte("premium_until", soon) // ya vencidas o a punto de vencer
      .limit(BATCH);

    for (const p of members ?? []) {
      // Los fundadores no vencen nunca: no se les avisa de nada.
      if (p.founder) continue;
      const email = (p.email as string) || "";
      if (!email) continue;
      const until = p.premium_until as string;

      // C) Vencida. Se comprueba antes que el recordatorio porque son excluyentes.
      if (lapseNoticeDue(until, p.lapsed_notified_for as string | null, now)) {
        const { data: claimed } = await sb
          .from("profiles")
          .update({ lapsed_notified_for: until })
          .eq("id", p.id)
          .or(`lapsed_notified_for.is.null,lapsed_notified_for.neq.${until}`)
          .select("id");
        if (!claimed?.length) continue;

        const res = await sendMembershipLapsedEmail(email, { premiumUrl });
        if (res.ok) out.lapsed++;
        else out.errors++;
        continue;
      }

      // B) A punto de vencer.
      if (renewalReminderDue(until, p.renewal_notified_for as string | null, now, REMINDER_DAYS_BEFORE)) {
        const { data: claimed } = await sb
          .from("profiles")
          .update({ renewal_notified_for: until })
          .eq("id", p.id)
          .or(`renewal_notified_for.is.null,renewal_notified_for.neq.${until}`)
          .select("id");
        if (!claimed?.length) continue;

        const daysLeft = Math.max(
          1,
          Math.ceil((new Date(until).getTime() - now.getTime()) / 86_400_000)
        );
        const res = await sendMembershipReminderEmail(email, {
          premiumUntil: until,
          premiumUrl,
          daysLeft,
        });
        if (res.ok) out.reminded++;
        else out.errors++;
      }
    }
  } catch (e) {
    out.errors++;
    console.error("[membership] pasada de membresía falló:", e);
  }

  console.log(
    `[membership] desbloqueos=${out.unlocked} recordatorios=${out.reminded} vencidas=${out.lapsed} errores=${out.errors}`
  );
  return NextResponse.json({ ok: true, ...out });
}

export const GET = handle;  // cron de Vercel
export const POST = handle; // invocación manual
