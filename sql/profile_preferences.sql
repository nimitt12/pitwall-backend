-- Apply during deployment with the schema-owner role, before starting production.
-- Production request handlers deliberately do not have schema-alteration privileges.
ALTER TABLE users ADD COLUMN IF NOT EXISTS fav_constructor TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fav_drivers TEXT[] DEFAULT '{}';
