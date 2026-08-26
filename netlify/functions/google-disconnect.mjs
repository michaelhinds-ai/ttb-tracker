import { clearTokens, json } from "./lib/gbp.mjs";
export default async () => { await clearTokens(); return json({ ok: true }); };
export const config = { path: "/api/google/disconnect" };
