import { createApp } from "../src/http/app.ts";
import { createIds } from "../src/ids.ts";
import { MemoryStore } from "../src/storage/memory-store.ts";
import type { PieceKind } from "../src/domain/types.ts";
import type { Clock } from "../src/clock.ts";

export type Json = any;
export interface Res {
  status: number;
  body: Json;
}

export const BRAND = { role: "brand", id: "brand_1" } as const;
export const OTHER_BRAND = { role: "brand", id: "brand_2" } as const;
export const CREATOR = { role: "creator", id: "creator_1" } as const;
export const OTHER_CREATOR = { role: "creator", id: "creator_2" } as const;
type Actor = { role: string; id: string };

export const CONTENT: Record<PieceKind, Json> = {
  script: { text: "Roteiro: abre com o produto na mão." },
  caption: { text: "Legenda da campanha #publi" },
  cover: { url: "https://cdn.example.com/cover.png" },
  video: { url: "https://cdn.example.com/video.mp4", duration_seconds: 30 },
};

export function setup() {
  let now = new Date("2026-10-01T12:00:00.000Z");
  const clock: Clock = { now: () => now };
  const app = createApp({ store: new MemoryStore(), clock, ids: createIds() });

  async function call(method: string, path: string, as?: Actor, body?: unknown): Promise<Res> {
    now = new Date(now.getTime() + 1000);
    const headers: Record<string, string> = {};
    if (as) {
      headers["x-actor-role"] = as.role;
      headers["x-actor-id"] = as.id;
    }
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  const api = {
    call,
    async campaign(required: PieceKind[], as: Actor = BRAND) {
      const r = await call("POST", "/campaigns", as, { name: "Campanha", required_pieces: required });
      return r.body.id as string;
    },
    async delivery(campaignId: string, as: Actor = CREATOR) {
      const r = await call("POST", "/deliveries", as, { campaign_id: campaignId });
      return r.body.id as string;
    },
    /** campaign + delivery in one go */
    async start(required: PieceKind[]) {
      const campaignId = await api.campaign(required);
      return { campaignId, deliveryId: await api.delivery(campaignId) };
    },
    async upload(deliveryId: string, kind: PieceKind, content: Json = CONTENT[kind]) {
      const r = await call("POST", `/deliveries/${deliveryId}/pieces/${kind}/versions`, CREATOR, content);
      return r.body.id as string;
    },
    async approveVersion(versionId: string) {
      return call("POST", `/versions/${versionId}/approve`, BRAND);
    },
    /** upload + approve a piece, returns the version id */
    async uploadApproved(deliveryId: string, kind: PieceKind) {
      const id = await api.upload(deliveryId, kind);
      await api.approveVersion(id);
      return id;
    },
    approveDelivery(deliveryId: string, as: Actor = BRAND) {
      return call("POST", `/deliveries/${deliveryId}/approve`, as);
    },
    get(path: string) {
      return call("GET", path);
    },
  };
  return api;
}
