import { describe, expect, it } from "vitest";
import { unsubscribeHeaders } from "@/lib/notifications/deliver";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

describe("unsubscribeHeaders", () => {
  it("gives broadcast mail a one-click unsubscribe header naming that recipient", () => {
    const { headers } = unsubscribeHeaders({
      category: "broadcast",
      recipientUserId: "user-abc",
    });

    expect(headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const url = new URL(headers!["List-Unsubscribe"]!.slice(1, -1));
    expect(url.pathname).toBe("/api/unsubscribe");
    expect(verifyUnsubscribeToken(url.searchParams.get("u")!)).toBe("user-abc");
  });

  it("gives transactional mail no unsubscribe headers at all", () => {
    expect(
      unsubscribeHeaders({ category: "transactional", recipientUserId: "user-abc" }),
    ).toEqual({});
  });

  it("gives a row whose account was deleted no header rather than a broken link", () => {
    expect(unsubscribeHeaders({ category: "broadcast", recipientUserId: null })).toEqual({});
  });
});
