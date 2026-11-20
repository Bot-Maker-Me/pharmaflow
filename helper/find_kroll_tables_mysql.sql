-- MySQL / MariaDB discovery queries. Run one at a time in MySQL Workbench / HeidiSQL / mysql CLI.
-- Replace Pharmacy with the real database name (first query shows it).

-- 0) Which databases exist, and which engine is this?
SELECT VERSION();
SHOW DATABASES;
USE Pharmacy;

-- 1) Every table with its row count (biggest first)
SELECT table_name, table_rows
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY table_rows DESC;

-- 2) Columns that can hold images/PDF bytes (fax storage)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND data_type IN ('blob','mediumblob','longblob','varbinary','binary')
ORDER BY table_name;

-- 3) Tables/columns whose NAME looks like fax / image / scan / script
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND (table_name REGEXP 'fax|image|img|scan|script|attach|doc'
    OR column_name REGEXP 'fax|image|img|scan|script|attach')
ORDER BY table_name, ordinal_position;

-- 4) Pending new prescriptions table: columns, then newest rows
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name LIKE '%Pending%' ORDER BY table_name, ordinal_position;
SELECT * FROM PendingNewRx ORDER BY 1 DESC LIMIT 10;

-- 5) Drug table: columns containing DIN / drug name
SELECT table_name, column_name, data_type FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND (column_name REGEXP 'DIN|DrugName|DrgName|Strength' OR table_name REGEXP '^(Drg|Drug|DrugMaster|Drugs)$')
ORDER BY table_name, ordinal_position;

-- 6) Dispensed prescriptions tables (used to rank DIN matches)
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name REGEXP '^(Rx|Script|Prescription|RxFill|Dispense)'
ORDER BY table_name, ordinal_position;

-- 7) Does a fax-image row really contain data? (fill in table/column found in step 2)
-- SELECT id, LENGTH(imagedata) AS bytes, HEX(LEFT(imagedata,4)) AS magic FROM <table> ORDER BY id DESC LIMIT 5;
--   magic FFD8FFE0/FFD8FFDB = JPEG, 89504E47 = PNG, 25504446 = PDF, 49492A00 = TIFF
