import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.hoisted(() => vi.fn());

vi.mock("./notify", () => ({ sendEmail }));

import { sendVerificationEmail } from "./verify";

describe("sendVerificationEmail", () => {
  beforeEach(() => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ sent: true });
  });

  it("uses Trackie branding and the verification action", async () => {
    const link = "https://trackie.example/verify-email?token=test";
    await sendVerificationEmail("user@example.test", "User Test", link);

    const input = sendEmail.mock.calls[0][0];
    expect(input.html).toContain("TRACKIE");
    expect(input.html).toContain("Datagami");
    expect(input.html).toContain("Verify email address");
    expect(input.html).toContain(link.replace("&", "&amp;"));
    expect(input.text).toContain(link);
  });
});
