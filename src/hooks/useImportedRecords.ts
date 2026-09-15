import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ParsedDinData } from '@/types/reconciliation';
import type { TransactionType } from '@/types/transaction';

export type ImportKind = 'purchase' | 'dispense' | 'destruction';

export interface ImportedRecordRow {
  id: string;
  din: string;
  description: string;
  quantity: number;
  type: TransactionType;
  source: string;
  created_at: string;
  file_name?: string;
}

export interface SaveResult {
  saved: number;
  skipped: number;
  errors: string[];
}

const KIND_CONFIG: Record<
  ImportKind,
  { type: TransactionType; source: string; notesPrefix: string }
> = {
  purchase: { type: 'PURCHASE', source: 'purchase_import', notesPrefix: 'Purchase import' },
  dispense: { type: 'DISPENSE', source: 'dispense_import', notesPrefix: 'Dispense import' },
  destruction: { type: 'ADJUSTMENT', source: 'destruction_import', notesPrefix: 'Destruction import' },
};

function quantityForKind(kind: ImportKind, record: ParsedDinData): number {
  if (kind === 'purchase') return Math.abs(record.purchased) || 0;
  if (kind === 'dispense') return Math.abs(record.dispensed) || 0;
  return Math.abs(record.dispensed || record.purchased || 0);
}

async function ensureDrugId(din: string, description?: string): Promise<string> {
  // Normalize DIN - remove any non-digit characters and preserve original length
  const normalizedDin = din.toString().replace(/\D/g, '');
  
  // Validate DIN is between 6-10 digits
  if (!/^\d{6,10}$/.test(normalizedDin)) {
    console.warn(`Invalid DIN format: ${din} -> ${normalizedDin}`);
    throw new Error(`Invalid DIN format: ${din}. DIN must be 6-10 digits.`);
  }

  const { data: existing, error: lookupError } = await supabase
    .from('drugs')
    .select('id')
    .eq('din', normalizedDin)
    .limit(1);

  if (lookupError) {
    console.error('Error looking up drug:', lookupError);
    throw new Error(`Failed to lookup drug ${normalizedDin}: ${lookupError.message}`);
  }
  
  if (existing?.[0]?.id) return existing[0].id;

  const { data: created, error: createError } = await supabase
    .from('drugs')
    .insert({
      din: normalizedDin,
      description: description?.trim() || `Imported DIN ${normalizedDin}`,
      schedule: 'Verify',
    })
    .select('id')
    .single();

  if (createError) {
    console.error('Error creating drug:', createError);
    throw new Error(`Failed to create drug ${normalizedDin}: ${createError.message}`);
  }
  
  return created.id;
}

async function fetchImportedRecords(kind: ImportKind): Promise<ImportedRecordRow[]> {
  const config = KIND_CONFIG[kind];
  
  // Filter by transaction_type instead of source for reliability
  let query = supabase
    .from('inventory_transactions')
    .select('id, transaction_type, quantity, created_at, date, file_name, drugs!inner(din, description)')
    .eq('transaction_type', config.type)
    .order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching imported records:', error);
    throw error;
  }

  console.log(`Fetched ${data?.length || 0} records for kind ${kind}`);

  return (data ?? []).map((row) => {
    const drug = row.drugs as unknown as { din: string; description: string };
    return {
      id: row.id,
      din: drug?.din ?? '--------',
      description: drug?.description ?? 'Unknown',
      quantity: Math.abs(Number(row.quantity ?? 0)),
      type: (row as any).transaction_type || row.type || KIND_CONFIG[kind].type as TransactionType,
      source: (row as any).source || KIND_CONFIG[kind].source,
      created_at: (row as any).date || row.created_at || new Date().toISOString(),
      file_name: (row as any).file_name,
    };
  });
}

async function saveImportedRecords({
  kind,
  records,
  fileName,
}: {
  kind: ImportKind;
  records: ParsedDinData[];
  fileName?: string;
}): Promise<SaveResult> {
  const config = KIND_CONFIG[kind];
  let saved = 0;
  let skipped = 0;
  const errors: string[] = [];

  console.log(`Starting to save ${records.length} ${kind} records...`);

  for (const record of records) {
    try {
      const qty = quantityForKind(kind, record);
      if (!record.din || qty === 0) {
        console.log(`Skipping record with invalid DIN or zero quantity: ${record.din}`);
        skipped += 1;
        continue;
      }

      console.log(`Processing DIN ${record.din} with quantity ${qty}`);
      const drugId = await ensureDrugId(record.din, record.description);
      const signedQty = config.type === 'PURCHASE' ? qty : -qty;

      const { error: txError } = await supabase.from('inventory_transactions').insert({
        drug_id: drugId,
        transaction_type: config.type,
        quantity: signedQty,
        date: new Date().toISOString(),
        file_name: fileName,
      });

      if (txError) {
        console.error(`Error saving transaction for DIN ${record.din}:`, txError);
        errors.push(`DIN ${record.din}: ${txError.message}`);
        skipped += 1;
      } else {
        console.log(`Successfully saved transaction for DIN ${record.din}`);
        saved += 1;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Error processing record DIN ${record.din}:`, errorMessage);
      errors.push(`DIN ${record.din}: ${errorMessage}`);
      skipped += 1;
    }
  }

  console.log(`Save complete: ${saved} saved, ${skipped} skipped, ${errors.length} errors`);
  return { saved, skipped, errors };
}

export function useImportedRecords(kind: ImportKind) {
  return useQuery({
    queryKey: ['imported-records', kind],
    queryFn: () => fetchImportedRecords(kind),
  });
}

export function useSaveImportedRecords(kind: ImportKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ records, fileName }: { records: ParsedDinData[]; fileName?: string }) => 
      saveImportedRecords({ kind, records, fileName }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['imported-records', kind] });
      queryClient.invalidateQueries({ queryKey: ['drugs'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      
      // Log any errors that occurred during save
      if (result.errors.length > 0) {
        console.warn('Errors during save:', result.errors);
      }
    },
  });
}

async function deleteTransactionsByFileName(fileName: string, kind: ImportKind): Promise<number> {
  const config = KIND_CONFIG[kind];
  
  const { error } = await supabase
    .from('inventory_transactions')
    .delete()
    .eq('file_name', fileName)
    .eq('transaction_type', config.type);

  if (error) throw error;
  return 0; // Supabase doesn't return count, we'll rely on cache invalidation
}

export function useDeleteImportedFile(kind: ImportKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileName: string) => deleteTransactionsByFileName(fileName, kind),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['imported-records', kind] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['drugs'] });
    },
  });
}
