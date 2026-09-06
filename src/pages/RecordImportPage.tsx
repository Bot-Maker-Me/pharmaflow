import { useState, useCallback, useRef, type DragEvent } from 'react';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  Trash2,
  CheckCircle2,
  Loader2,
  X,
  Save,
  Pencil,
  Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { parseSingleFile } from '@/lib/fileParser';
import type { ParsedDinData } from '@/types/reconciliation';
import {
  useImportedRecords,
  useSaveImportedRecords,
  type ImportKind,
} from '@/hooks/useImportedRecords';

const KIND_META: Record<
  ImportKind,
  {
    title: string;
    subtitle: string;
    dropLabel: string;
    dropDescription: string;
    icon: typeof FileSpreadsheet;
    parseSource: 'mckesson' | 'kroll';
    qtyLabel: string;
  }
> = {
  purchase: {
    title: 'Purchase Records',
    subtitle: 'Upload and manage purchase records independently',
    dropLabel: 'Upload Purchase File',
    dropDescription: 'Upload your purchase records file (.csv, .xlsx, .xls)',
    icon: FileSpreadsheet,
    parseSource: 'mckesson',
    qtyLabel: 'Purchased',
  },
  dispense: {
    title: 'Dispensing Records',
    subtitle: 'Upload and manage dispensing records independently',
    dropLabel: 'Upload Dispensing File',
    dropDescription: 'Upload your dispensing records file (.csv, .xlsx, .xls)',
    icon: FileText,
    parseSource: 'kroll',
    qtyLabel: 'Dispensed',
  },
  destruction: {
    title: 'Destruction Records',
    subtitle: 'Upload and manage destruction records independently',
    dropLabel: 'Upload Destruction File',
    dropDescription: 'Upload your destruction records file (.csv, .xlsx, .xls)',
    icon: Trash2,
    parseSource: 'kroll',
    qtyLabel: 'Destroyed',
  },
};

