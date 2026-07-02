import "server-only";

import { sendEmail } from "./notify";

/** Escape user-supplied text before inlining into email HTML (names, notes). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function d(iso: string): string {
  const dt = new Date(iso + "T00:00:00Z");
  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function range(start: string, end: string): string {
  return start === end ? d(start) : `${d(start)} → ${d(end)}`;
}

const shell = (body: string) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0F172A;line-height:1.5">${body}<hr style="border:none;border-top:1px solid #E2E8F0;margin:20px 0"/><p style="color:#64748B;font-size:12px">Trackie · Datagami HR</p></div>`;

/** New leave request → notify HR / approvers. */
export async function notifyLeaveRequested(
  recipients: string[],
  req: { employeeName: string; leaveTypeName: string; startDate: string; endDate: string; days: number },
) {
  if (!recipients.length) return { sent: false, skippedReason: "no-recipients" as const };
  const html = shell(
    `<h2 style="margin:0 0 8px">Leave request awaiting approval</h2>
     <p><b>${esc(req.employeeName)}</b> requested <b>${esc(req.leaveTypeName)}</b> leave.</p>
     <p style="margin:4px 0"><b>Dates:</b> ${range(req.startDate, req.endDate)} · <b>${req.days}</b> day(s)</p>
     <p>Review it in Trackie → HR → Leave.</p>`,
  );
  return sendEmail({
    to: recipients,
    subject: `Leave request — ${req.employeeName} (${req.days}d ${req.leaveTypeName})`,
    html,
    text: `${req.employeeName} requested ${req.leaveTypeName} leave for ${range(req.startDate, req.endDate)} (${req.days} days). Review in Trackie → HR → Leave.`,
  });
}

/** Approval / rejection → notify the employee. */
export async function notifyLeaveDecision(
  employeeEmail: string,
  info: {
    employeeName: string;
    leaveTypeName: string;
    startDate: string;
    endDate: string;
    days: number;
    decision: "approved" | "rejected";
    note?: string | null;
  },
) {
  const approved = info.decision === "approved";
  const color = approved ? "#047857" : "#B91C1C";
  const html = shell(
    `<h2 style="margin:0 0 8px">Leave ${info.decision}</h2>
     <p>Hi ${esc(info.employeeName)}, your <b>${esc(info.leaveTypeName)}</b> leave request was
        <b style="color:${color}">${info.decision}</b>.</p>
     <p style="margin:4px 0"><b>Dates:</b> ${range(info.startDate, info.endDate)} · <b>${info.days}</b> day(s)</p>
     ${info.note ? `<p style="margin:4px 0"><b>Note:</b> ${esc(info.note)}</p>` : ""}`,
  );
  return sendEmail({
    to: employeeEmail,
    subject: `Leave ${info.decision} — ${info.leaveTypeName} (${range(info.startDate, info.endDate)})`,
    html,
    text: `Your ${info.leaveTypeName} leave for ${range(info.startDate, info.endDate)} (${info.days} days) was ${info.decision}.${info.note ? " Note: " + info.note : ""}`,
  });
}
