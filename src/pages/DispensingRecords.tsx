import { Loader2, FileText, Trash2 } from 'lucide-react';
import { useImportedRecords, useDeleteImportedFile } from '@/hooks/useImportedRecords';
import toast from 'react-hot-toast';

export default function DispensingRecords() {
  const { data: savedRecords, isLoading: savedLoading } = useImportedRecords('dispense');
  const deleteMutation = useDeleteImportedFile('dispense');

  const handleDeleteFile = async (fileName: string) => {
    const isDateBasedLabel = fileName.startsWith('Imported ');
    
    if (isDateBasedLabel) {
      toast.error('Cannot delete records imported before file tracking was added. Please delete them individually from Transaction History.');
      return;
    }

    if (!confirm(`Are you sure you want to delete all records from "${fileName}"? This will also remove them from Transaction History.`)) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(fileName);
      toast.success(`Deleted all records from "${fileName}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete records';
      toast.error(message);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Dispensing Records</h1>
        <p className="mt-1 text-sm text-neutral-500">View all uploaded dispensing records (raw data from files)</p>
      </div>

      <div className="card overflow-hidden">
        {savedLoading ? (
          <div className="flex items-center justify-center py-12 text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !savedRecords || savedRecords.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="mx-auto h-12 w-12 text-neutral-300" />
            <p className="mt-4 text-sm text-neutral-400">No dispensing records uploaded yet</p>
            <p className="mt-2 text-xs text-neutral-400">Go to Upload File to add dispensing records</p>
          </div>
        ) : (
          <div>
            {(() => {
              const groupedRecords = new Map<string, typeof savedRecords>();
              savedRecords.forEach(record => {
                const fileName = record.file_name || `Imported ${new Date(record.created_at).toLocaleDateString()}`;
                if (!groupedRecords.has(fileName)) {
                  groupedRecords.set(fileName, []);
                }
                groupedRecords.get(fileName)!.push(record);
              });

              if (groupedRecords.size === 0) {
                return (
                  <div className="py-12 text-center">
                    <FileText className="mx-auto h-12 w-12 text-neutral-300" />
                    <p className="mt-4 text-sm text-neutral-400">No dispensing records uploaded yet</p>
                  </div>
                );
              }

              return Array.from(groupedRecords.entries()).map(([fileName, records]) => (
                <div key={fileName} className="border-b border-neutral-100 last:border-b-0">
                  <div className="flex items-center justify-between bg-neutral-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-neutral-500" />
                      <span className="text-sm font-medium text-neutral-800">{fileName}</span>
                      <span className="text-xs text-neutral-500">({records.length} rows)</span>
                    </div>
                    <button
                      onClick={() => handleDeleteFile(fileName)}
                      disabled={deleteMutation.isPending}
                      className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-error-50 hover:text-error-600 disabled:opacity-50"
                      title="Delete all records from this file"
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-neutral-100 bg-neutral-50/50">
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">DIN</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Description</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">Dispensed</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">Uploaded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((record) => (
                          <tr key={record.id} className="border-b border-neutral-50 hover:bg-neutral-50/50">
                            <td className="px-4 py-3 text-sm font-mono text-neutral-800">{record.din}</td>
                            <td className="px-4 py-3 text-sm text-neutral-600">{record.description}</td>
                            <td className="px-4 py-3 text-right text-sm text-neutral-600">{record.quantity}</td>
                            <td className="px-4 py-3 text-right text-xs text-neutral-400">
                              {new Date(record.created_at).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}