import { getSettings, saveSettings, json } from "./lib/gbp.mjs";
export default async (req) => {
  if (req.method === "GET") return json(await getSettings());
  let b = {}; try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const patch = {};
  if (b.autopostMinStars != null) patch.autopostMinStars = Math.max(1, Math.min(5, +b.autopostMinStars || 4));
  if (b.signature != null) patch.signature = String(b.signature).slice(0, 200);
  return json(await saveSettings(patch));
};
export const config = { path: "/api/reviews/settings" };
