import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.hoisted(() => vi.fn());

vi.mock("./notify", () => ({ sendEmail }));

import { notifyLeaveRequested } from "./hr-leave";

describe("notifyLeaveRequested", () => {
  beforeEach(() => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ sent: true });
  });

  it("sends to HR with Dhaval in CC and includes the request review link", async () => {
    const reviewUrl = "https://trackie.example/hr/leave?request=42";

    await notifyLeaveRequested(
      {
        to: ["hr-user@example.test"],
        cc: ["dhaval@datagami.in"],
      },
      {
        employeeName: "Employee Test",
        leaveTypeName: "Earned",
        startDate: "2026-08-03",
        endDate: "2026-08-03",
        days: 1,
        reviewUrl,
      },
    );

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: ["hr-user@example.test"],
      cc: ["dhaval@datagami.in"],
      html: expect.stringContaining(reviewUrl),
      text: expect.stringContaining(reviewUrl),
    }));
    const html = sendEmail.mock.calls[0][0].html as string;
    expect(html).toContain("TRACKIE");
    expect(html).toContain("Datagami");
    expect(html).toContain("Leave request awaiting approval");
  });
});
