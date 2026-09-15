-- COMPLETE DATABASE SCHEMA FIX
-- This migration will add ALL missing columns to fix production database issues

-- First, let's check and fix the drugs table
DO $$
BEGIN
    -- Add pack_size column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'drugs' AND column_name = 'pack_size'
    ) THEN
        ALTER TABLE drugs ADD COLUMN pack_size INTEGER DEFAULT 1 CHECK (pack_size > 0);
    END IF;
    
    -- Add reorder_level column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'drugs' AND column_name = 'reorder_level'
    ) THEN
        ALTER TABLE drugs ADD COLUMN reorder_level INTEGER DEFAULT 0 CHECK (reorder_level >= 0);
    END IF;
END $$;

-- Now fix the inventory_transactions table
DO $$
BEGIN
    -- Add type column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'inventory_transactions' AND column_name = 'type'
    ) THEN
        ALTER TABLE inventory_transactions ADD COLUMN type TEXT NOT NULL DEFAULT 'PURCHASE' CHECK (type IN ('PURCHASE', 'DISPENSE', 'ADJUSTMENT'));
    END IF;
    
    -- Add source column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'inventory_transactions' AND column_name = 'source'
    ) THEN
        ALTER TABLE inventory_transactions ADD COLUMN source TEXT DEFAULT 'manual';
    END IF;
END $$;

-- Fix DIN constraint to be more flexible
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_din_check;
ALTER TABLE drugs ADD CONSTRAINT drugs_din_check 
  CHECK (din ~ '^[0-9]{6,10}$');

-- Re-add unique constraint for drugs
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_user_id_din_key;
ALTER TABLE drugs ADD CONSTRAINT drugs_user_id_din_key UNIQUE (user_id, din);

-- Add indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_transactions_type ON inventory_transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_source ON inventory_transactions(source);