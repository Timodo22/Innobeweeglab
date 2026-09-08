import { handle } from "../../server/router";
import type { Env } from "../../server/util";

/**
 * Single entry point for the whole API. Cloudflare Pages routes every /api/*
 * request here; `server/router.ts` does the dispatch.
 */
export const onRequest: PagesFunction<Env> = ({ request, env }) => handle(request, env);
