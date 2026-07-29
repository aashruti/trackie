import "server-only";

import { sendEmail } from "./notify";
import {
  brandedEmail,
  emailButton,
  emailDetailTable,
  escapeEmailHtml as esc,
} from "./brand";

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

/** New leave request → notify HR / approvers. */
export async function notifyLeaveRequested(
  recipients: { to: string[]; cc: string[] },
  req: {
    employeeName: string;
    leaveTypeName: string;
    startDate: string;
    endDate: string;
    days: number;
    reviewUrl: string;
  },
) {
  if (!recipients.to.length) return { sent: false, skippedReason: "no-recipients" as const };
  const html = brandedEmail({
    preheader: `${req.employeeName} requested ${req.days} day(s) of ${req.leaveTypeName} leave.`,
    eyebrow: "Leave management",
    title: "Leave request awaiting approval",
    body: `<p style="margin:0">A new leave request needs your review.</p>
      ${emailDetailTable([
        { label: "Employee", value: req.employeeName },
        { label: "Leave type", value: req.leaveTypeName },
        { label: "Dates", value: range(req.startDate, req.endDate) },
        { label: "Duration", value: `${req.days} day(s)` },
      ])}
      ${emailButton(req.reviewUrl, "Review leave request")}
      <p style="margin:14px 0 0;color:#64748B;font-size:13px;line-height:20px">Sign in to Trackie to approve or reject this request.</p>`,
  });
  return sendEmail({
    to: recipients.to,
    cc: recipients.cc,
    subject: `Leave request — ${req.employeeName} (${req.days}d ${req.leaveTypeName})`,
    html,
    text: `${req.employeeName} requested ${req.leaveTypeName} leave for ${range(req.startDate, req.endDate)} (${req.days} days). Review and decide: ${req.reviewUrl}`,
  });
}

/** Confirmation to the applicant that their leave request was submitted. */
export async function notifyLeaveSubmitted(
  employeeEmail: string,
  req: { employeeName: string; leaveTypeName: string; startDate: string; endDate: string; days: number },
) {
  const html = brandedEmail({
    preheader: `Your ${req.leaveTypeName} leave request has been submitted.`,
    eyebrow: "Leave request",
    title: "Request submitted",
    body: `<p style="margin:0">Hi <strong>${esc(req.employeeName)}</strong>, your leave request has been sent to HR for approval.</p>
      ${emailDetailTable([
        { label: "Leave type", value: req.leaveTypeName },
        { label: "Dates", value: range(req.startDate, req.endDate) },
        { label: "Duration", value: `${req.days} day(s)` },
        { label: "Status", value: "Awaiting approval" },
      ])}
      <p style="margin:0;color:#64748B;font-size:13px;line-height:20px">You’ll receive another email once HR approves or rejects it.</p>`,
  });
  return sendEmail({
    to: employeeEmail,
    subject: `Leave request submitted — ${req.leaveTypeName} (${range(req.startDate, req.endDate)})`,
    html,
    text: `Your ${req.leaveTypeName} leave request for ${range(req.startDate, req.endDate)} (${req.days} days) has been submitted for approval.`,
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
  const html = brandedEmail({
    preheader: `Your ${info.leaveTypeName} leave request was ${info.decision}.`,
    eyebrow: "Leave decision",
    title: `Leave ${info.decision}`,
    body: `<p style="margin:0">Hi <strong>${esc(info.employeeName)}</strong>, HR has reviewed your leave request.</p>
      ${emailDetailTable([
        { label: "Leave type", value: info.leaveTypeName },
        { label: "Dates", value: range(info.startDate, info.endDate) },
        { label: "Duration", value: `${info.days} day(s)` },
      ])}
      <p style="margin:18px 0 0">Status: <strong style="color:${color};text-transform:capitalize">${info.decision}</strong></p>
      ${info.note ? `<div style="margin-top:16px;padding:12px 14px;background:#F8FAFC;border-left:3px solid #CBD5E1;border-radius:4px"><strong>HR note</strong><br>${esc(info.note)}</div>` : ""}`,
  });
  return sendEmail({
    to: employeeEmail,
    subject: `Leave ${info.decision} — ${info.leaveTypeName} (${range(info.startDate, info.endDate)})`,
    html,
    text: `Your ${info.leaveTypeName} leave for ${range(info.startDate, info.endDate)} (${info.days} days) was ${info.decision}.${info.note ? " Note: " + info.note : ""}`,
  });
}
