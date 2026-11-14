-- =======================================================
-- INDU RO SERVICE — Supabase PostgreSQL Database Schema
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/kyakvqoxfyvgpjklhflo/sql
-- =======================================================

-- 1. Enable UUID generation if not already available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create the invoices table
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_no TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_mode TEXT DEFAULT 'Paid – UPI / Cash',
  profit NUMERIC DEFAULT 0,
  notes TEXT DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure profit column exists on existing tables
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS profit NUMERIC DEFAULT 0;

-- 3. Create indexes for quick search and sorting
CREATE INDEX IF NOT EXISTS idx_invoices_ref_no ON public.invoices (ref_no);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON public.invoices (issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON public.invoices (created_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- 5. Drop existing policy if re-running
DROP POLICY IF EXISTS "Allow all operations on invoices" ON public.invoices;

-- 6. Create policy allowing anonymous and authenticated read/write
CREATE POLICY "Allow all operations on invoices"
  ON public.invoices
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 7. Grant access to API roles
GRANT ALL ON public.invoices TO anon, authenticated, service_role;
