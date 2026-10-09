import { describe, expect, it } from "vitest";
import { currentVersions, evaluateDelivery } from "../src/domain/delivery-status.ts";
import type { DeliveryApproval, PieceKind, PieceVersion, ReviewStatus } from "../src/domain/types.ts";

const version = (id: string, kind: PieceKind, n: number, status: ReviewStatus): PieceVersion => ({
  id,
  deliveryId: "d",
  kind,
  version: n,
  content: { url: "https://x.example" },
  status,
  createdBy: "c",
  createdAt: "t",
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
});

const approvalOf = (snapshot: Record<string, string>): DeliveryApproval => ({
  id: "a",
  deliveryId: "d",
  approvedBy: "b",
  approvedAt: "t",
  snapshot,
});

describe("evaluateDelivery (pure)", () => {
  it("picks the highest version as current, whatever the input order", () => {
    const current = currentVersions([version("c2", "cover", 2, "pending_review"), version("c1", "cover", 1, "approved")]);
    expect(current.cover?.id).toBe("c2");
  });

  it("is approved only while every required current version is the snapshotted one", () => {
    const campaign = { requiredPieces: ["video", "cover"] as const };
    const approved = currentVersions([version("v1", "video", 1, "approved"), version("c1", "cover", 1, "approved")]);
    const approval = approvalOf({ video: "v1", cover: "c1" });

    expect(evaluateDelivery(campaign, approved, approval).status).toBe("approved");

    const replaced = currentVersions([
      version("v1", "video", 1, "approved"),
      version("c1", "cover", 1, "approved"),
      version("c2", "cover", 2, "approved"), // new version, even already approved
    ]);
    const after = evaluateDelivery(campaign, replaced, approval);
    expect(after.status).toBe("ready_for_approval");
    expect(after.payment).toBe("on_hold");
  });

  it("ignores optional pieces in both blockers and snapshot comparison", () => {
    const campaign = { requiredPieces: ["video"] as const };
    const current = currentVersions([version("v1", "video", 1, "approved"), version("s1", "script", 1, "changes_requested")]);
    const result = evaluateDelivery(campaign, current, approvalOf({ video: "v1" }));
    expect(result.status).toBe("approved");
    expect(result.blockers).toEqual([]);
  });
});
