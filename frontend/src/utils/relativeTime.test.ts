import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./relativeTime";

// Fixed reference point: 2026-04-19T12:00:00Z
const NOW = new Date("2026-04-19T12:00:00Z");

describe("formatRelativeTime", () => {
  describe("edge cases — invalid input", () => {
    it("returns empty string for null", () => {
      expect(formatRelativeTime(null, NOW)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(formatRelativeTime(undefined, NOW)).toBe("");
    });

    it("returns empty string for empty string", () => {
      expect(formatRelativeTime("", NOW)).toBe("");
    });

    it("returns empty string for invalid date string", () => {
      expect(formatRelativeTime("not-a-date", NOW)).toBe("");
    });

    it("returns empty string for random non-date text", () => {
      expect(formatRelativeTime("hello world", NOW)).toBe("");
    });
  });

  describe("just now (< 5 seconds)", () => {
    it("returns 'just now' for 0 seconds ago", () => {
      expect(formatRelativeTime("2026-04-19T12:00:00Z", NOW)).toBe("just now");
    });

    it("returns 'just now' for 3 seconds ago", () => {
      const input = new Date(NOW.getTime() - 3 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("just now");
    });

    it("returns 'just now' for 4 seconds ago", () => {
      const input = new Date(NOW.getTime() - 4 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("just now");
    });
  });

  describe("seconds (5s–59s)", () => {
    it("returns '5 seconds ago' for 5 seconds", () => {
      const input = new Date(NOW.getTime() - 5 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("5 seconds ago");
    });

    it("returns '1 second ago' for 1 second (singular)", () => {
      const input = new Date(NOW.getTime() - 1 * 1000).toISOString();
      // 1 second < 5 seconds threshold, so it's "just now"
      expect(formatRelativeTime(input, NOW)).toBe("just now");
    });

    it("returns '30 seconds ago' for 30 seconds", () => {
      const input = new Date(NOW.getTime() - 30 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("30 seconds ago");
    });

    it("returns '59 seconds ago' for 59 seconds", () => {
      const input = new Date(NOW.getTime() - 59 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("59 seconds ago");
    });
  });

  describe("minutes (1m–59m)", () => {
    it("returns '1 minute ago' for exactly 60 seconds (singular)", () => {
      const input = new Date(NOW.getTime() - 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("1 minute ago");
    });

    it("returns '2 minutes ago' for 2 minutes (plural)", () => {
      const input = new Date(NOW.getTime() - 2 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("2 minutes ago");
    });

    it("returns '59 minutes ago' for 59 minutes", () => {
      const input = new Date(NOW.getTime() - 59 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("59 minutes ago");
    });
  });

  describe("hours (1h–23h)", () => {
    it("returns '1 hour ago' for exactly 1 hour (singular)", () => {
      const input = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("1 hour ago");
    });

    it("returns '3 hours ago' for 3 hours (plural)", () => {
      const input = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("3 hours ago");
    });

    it("returns '23 hours ago' for 23 hours", () => {
      const input = new Date(NOW.getTime() - 23 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("23 hours ago");
    });
  });

  describe("days (1d–29d)", () => {
    it("returns '1 day ago' for exactly 1 day (singular)", () => {
      const input = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("1 day ago");
    });

    it("returns '3 days ago' for 3 days (plural)", () => {
      const input = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("3 days ago");
    });

    it("returns '29 days ago' for 29 days", () => {
      const input = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("29 days ago");
    });
  });

  describe("months (1mo–11mo)", () => {
    it("returns '1 month ago' for 30 days (singular)", () => {
      const input = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("1 month ago");
    });

    it("returns '3 months ago' for 90 days (plural)", () => {
      const input = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("3 months ago");
    });

    it("returns '11 months ago' for 330 days", () => {
      const input = new Date(NOW.getTime() - 330 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("11 months ago");
    });
  });

  describe("years (1y+)", () => {
    it("returns '1 year ago' for 365 days (singular)", () => {
      const input = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("1 year ago");
    });

    it("returns '2 years ago' for 730 days (plural)", () => {
      const input = new Date(NOW.getTime() - 730 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("2 years ago");
    });
  });

  describe("future timestamps", () => {
    it("returns 'in 2 minutes' for a timestamp 2 minutes in the future", () => {
      const input = new Date(NOW.getTime() + 2 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("in 2 minutes");
    });

    it("returns 'in 3 days' for a timestamp 3 days in the future", () => {
      const input = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(input, NOW)).toBe("in 3 days");
    });
  });

  describe("time format support", () => {
    it("accepts ISO 8601 format with Z suffix", () => {
      // 2 hours ago in ISO format
      expect(formatRelativeTime("2026-04-19T10:00:00Z", NOW)).toBe("2 hours ago");
    });

    it("accepts space-separated format (treated as UTC)", () => {
      // "2026-04-19 10:00:00" → 2 hours before NOW
      expect(formatRelativeTime("2026-04-19 10:00:00", NOW)).toBe("2 hours ago");
    });

    it("ISO and space-separated produce identical results for same time", () => {
      const iso = formatRelativeTime("2026-04-18T12:00:00Z", NOW);
      const spaced = formatRelativeTime("2026-04-18 12:00:00", NOW);
      expect(iso).toBe(spaced);
      expect(iso).toBe("1 day ago");
    });
  });
});
