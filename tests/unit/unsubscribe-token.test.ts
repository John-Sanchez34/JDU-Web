import { describe, expect, it } from "vitest";
import {
  signUnsubscribeToken,
  unsubscribePostUrl,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from "@/lib/unsubscribe-token";

describe("unsubscribe tokens", () => {
  it("round-trips a user id", () => {
    const token = signUnsubscribeToken("user-abc");
    expect(verifyUnsubscribeToken(token)).toBe("user-abc");
  });

  it("rejects a token whose signature was altered", () => {
    const token = signUnsubscribeToken("user-abc");
    const [id, signature] = token.split(".");
    const flipped = signature!.startsWith("A") ? `B${signature!.slice(1)}` : `A${signature!.slice(1)}`;
    expect(verifyUnsubscribeToken(`${id}.${flipped}`)).toBeNull();
  });

  it("rejects a token whose user id was swapped for someone else's", () => {
    const mine = signUnsubscribeToken("user-abc");
    const theirs = signUnsubscribeToken("user-xyz");
    const forged = `${theirs.split(".")[0]}.${mine.split(".")[1]}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it("rejects malformed tokens rather than throwing", () => {
    for (const bad of ["", ".", "nodot", "a.b.c", "user-abc."]) {
      expect(verifyUnsubscribeToken(bad)).toBeNull();
    }
  });

  it("rejects a truncated signature", () => {
    const token = signUnsubscribeToken("user-abc");
    const [id, signature] = token.split(".");
    expect(verifyUnsubscribeToken(`${id}.${signature!.slice(0, -4)}`)).toBeNull();
  });

  it("builds a page URL and a one-click POST URL carrying the same token", () => {
    const page = new URL(unsubscribeUrl("user-abc"));
    const post = new URL(unsubscribePostUrl("user-abc"));

    expect(page.pathname).toBe("/unsubscribe");
    expect(post.pathname).toBe("/api/unsubscribe");
    expect(verifyUnsubscribeToken(page.searchParams.get("u")!)).toBe("user-abc");
    expect(verifyUnsubscribeToken(post.searchParams.get("u")!)).toBe("user-abc");
  });
});
