import { serve } from "@hono/node-server";
import { systemClock } from "./clock.ts";
import { createApp } from "./http/app.ts";
import { createIds } from "./ids.ts";
import { MemoryStore } from "./storage/memory-store.ts";

const port = Number(process.env.PORT ?? 3000);
const app = createApp({ store: new MemoryStore(), clock: systemClock, ids: createIds() });

serve({ fetch: app.fetch, port }, ({ port: p }) => {
  console.log(`conty-video-review listening on http://localhost:${p}`);
});
