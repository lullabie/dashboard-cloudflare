// dashboard-api Worker entry — DESIGN REVIEW COPY. Not deployed.
// Wiring only: all behavior lives in ./refresh.js and is tested there.
import { performRefresh, readNews, CRON_EXPRESSION } from "./refresh.js";

const ALLOWED_ORIGIN = "https://dashboard.mnoamanhussain.workers.dev";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    },
  });
}

export default {
  // Cron trigger: */15 * * * * (see CONTRACT.md). event.cron carries the
  // expression that fired; it is stored in the envelope, so a scheduled
  // execution is provably distinct from a manual POST /api/refresh.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(performRefresh(env, {
      fetchFn: (url, init) => fetch(url, init),
      now: new Date(),
      trigger: "scheduled",
      cron: event.cron ?? CRON_EXPRESSION,
    }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/news") {
      return json(await readNews(env, { now: new Date() }));
    }
    if (request.method === "POST" && url.pathname === "/api/refresh") {
      const result = await performRefresh(env, {
        fetchFn: (u, init) => fetch(u, init),
        now: new Date(),
        trigger: "manual",
        cron: null,
      });
      return json({ outcome: result.outcome, error: result.error ?? null },
        result.outcome === "error" ? 502 : 200);
    }
    return json({ error: "not found" }, 404);
  },
};
