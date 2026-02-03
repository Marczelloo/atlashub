'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Upload,
  Download,
  FileUp,
  FileDown,
  Loader2,
  Check,
  Clock,
  AlertCircle,
  RefreshCw,
  FileText,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDemoApi } from '@/lib/demo-api';

interface ImportExportJob {
  id: string;
  projectId: string;
  jobType: 'import' | 'export';
  status: 'pending' | 'running' | 'completed' | 'failed';
  tableName: string;
  format: 'csv' | 'json';
  rowCount?: number | null;
  errorMessage?: string | null;
  objectKey?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

interface TableInfo {
  name: string;
  type: 'table' | 'view';
}

export default function ProjectDataToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const api = useDemoApi();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [jobs, setJobs] = useState<ImportExportJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Export form state
  const [exportTable, setExportTable] = useState('');
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [isExporting, setIsExporting] = useState(false);

  // Import form state
  const [importTable, setImportTable] = useState('');
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importMode, setImportMode] = useState<'insert' | 'upsert'>('insert');
  const [importData, setImportData] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    loadTables();
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadTables() {
    try {
      const response = await api.listTables(id);
      setTables(response.data);
      if (response.data.length > 0) {
        setExportTable(response.data[0].name);
        setImportTable(response.data[0].name);
      }
    } catch (err) {
      console.error('Failed to load tables:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadJobs() {
    try {
      const response = await api.listDataToolsJobs(id);
      setJobs(response.data);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  }

  async function handleExport() {
    if (!exportTable) {
      setError('Please select a table to export');
      return;
    }

    setIsExporting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await api.exportTable(id, exportTable, exportFormat);

      // Create download
      const blob = new Blob([response], {
        type: exportFormat === 'csv' ? 'text/csv' : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportTable}_export.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess(`Successfully exported ${exportTable}`);
      loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImport() {
    if (!importTable) {
      setError('Please select a table to import into');
      return;
    }
    if (!importData.trim()) {
      setError('Please paste or enter data to import');
      return;
    }

    setIsImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await api.importTable(id, importTable, importFormat, importData, importMode);
      setSuccess(`Successfully imported ${response.data.rowCount} rows into ${importTable}`);
      setImportData('');
      loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'completed':
        return <Check className="h-4 w-4 text-emerald-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-zinc-400" />;
    }
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-zinc-800 rounded" />
          <div className="h-64 bg-zinc-800 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href={`/projects/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Data Tools</h1>
          <p className="text-zinc-400">Import and export table data</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg flex items-center gap-2">
          <Check className="h-4 w-4" />
          {success}
        </div>
      )}

      <Tabs defaultValue="export" className="space-y-6">
        <TabsList>
          <TabsTrigger value="export">
            <FileDown className="h-4 w-4 mr-2" />
            Export
          </TabsTrigger>
          <TabsTrigger value="import">
            <FileUp className="h-4 w-4 mr-2" />
            Import
          </TabsTrigger>
          <TabsTrigger value="history">
            <Clock className="h-4 w-4 mr-2" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="export">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-lg">Export Table Data</CardTitle>
              <CardDescription>Download table data as CSV or JSON</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Table</Label>
                  <div className="relative">
                    <select
                      value={exportTable}
                      onChange={(e) => setExportTable(e.target.value)}
                      className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm appearance-none"
                    >
                      {tables.map((table) => (
                        <option key={table.name} value={table.name}>
                          {table.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-3 h-4 w-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Format</Label>
                  <div className="relative">
                    <select
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value as 'csv' | 'json')}
                      className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm appearance-none"
                    >
                      <option value="csv">CSV</option>
                      <option value="json">JSON</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-3 h-4 w-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>
              </div>
              <Button onClick={handleExport} disabled={isExporting || tables.length === 0}>
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Export Table
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-lg">Import Table Data</CardTitle>
              <CardDescription>Upload or paste data to import into a table</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Table</Label>
                  <div className="relative">
                    <select
                      value={importTable}
                      onChange={(e) => setImportTable(e.target.value)}
                      className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm appearance-none"
                    >
                      {tables.map((table) => (
                        <option key={table.name} value={table.name}>
                          {table.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-3 h-4 w-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Format</Label>
                  <div className="relative">
                    <select
                      value={importFormat}
                      onChange={(e) => setImportFormat(e.target.value as 'csv' | 'json')}
                      className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm appearance-none"
                    >
                      <option value="csv">CSV</option>
                      <option value="json">JSON</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-3 h-4 w-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Mode</Label>
                  <div className="relative">
                    <select
                      value={importMode}
                      onChange={(e) => setImportMode(e.target.value as 'insert' | 'upsert')}
                      className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm appearance-none"
                    >
                      <option value="insert">Insert (add new rows)</option>
                      <option value="upsert">Upsert (update existing)</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-3 h-4 w-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Data</Label>
                <textarea
                  value={importData}
                  onChange={(e) => setImportData(e.target.value)}
                  placeholder={
                    importFormat === 'csv'
                      ? 'Paste CSV data here...\n\nExample:\nid,name,email\n1,John,john@example.com\n2,Jane,jane@example.com'
                      : 'Paste JSON array here...\n\nExample:\n[\n  {"id": 1, "name": "John", "email": "john@example.com"},\n  {"id": 2, "name": "Jane", "email": "jane@example.com"}\n]'
                  }
                  className="w-full h-48 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-mono resize-none"
                />
              </div>

              <Button onClick={handleImport} disabled={isImporting || tables.length === 0}>
                {isImporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Import Data
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Job History</CardTitle>
                  <CardDescription>Recent import and export operations</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={loadJobs}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {jobs.length === 0 ? (
                <div className="text-center py-12 text-zinc-400">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No import/export jobs yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Table</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(job.status)}
                            <span className="capitalize text-sm">{job.status}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="capitalize text-sm">{job.jobType}</span>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{job.tableName}</TableCell>
                        <TableCell className="uppercase text-sm">{job.format}</TableCell>
                        <TableCell className="text-sm">{job.rowCount ?? '-'}</TableCell>
                        <TableCell className="text-sm text-zinc-400">
                          {new Date(job.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
