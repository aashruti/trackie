/**
 * Leads-CRM seed fixtures — ported verbatim from the prototype's `leads` array
 * (Trackie.dc.html), including each lead's discussion timeline. `dateLabel` is the
 * prototype's display string; the seed parses it into `occurredAt` for ordering.
 */
import type { LeadStage, ActivityType } from "@/lib/db/enums";

export type ActivityFixture = {
  type: ActivityType;
  dateLabel: string; // "16 Jun 2026"
  author: string;
  body: string;
};

export type LeadFixture = {
  prospect: string;
  city: string;
  oem: string;
  owner: string;
  stage: LeadStage;
  value: number;
  students: number;
  nextAction: string;
  nextDate: string;
  source: string;
  contact: { name: string; role: string; email: string; phone: string };
  lostReason?: string;
  activities: ActivityFixture[];
};

export const LEAD_FIXTURES: LeadFixture[] = [
  {
    prospect: "Bennett University", city: "Greater Noida, UP", oem: "IBM", owner: "RK", stage: "negotiation",
    value: 18500000, students: 2100, nextAction: "Send revised rate card", nextDate: "20 Jun", source: "Referral · Amity",
    contact: { name: "Dr. Anita Sharma", role: "Dean, School of CS", email: "anita.sharma@bennett.edu.in", phone: "+91 98xxxx2210" },
    activities: [
      { type: "meeting", dateLabel: "16 Jun 2026", author: "RK", body: "On-site with the Dean and CFO. They want IBM certification bundled for 2,100 students across both semesters. Price sensitivity around ₹8,000/seat." },
      { type: "email", dateLabel: "12 Jun 2026", author: "PN", body: "Shared the FY25–26 proposal deck and sample margin ladder. Awaiting feedback on the new-students cohort size." },
      { type: "call", dateLabel: "06 Jun 2026", author: "RK", body: "Intro call. Strong intent, targeting a July rollout. Looped in their procurement team." },
    ],
  },
  {
    prospect: "Shoolini University", city: "Solan, HP", oem: "AAFM", owner: "NS", stage: "proposal",
    value: 9200000, students: 1150, nextAction: "Follow up on proposal", nextDate: "22 Jun", source: "Inbound · website",
    contact: { name: "Rahul Mehta", role: "Registrar", email: "registrar@shoolini.edu.in", phone: "+91 99xxxx7781" },
    activities: [
      { type: "email", dateLabel: "14 Jun 2026", author: "NS", body: "Proposal sent for AAFM financial-planning certification, 1,150 students. Quoted ₹8,000/seat to university." },
      { type: "call", dateLabel: "09 Jun 2026", author: "NS", body: "Qualified the lead — budget approved for one OEM track this year. AAFM is the preferred partner." },
    ],
  },
  {
    prospect: "Ashoka University", city: "Sonipat, HR", oem: "IBM", owner: "RK", stage: "qualified",
    value: 14000000, students: 1600, nextAction: "Schedule pricing call", nextDate: "24 Jun", source: "Conference",
    contact: { name: "Prof. Vikram Iyer", role: "Director, Academics", email: "vikram.iyer@ashoka.edu.in", phone: "+91 98xxxx4412" },
    activities: [
      { type: "note", dateLabel: "11 Jun 2026", author: "RK", body: "Met at the EdTech summit. Interested in IBM data-science track for 1,600 students. Need to confirm decision timeline." },
    ],
  },
  {
    prospect: "Nirma University", city: "Ahmedabad, GJ", oem: "AAFM", owner: "PN", stage: "lost",
    value: 7600000, students: 950, nextAction: "—", nextDate: "25 Jun", source: "Outbound",
    contact: { name: "Sneha Patel", role: "Head, Placements", email: "sneha.patel@nirma.ac.in", phone: "+91 97xxxx3390" },
    lostReason: "Chose a competitor on price — AAFM bundle was out of budget this cycle.",
    activities: [
      { type: "call", dateLabel: "10 Jun 2026", author: "PN", body: "First contact. Gauging interest in AAFM certification. Asked us to send an introduction deck." },
    ],
  },
  {
    prospect: "Bennett School of Mgmt", city: "Greater Noida, UP", oem: "AAFM", owner: "NS", stage: "new",
    value: 5400000, students: 700, nextAction: "Qualify budget & timeline", nextDate: "26 Jun", source: "Referral · Bennett",
    contact: { name: "Karan Malhotra", role: "Program Lead", email: "karan.m@bennett.edu.in", phone: "+91 98xxxx1145" },
    activities: [
      { type: "note", dateLabel: "15 Jun 2026", author: "NS", body: "Spun out of the Bennett University conversation — separate management-school cohort. Not yet qualified." },
    ],
  },
  {
    prospect: "Plaksha University", city: "Mohali, PB", oem: "IBM", owner: "RK", stage: "new",
    value: 8800000, students: 1000, nextAction: "Book discovery call", nextDate: "27 Jun", source: "Inbound · referral",
    contact: { name: "Dr. Meera Nair", role: "Associate Dean", email: "meera.nair@plaksha.edu.in", phone: "+91 99xxxx5567" },
    activities: [
      { type: "email", dateLabel: "17 Jun 2026", author: "RK", body: "Inbound enquiry via the Datagami site. Interested in IBM cloud + AI track. Need a discovery call." },
    ],
  },
  {
    prospect: "Krea University", city: "Sri City, AP", oem: "IBM", owner: "PN", stage: "won",
    value: 11200000, students: 1300, nextAction: "Hand off to onboarding", nextDate: "18 Jun", source: "Outbound",
    contact: { name: "Arvind Kumar", role: "VP Operations", email: "arvind.kumar@krea.edu.in", phone: "+91 98xxxx9023" },
    activities: [
      { type: "meeting", dateLabel: "15 Jun 2026", author: "PN", body: "Contract signed — 1,300 students on the IBM track for FY25–26. Advance bill to be raised. Handing off to delivery." },
      { type: "email", dateLabel: "08 Jun 2026", author: "PN", body: "Final terms agreed at ₹8,600/seat. Sending the contract for signature." },
    ],
  },
  {
    prospect: "Jain University", city: "Bengaluru, KA", oem: "AAFM", owner: "NS", stage: "negotiation",
    value: 10500000, students: 1250, nextAction: "Align on advance terms", nextDate: "21 Jun", source: "Existing OEM intro",
    contact: { name: "Pooja Reddy", role: "Finance Controller", email: "pooja.reddy@jainuniversity.ac.in", phone: "+91 97xxxx6614" },
    activities: [
      { type: "call", dateLabel: "16 Jun 2026", author: "NS", body: "Negotiating the advance-payment structure. They want a 30% advance against the first invoice. Reviewing margin impact." },
    ],
  },
];
