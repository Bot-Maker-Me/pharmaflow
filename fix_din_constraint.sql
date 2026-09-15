-- Fix DIN constraint to be more flexible
-- Remove the strict 8-digit check and allow variable length DINs
-- This will handle real-world DINs that may have different formats

-- Drop the existing strict DIN check constraint
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_din_check;

-- Add a more flexible constraint that allows 6-10 digit DINs
ALTER TABLE drugs ADD CONSTRAINT drugs_din_check 
  CHECK (din ~ '^[0-9]{6,10}$');

-- Also remove the unique constraint temporarily to handle existing data
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_user_id_din_key;

-- Re-add unique constraint without the strict format requirement
ALTER TABLE drugs ADD CONSTRAINT drugs_user_id_din_key UNIQUE (user_id, din);