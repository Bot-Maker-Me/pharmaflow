import { useState } from 'react';
import {
  ArrowUpCircle,
  ArrowDownCircle,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { useTransactions } from '@/hooks/useTransactions';
import type { TransactionType } from '@/types/transaction';

const PAGE_SIZE = 10;

const typeConfig: Record<
  TransactionType,
  { icon: typeof ArrowUpCircle; style: string; label: string }
> = {
  PURCHASE: { icon: ArrowUpCircle, style: 'bg-success-50 text-success-700', label: 'Purchase' },
  DISPENSE: { icon: ArrowDownCircle, style: 'bg-error-50 text-error-700', label: 'Dispense' },
  ADJUSTMENT: { icon: SlidersHorizontal, style: 'bg-warning-50 text-warning-700', label: 'Adjustment' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SkeletonRow() {
  return (
    <tr className="border-b border-neutral-50">
      <td className="px-4 py-3.5"><div className="h-5 w-20 animate-pulse rounded-full bg-neutral-100" /></td>
      <td className="px-4 py-3.5"><div className="h-4 w-28 animate-pulse rounded bg-neutral-100" /></td>
      <td className="px-4 py-3.5"><div className="h-4 w-32 animate-pulse rounded bg-neutral-100" /></td>
      <td className="px-4 py-3.5"><div className="h-4 w-12 animate-pulse rounded bg-neutral-100" /></td>
      <td className="px-4 py-3.5"><div className="h-4 w-24 animate-pulse rounded bg-neutral-100" /></td>
      <td className="px-4 py-3.5"><div className="h-4 w-28 animate-pulse rounded bg-neutral-100" /></td>
    </tr>
  );
}

export default function TransactionHistory() {
  const [page, setPage] = useState(0);
  const { data, isLoading, isError, refetch } = useTransactions(page);

  const transactions = data?.data ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Transaction History</h1>
        <p className="mt-1 text-sm text-neutral-500">
          All inventory transactions ({totalCount} total)
        </p>
      </div>

      <div className="card overflow-hidden">
        {/* Error state */}
        {isError && (
          <div className="py-12 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-error-300" />
            <p className="mt-3 text-sm text-neutral-500">Failed to load transactions</p>
            <button onClick={() => refetch()} className="btn-secondary mt-3">
              Try again
            </button>
          </div>
        )}

        {!isError && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Drug</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">DIN</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Notes</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {isLoading && Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}

                {!isLoading &&
                  transactions.map((tx) => {
                    const config = typeConfig[tx.type];
                    const TypeIcon = config.icon;
                    const isPositive = tx.quantity > 0;
                    return (
                      <tr key={tx.id} className="transition-colors hover:bg-neutral-50/50">
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.style}`}
                          >
                            <TypeIcon className="h-3 w-3" />
                            {config.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-neutral-800">
                            {tx.drug_description}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm text-neutral-500">{tx.drug_din}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-sm font-semibold ${
                              isPositive ? 'text-success-600' : 'text-error-600'
                            }`}
                          >
                            {isPositive ? '+' : ''}
                            {tx.quantity}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-neutral-500">
                            {tx.notes || <span className="text-neutral-300">—</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-neutral-500">{formatDate(tx.created_at)}</span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>

            {!isLoading && transactions.length === 0 && (
              <div className="py-16 text-center">
                <Clock className="mx-auto h-10 w-10 text-neutral-300" />
                <p className="mt-3 text-sm text-neutral-400">No transactions yet</p>
                <p className="mt-1 text-xs text-neutral-400">
                  Add purchases or reduce stock from the Inventory page to see transactions here
                </p>
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        {!isError && !isLoading && totalCount > 0 && (
          <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3">
            <p className="text-xs text-neutral-400">
              Page {page + 1} of {totalPages} · {totalCount} transactions
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={!hasPrev}
                className="rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasNext}
                className="rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
