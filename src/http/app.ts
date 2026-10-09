import { Hono, type Context } from "hono";
import type { Clock } from "../clock.ts";
import { AppError, type ErrorCategory } from "../domain/errors.ts";
import type { Actor } from "../domain/types.ts";
import type { IdGenerator } from "../ids.ts";
import { ReviewService } from "../service/review-service.ts";
import type { Store } from "../storage/store.ts";
import { campaignJson, commentJson, deliveryJson, versionJson, versionSummary } from "./serialize.ts";

export interface AppDeps {
  store: Store;
  clock: Clock;
  ids: IdGenerator;
}

const STATUS: Record<ErrorCategory, 400 | 401 | 403 | 404 | 409 | 422> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
};

// Header-based stand-in for real auth: x-actor-role: brand|creator, x-actor-id: <id>.
function actorOf(c: Context): Actor {
  const role = c.req.header("x-actor-role");
  const id = c.req.header("x-actor-id")?.trim();
  if ((role !== "brand" && role !== "creator") || !id) {
    throw new AppError(
      "unauthenticated",
      "actor_required",
      "Envie os headers x-actor-role (brand ou creator) e x-actor-id.",
    );
  }
  return { role, id };
}

async function jsonBody(c: Context, optional = false): Promise<unknown> {
  const raw = (await c.req.text()).trim();
  if (optional && raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("bad_request", "invalid_json", "O corpo da requisição não é um JSON válido.");
  }
}

export function createApp(deps: AppDeps): Hono {
  const service = new ReviewService(deps.store, deps.clock, deps.ids);
  const app = new Hono();

  app.post("/campaigns", async (c) => {
    const campaign = service.createCampaign(actorOf(c), await jsonBody(c));
    return c.json(campaignJson(campaign), 201);
  });
  app.get("/campaigns/:id", (c) => c.json(campaignJson(service.getCampaign(c.req.param("id")))));

  app.post("/deliveries", async (c) => {
    const view = service.createDelivery(actorOf(c), await jsonBody(c));
    return c.json(deliveryJson(view), 201);
  });
  app.get("/deliveries/:id", (c) => c.json(deliveryJson(service.getDelivery(c.req.param("id")))));

  app.post("/deliveries/:id/approve", (c) =>
    c.json(deliveryJson(service.approveDelivery(actorOf(c), c.req.param("id")))),
  );

  app.post("/deliveries/:id/pieces/:kind/versions", async (c) => {
    const actor = actorOf(c);
    const body = await jsonBody(c);
    const version = service.submitVersion(actor, c.req.param("id"), c.req.param("kind"), body);
    return c.json(versionSummary(version), 201);
  });

  app.get("/versions/:id", (c) => c.json(versionJson(service.getVersion(c.req.param("id")))));

  app.post("/versions/:id/approve", (c) =>
    c.json(versionSummary(service.reviewVersion(actorOf(c), c.req.param("id"), "approve"))),
  );

  app.post("/versions/:id/request-changes", async (c) => {
    const actor = actorOf(c);
    const body = await jsonBody(c, true);
    return c.json(versionSummary(service.reviewVersion(actor, c.req.param("id"), "request_changes", body)));
  });

  app.post("/versions/:id/comments", async (c) => {
    const actor = actorOf(c);
    const comment = service.addComment(actor, c.req.param("id"), await jsonBody(c));
    return c.json(commentJson(comment), 201);
  });

  app.notFound((c) => c.json({ error: { code: "route_not_found", message: "Rota não encontrada." } }, 404));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, ...err.extra } }, STATUS[err.category]);
    }
    console.error(err);
    return c.json({ error: { code: "internal_error", message: "Erro interno." } }, 500);
  });

  return app;
}
