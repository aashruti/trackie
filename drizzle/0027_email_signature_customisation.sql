ALTER TABLE "email_signatures"
	ADD COLUMN "layout" text DEFAULT 'card' NOT NULL,
	ADD COLUMN "font" text DEFAULT 'sans' NOT NULL,
	ADD COLUMN "sign_off" text DEFAULT '' NOT NULL,
	ADD COLUMN "company" text DEFAULT 'Datagami Technology Services Pvt. Ltd' NOT NULL,
	ADD COLUMN "extra_line" text DEFAULT '' NOT NULL,
	ADD COLUMN "badge" text DEFAULT 'none' NOT NULL,
	ADD COLUMN "show_email" boolean DEFAULT true NOT NULL,
	ADD COLUMN "show_website" boolean DEFAULT true NOT NULL;
