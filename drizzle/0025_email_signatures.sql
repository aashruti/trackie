CREATE TABLE "email_signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer REFERENCES "users"("id") ON DELETE set null,
	"updated_by" integer REFERENCES "users"("id") ON DELETE set null,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" integer NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"accent_color" text NOT NULL,
	"show_address" boolean DEFAULT true NOT NULL,
	"show_edudron" boolean DEFAULT true NOT NULL
);