export default function RecordImportPage({ kind }: { kind: ImportKind }) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const { data: savedRecords, isLoading: savedLoading } = useImportedRecords(kind);
  const saveMutation = useSaveImportedRecords(kind);

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [records, setRecords] = useState<ParsedDinData[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleFileDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;

    const ext = droppedFile.name.split('.').pop()?.toLowerCase();
    if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls') {
      toast.error('File must be .csv, .xlsx, or .xls');
      return;
    }
    setFile(droppedFile);
    setDragOver(false);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) setFile(selectedFile);
  };

  const handleProcessFile = async () => {
    if (!file) {
      toast.error('Please upload a file first');
      return;
    }

    setParsing(true);
    try {
      // Create deduplication set for single file processing
      const seenSignatures = new Set<string>();
      const parsedData = await parseSingleFile(file, meta.parseSource, seenSignatures);
      const recordsArray = Array.from(parsedData.values());
      setRecords(recordsArray);
      toast.success(`Processed ${recordsArray.length} records`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse file';
      toast.error(message);
    }
    setParsing(false);
  };

  const handleSaveRecords = async () => {
    if (records.length === 0) {
      toast.error('No parsed records to save');
      return;
    }

    try {
      const result = await saveMutation.mutateAsync(records);
      toast.success(`Saved ${result.saved} records${result.skipped ? ` (${result.skipped} skipped)` : ''}`);
      setRecords([]);
      setFile(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save records';
      toast.error(message);
    }
  };

  const handleEditRecord = (index: number) => {
    setEditingIndex(index);
  };

  const handleQuantityChange = (index: number, value: string) => {
    const newValue = parseInt(value, 10);
    if (isNaN(newValue) || newValue < 0) return;

    const updatedRecords = [...records];
    if (kind === 'purchase') {
      updatedRecords[index].purchased = newValue;
    } else if (kind === 'dispense') {
      updatedRecords[index].dispensed = newValue;
    } else {
      updatedRecords[index].dispensed = newValue;
    }

    setRecords(updatedRecords);
  };

  const handleBlur = () => {
    setEditingIndex(null);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">{meta.title}</h1>
        <p className="mt-1 text-sm text-neutral-500">{meta.subtitle}</p>
      </div>

      <div className="mb-6">
        <DropZone
          label={meta.dropLabel}
          description={meta.dropDescription}
          icon={Icon}
          file={file}
          dragOver={dragOver}
          accept=".csv,.xlsx,.xls"
          onDrop={handleFileDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onFileSelect={handleFileSelect}
          onClear={() => setFile(null)}
        />
      </div>

      <div className="mb-6 flex justify-center">
        <button
          className="btn-primary"
          onClick={handleProcessFile}
          disabled={!file || parsing}
        >
          {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {parsing ? 'Processing...' : 'Process File'}
        </button>
      </div>

      {records.length > 0 && (
        <div className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">
              Parsed Records ({records.length})
            </h2>
            <button className="btn-primary" onClick={handleSaveRecords} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saveMutation.isPending ? 'Saving...' : 'Save Records'}
            </button>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/50">
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">DIN</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Description</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">{meta.qtyLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record, index) => (
                    <tr key={`${record.din}-${index}`} className="border-b border-neutral-50 hover:bg-neutral-50/50">
                      <td className="px-3 py-3 text-sm font-mono text-neutral-800">{record.din}</td>
                      <td className="px-3 py-3 text-sm text-neutral-600">{record.description ?? '—'}</td>
                      <td className="px-3 py-3 text-right text-sm text-neutral-600">
                        {editingIndex === index ? (
                          <input
                            type="number"
                            autoFocus
                            defaultValue={kind === 'purchase' ? record.purchased : kind === 'dispense' ? record.dispensed : (record.dispensed || record.purchased)}
                            onChange={(e) => handleQuantityChange(index, e.target.value)}
                            onBlur={handleBlur}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              }
                            }}
                            className="w-24 rounded border border-primary-400 px-2 py-1 text-right text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
                            min="0"
                          />
                        ) : (
                          <span
                            onClick={() => handleEditRecord(index)}
                            className="cursor-pointer hover:bg-primary-50 hover:text-primary-600 rounded px-2 py-1 transition-colors"
                            title="Click to edit"
                          >
                            {kind === 'purchase' ? record.purchased : kind === 'dispense' ? record.dispensed : (record.dispensed || record.purchased)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-4 text-lg font-semibold text-neutral-900">Saved Records</h2>
        <div className="card overflow-hidden">
          {savedLoading ? (
            <div className="flex items-center justify-center py-12 text-neutral-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !savedRecords || savedRecords.length === 0 ? (
            <p className="py-12 text-center text-sm text-neutral-400">No saved records yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/50">
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">DIN</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Description</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">{meta.qtyLabel}</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {savedRecords.map((record) => (
                    <tr key={record.id} className="border-b border-neutral-50 hover:bg-neutral-50/50">
                      <td className="px-3 py-3 text-sm font-mono text-neutral-800">{record.din}</td>
                      <td className="px-3 py-3 text-sm text-neutral-600">{record.description}</td>
                      <td className="px-3 py-3 text-right text-sm text-neutral-600">{record.quantity}</td>
                      <td className="px-3 py-3 text-right text-xs text-neutral-400">
                        {new Date(record.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface DropZoneProps {
  label: string;
  description: string;
  icon: typeof FileSpreadsheet;
  file: File | null;
  dragOver: boolean;
  accept: string;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}

function DropZone(props: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const Icon = props.icon;

  return (
    <div
      onDrop={props.onDrop}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onClick={() => inputRef.current?.click()}
      className={`card relative flex cursor-pointer flex-col items-center justify-center p-8 transition-all duration-200 ${
        props.dragOver
          ? 'border-2 border-primary-400 bg-primary-50/30 scale-[1.02]'
          : 'border-2 border-dashed border-neutral-200 hover:border-primary-300 hover:bg-primary-50/20'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={props.accept}
        className="hidden"
        onChange={props.onFileSelect}
      />

      {props.file ? (
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-50">
              <CheckCircle2 className="h-5 w-5 text-success-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-800">{props.file.name}</p>
              <p className="text-xs text-neutral-400">{(props.file.size / 1024).toFixed(1)} KB</p>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onClear();
            }}
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-xl transition-colors ${
              props.dragOver ? 'bg-primary-100' : 'bg-neutral-100'
            }`}
          >
            <Icon className={`h-7 w-7 ${props.dragOver ? 'text-primary-600' : 'text-neutral-400'}`} />
          </div>
          <p className="mt-4 text-sm font-semibold text-neutral-700">{props.label}</p>
          <p className="mt-1 text-xs text-neutral-400">{props.description}</p>
          <p className="mt-2 text-xs text-neutral-300">Drag & drop or click to browse</p>
        </>
      )}
    </div>
  );
}
