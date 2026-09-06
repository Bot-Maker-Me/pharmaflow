import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { InventoryTransaction, TransactionInput, TransactionWithDrug } from '@/types/transaction';

const PAGE_SIZE = 10;

async function fetchTransactions(page: number): Promise<{
  data: TransactionWithDrug[];
  count: number;
}> {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error, count } = await supabase
    .from('inventory_transactions')
    .select('*, drugs!inner(description, din)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;

  return {
    data: (data ?? []).map((row) => {
      const drug = row.drugs as unknown as { description: string; din: string };
      return {
        id: row.id,
        user_id: row.user_id,
        drug_id: row.drug_id,
        type: row.type,
        quantity: row.quantity,
        notes: row.notes,
        source: row.source,
        created_at: row.created_at,
        drug_description: drug?.description ?? 'Unknown',
        drug_din: drug?.din ?? '--------',
      } as TransactionWithDrug;
    }),
    count: count ?? 0,
  };
}

async function addTransaction(input: TransactionInput): Promise<InventoryTransaction> {
  const { data, error } = await supabase.rpc('add_inventory_transaction', {
    p_drug_id: input.drug_id,
    p_type: input.type,
    p_quantity: input.quantity,
    p_notes: input.notes ?? null,
    p_source: input.source ?? 'manual',
  });

  if (error) throw error;
  return data as InventoryTransaction;
}

export function useTransactions(page: number) {
  return useQuery({
    queryKey: ['transactions', page],
    queryFn: () => fetchTransactions(page),
    placeholderData: (prev) => prev,
  });
}

export function useAddTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['drugs'] });
    },
  });
}
