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
  const { data: existing, error: lookupError } = await supabase
    .from('drugs')
    .select('id')
    .eq('din', din)
    .limit(1);

  if (lookupError) throw lookupError;
  if (existing?.[0]?.id) return existing[0].id;

  const { data: created, error: createError } = await supabase
    .from('drugs')
    .insert({
      din,
      description: description?.trim() || `Imported DIN ${din}`,
      schedule: 'Verify',
      pack_size: 1,
      reorder_level: 0,
    })
    .select('id')
    .single();

  if (createError) throw createError;
  return created.id;
}

async function fetchImportedRecords(kind: ImportKind): Promise<ImportedRecordRow[]> {
  const { source } = KIND_CONFIG[kind];
  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('id, type, quantity, source, created_at, drugs!inner(din, description)')
    .eq('source', source)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const drug = row.drugs as unknown as { din: string; description: string };
    return {
      id: row.id,
      din: drug?.din ?? '--------',
      description: drug?.description ?? 'Unknown',
      quantity: Math.abs(Number(row.quantity ?? 0)),
      type: row.type as TransactionType,
      source: row.source,
      created_at: row.created_at,
    };
  });
}

async function saveImportedRecords({
  kind,
  records,
}: {
  kind: ImportKind;
  records: ParsedDinData[];
}): Promise<{ saved: number; skipped: number }> {
  const config = KIND_CONFIG[kind];
  let saved = 0;
  let skipped = 0;

  for (const record of records) {
    const qty = quantityForKind(kind, record);
    if (!record.din || qty === 0) {
      skipped += 1;
      continue;
    }

    const drugId = await ensureDrugId(record.din, record.description);
    const signedQty = config.type === 'PURCHASE' ? qty : -qty;

    const { error } = await supabase.from('inventory_transactions').insert({
      drug_id: drugId,
      type: config.type,
      quantity: signedQty,
      notes: `${config.notesPrefix} for DIN ${record.din}`,
      source: config.source,
    });

    if (error) throw error;
    saved += 1;
  }

  return { saved, skipped };
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
    mutationFn: (records: ParsedDinData[]) => saveImportedRecords({ kind, records }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['imported-records', kind] });
      queryClient.invalidateQueries({ queryKey: ['drugs'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
