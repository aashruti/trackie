ALTER TABLE "accounts"
  ADD COLUMN "latitude" numeric(9, 6),
  ADD COLUMN "longitude" numeric(9, 6),
  ADD COLUMN "guest_house_available" boolean,
  ADD COLUMN "guest_house_cost_per_night" numeric(12, 2);--> statement-breakpoint

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_coordinates_pair_check"
    CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  ADD CONSTRAINT "accounts_latitude_range_check"
    CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "accounts_longitude_range_check"
    CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "accounts_guest_house_cost_check"
    CHECK ("guest_house_cost_per_night" IS NULL OR "guest_house_cost_per_night" >= 0),
  ADD CONSTRAINT "accounts_guest_house_cost_requires_available_check"
    CHECK ("guest_house_cost_per_night" IS NULL OR "guest_house_available" IS TRUE);
