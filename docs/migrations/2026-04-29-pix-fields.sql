-- Migration: PIX fields on clients table
-- Run this in the Supabase SQL Editor

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS monthly_budget    numeric(10,2),
  ADD COLUMN IF NOT EXISTS pix_cycle         text CHECK (pix_cycle IN ('semanal','quinzenal','mensal')),
  ADD COLUMN IF NOT EXISTS pix_reference_day integer CHECK (pix_reference_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS pix_active        boolean NOT NULL DEFAULT false;
