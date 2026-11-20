-- PharmFlow: find where Kroll stores incoming faxes, fax images and drug DINs.
-- Run each block separately. Read-only SELECTs, safe to run.
--
-- Option A (SQL Server Management Studio): open this file, select a block, press F5.
-- Option B (command line), one query at a time:
--   sqlcmd -S localhost -U YOUR_USER -P YOUR_PASSWORD -d YOUR_DATABASE -Q "<paste one query>"
-- Easiest: skip all this and run   python flow.py --find-images   (it tests your real recent faxes).

----------------------------------------------------------------------------------------------
-- 1. Which tables store binary data (fax images are VARBINARY / IMAGE columns)?
----------------------------------------------------------------------------------------------
SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS c
JOIN INFORMATION_SCHEMA.TABLES t
  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
WHERE c.DATA_TYPE IN ('varbinary', 'binary', 'image')
ORDER BY c.TABLE_NAME, c.COLUMN_NAME;

----------------------------------------------------------------------------------------------
-- 2. Tables or columns whose NAME mentions fax / image / scan / script
----------------------------------------------------------------------------------------------
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME LIKE '%fax%'   OR COLUMN_NAME LIKE '%fax%'
   OR TABLE_NAME LIKE '%image%' OR COLUMN_NAME LIKE '%image%'
   OR TABLE_NAME LIKE '%scan%'  OR COLUMN_NAME LIKE '%scan%'
   OR TABLE_NAME LIKE '%script%'
ORDER BY TABLE_NAME, ORDINAL_POSITION;

----------------------------------------------------------------------------------------------
-- 3. The pending prescription table the agent polls: does it have the fax-image link?
--    (expect a column like ScriptImageId; if not, block 2 shows what it is called)
----------------------------------------------------------------------------------------------
SELECT COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'PendingNewRx'
ORDER BY ORDINAL_POSITION;

-- the 10 newest pending prescriptions and whether each has a fax image id
-- (change ScriptImageId / PendingRxId if block 3 shows different names)
SELECT TOP 10 PendingRxId, ScriptImageId
FROM dbo.PendingNewRx WITH (NOLOCK)
ORDER BY PendingRxId DESC;

----------------------------------------------------------------------------------------------
-- 4. Kroll's drug table with a DIN column (used to find a missing DIN)
----------------------------------------------------------------------------------------------
SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.COLUMN_NAME LIKE '%DIN%'
ORDER BY c.TABLE_NAME;

-- then look at that table's columns (replace Drg with the table name from above)
SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Drg' ORDER BY ORDINAL_POSITION;
SELECT TOP 5 * FROM dbo.Drg WITH (NOLOCK);

----------------------------------------------------------------------------------------------
-- 5. Table of dispensed prescriptions (ranks DIN choices by how often you dispense them)
----------------------------------------------------------------------------------------------
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('Rx', 'RxFill', 'Prescription')
  AND (COLUMN_NAME LIKE '%Drg%' OR COLUMN_NAME LIKE '%Drug%')
ORDER BY TABLE_NAME;

----------------------------------------------------------------------------------------------
-- 6. Once block 1/2 shows the image table, check one real fax image (replace the names and 123):
----------------------------------------------------------------------------------------------
-- SELECT TOP 1 DATALENGTH(ImageData) AS bytes, LEFT(CONVERT(VARCHAR(8), ImageData), 4) AS header
-- FROM dbo.RxScriptImage WITH (NOLOCK) WHERE Id = 123;
