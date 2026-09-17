import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { InventoryTransaction, TransactionInput, TransactionWithDrug } from '@/types/transaction';

const PAGE_SIZE = 10;

interface FetchParams {
  page: number;
  search?: string;
  type?: TransactionType;
  source?: string;
  startDate?: string;
  endDate?: string;
}

async function fetchTransactions(params: FetchParams): Promise<{
  data: TransactionWithDrug[];
  count: number;
}> {
  const { page, search, type, source, startDate, endDate } = params;
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('inventory_transactions')
    .select('*, drugs!inner(description, din)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  // Apply search filter
  if (search) {
    query = query.or(`drugs.din.ilike.%${search}%,drugs.description.ilike.%${search}%`);
  }

  // Apply type filter (handle both 'type' and 'transaction_type' column names)
  if (type) {
    query = query.or(`transaction_type.eq.${type},type.eq.${type}`);
  }

  // Apply source filter (handle both 'source' column and case-insensitive matching)
  if (source) {
    query = query.ilike('source', source);
  }

  // Apply date range filter (handle both 'date' and 'created_at' column names)
  if (startDate) {
    // Ensure proper ISO date format
    const startISO = new Date(startDate).toISOString();
    query = query.or(`created_at.gte.${startISO},date.gte.${startISO}`);
  }
  if (endDate) {
    // Add one day to end date to include the entire end day
    const endISO = new Date(new Date(endDate).setDate(new Date(endDate).getDate() + 1)).toISOString();
    query = query.or(`created_at.lt.${endISO},date.lt.${endISO}`);
  }

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    data: (data ?? []).map((row) => {
      const drug = row.drugs as unknown as { description: string; din: string };
      return {
        id: row.id,
        user_id: row.user_id,
        drug_id: row.drug_id,
        type: (row as any).transaction_type || row.type,
        quantity: row.quantity,
        notes: row.notes,
        source: (row as any).source,
        created_at: (row as any).date || row.created_at,
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
    queryFn: () => fetchTransactions({ page }),
    placeholderData: (prev) => prev,
  });
}

export function useFilteredTransactions(params: FetchParams) {
  return useQuery({
    queryKey: ['transactions', 'filtered', params],
    queryFn: () => fetchTransactions(params),
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
