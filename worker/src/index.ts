// win-lot Worker: JSON API under /api/*, static UI from web/dist (ASSETS), daily cron refresh.

import { drawToApi, loadDraws, recomputePrediction, rowToDraw } from "./db";
import { LOTTERIES, LOTTERY_BY_ID, type Lottery } from "./lotteries";
import { refreshAll } from "./scrape";
import { computeStats } from "./stats";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
}

const CACHE_SECONDS = 300;

function json(data: unknown, status = 200, maxAge = CACHE_SECONDS): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 && maxAge > 0 ? `public, max-age=${maxAge}` : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const notFound = (msg = "not found") => json({ error: msg }, 404);

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = value === null ? NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

async function listLotteries(env: Env) {
  const { results: summary } = await env.DB.prepare(
    "SELECT lottery_id, COUNT(*) AS draw_count, MIN(draw_date) AS first_date, MAX(draw_no) AS last_no FROM draws GROUP BY lottery_id",
  ).all<{ lottery_id: string; draw_count: number; first_date: string; last_no: number }>();
  const { results: lastRows } = await env.DB.prepare(
    `SELECT d.lottery_id, d.draw_no, d.draw_date, d.letter, d.numbers, d.bonus FROM draws d
     JOIN (SELECT lottery_id, MAX(draw_no) AS m FROM draws GROUP BY lottery_id) x
       ON x.lottery_id = d.lottery_id AND x.m = d.draw_no`,
  ).all<{ lottery_id: string; draw_no: number; draw_date: string; letter: string | null; numbers: string; bonus: string | null }>();
  const byId = new Map(summary.map((s) => [s.lottery_id, s]));
  const lastById = new Map(lastRows.map((r) => [r.lottery_id, drawToApi(rowToDraw(r))]));
  return LOTTERIES.map((l) => ({
    id: l.id,
    name: l.name,
    board: l.board,
    letterKind: l.letter_kind,
    mainCount: l.main_count,
    mainMin: l.main_min,
    mainMax: l.main_max,
    hasBonus: !!l.has_bonus,
    bonusLabel: l.bonus_label,
    drawCount: byId.get(l.id)?.draw_count ?? 0,
    firstDate: byId.get(l.id)?.first_date ?? null,
    lastDraw: lastById.get(l.id) ?? null,
  }));
}

async function listDraws(env: Env, lottery: Lottery, url: URL) {
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 500);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 1_000_000);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM draws WHERE lottery_id = ?").bind(lottery.id).first<number>("n");
  const { results } = await env.DB.prepare(
    "SELECT draw_no, draw_date, letter, numbers, bonus FROM draws WHERE lottery_id = ? ORDER BY draw_no DESC LIMIT ? OFFSET ?",
  )
    .bind(lottery.id, limit, offset)
    .all<{ draw_no: number; draw_date: string; letter: string | null; numbers: string; bonus: string | null }>();
  return { total: total ?? 0, draws: results.map((r) => drawToApi(rowToDraw(r))) };
}

async function stats(env: Env, lottery: Lottery, url: URL) {
  const param = url.searchParams.get("window") ?? "all";
  const window = ["all", "500", "100"].includes(param) ? param : "all";
  const draws = await loadDraws(env.DB, lottery.id, window === "all" ? undefined : Number(window));
  return computeStats(lottery, draws, window);
}

async function prediction(env: Env, lottery: Lottery) {
  const row = await env.DB.prepare("SELECT payload FROM predictions WHERE lottery_id = ?").bind(lottery.id).first<string>("payload");
  if (row) return JSON.parse(row);
  return recomputePrediction(env.DB, lottery, new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
}

async function status(env: Env) {
  const { results } = await env.DB.prepare(
    "SELECT id, run_at, lottery_id, inserted, status, message FROM fetch_log ORDER BY id DESC LIMIT 20",
  ).all<{ id: number; run_at: string; lottery_id: string | null; inserted: number; status: string; message: string | null }>();
  return { lastRun: results[0]?.run_at ?? null, runs: results };
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/admin/refresh") {
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (!env.ADMIN_TOKEN) return json({ error: "ADMIN_TOKEN secret is not configured" }, 503);
    const token = request.headers.get("x-admin-token") ?? "";
    if (!safeEqual(token, env.ADMIN_TOKEN)) return json({ error: "unauthorized" }, 401);
    const only = url.searchParams.get("lottery");
    const results = await refreshAll(env.DB, only ? [only] : undefined);
    return json({ ok: results.every((r) => r.status === "ok"), results }, 200, 0);
  }

  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed" }, 405);

  if (path === "/api/lotteries") return json(await listLotteries(env));
  if (path === "/api/status") return json(await status(env), 200, 60);

  const m = /^\/api\/lotteries\/([a-z0-9-]+)\/(draws|stats|prediction)$/.exec(path);
  if (m) {
    const lottery = LOTTERY_BY_ID[m[1]];
    if (!lottery) return notFound(`unknown lottery: ${m[1]}`);
    if (m[2] === "draws") return json(await listDraws(env, lottery, url));
    if (m[2] === "stats") return json(await stats(env, lottery, url));
    const pred = await prediction(env, lottery);
    return pred ? json(pred) : notFound("no draws yet for this lottery");
  }
  return notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error("api error", url.pathname, err);
        return json({ error: "internal error" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      refreshAll(env.DB).then((results) => {
        console.log("scheduled refresh", controller.cron, JSON.stringify(results));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
