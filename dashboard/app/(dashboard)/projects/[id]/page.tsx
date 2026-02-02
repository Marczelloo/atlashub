'use client';

import { useState, useEffect, use } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Key,
  RefreshCw,
  Copy,
  Check,
  Play,
  Loader2,
  Table2,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronLeft,
  Search,
  Database,
  Columns,
  HelpCircle,
  Upload,
  Trash2,
  Download,
  Eye,
} from 'lucide-react';
import Link from 'next/link';
import Editor from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type Project, type ApiKey } from '@/lib/api';
import { useDemoApi } from '@/lib/demo-api';

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const api = useDemoApi();
  const [project, setProject] = useState<Project | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // SQL Editor state
  const [sql, setSql] = useState('SELECT 1 as test;');
  const [sqlResult, setSqlResult] = useState<{
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTimeMs: number;
  } | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  // Copied state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Tables state
  const [tables, setTables] = useState<Array<{ name: string; type: 'table' | 'view' }>>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableColumns, setTableColumns] = useState<
    Array<{ name: string; type: string; nullable: boolean; default: string | null }>
  >([]);
  const [tableData, setTableData] = useState<{
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
  } | null>(null);
  const [tableDataLoading, setTableDataLoading] = useState(false);
  const [tableLimit, setTableLimit] = useState(50);
  const [tableOffset, setTableOffset] = useState(0);
  const [tableFilter, setTableFilter] = useState('');
  const [tableOrderBy, setTableOrderBy] = useState<{ column: string; dir: 'ASC' | 'DESC' } | null>(
    null
  );
  const [tableViewMode, setTableViewMode] = useState<'schema' | 'data'>('data');

  // Storage state
  const [buckets, setBuckets] = useState<Array<{ id: string; name: string; createdAt: string }>>(
    []
  );
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [files, setFiles] = useState<Array<{ key: string; size: number; lastModified: string }>>(
    []
  );
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  useEffect(() => {
    loadProject();
    loadKeys();
    loadTables();
    loadBuckets();
  }, [id, api]);

  useEffect(() => {
    if (selectedTable) {
      loadTableColumns(selectedTable);
      loadTableData(selectedTable, tableLimit, tableOffset, tableOrderBy, tableFilter);
    }
  }, [selectedTable]);

  useEffect(() => {
    if (selectedTable) {
      loadTableData(selectedTable, tableLimit, tableOffset, tableOrderBy, tableFilter);
    }
  }, [tableLimit, tableOffset, tableOrderBy]);

  useEffect(() => {
    if (selectedBucket) {
      loadFiles(selectedBucket);
    }
  }, [selectedBucket]);

  async function loadProject() {
    try {
      const response = await api.getProject(id);
      setProject(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadKeys() {
    try {
      const response = await api.listProjectKeys(id);
      setApiKeys(response.data);
    } catch (err) {
      console.error('Failed to load keys:', err);
    }
  }

  async function loadTables() {
    try {
      const response = await api.listTables(id);
      setTables(response.data);
    } catch (err) {
      console.error('Failed to load tables:', err);
    }
  }

  async function loadTableColumns(tableName: string) {
    try {
      const response = await api.getTableColumns(id, tableName);
      setTableColumns(response.data);
    } catch (err) {
      console.error('Failed to load columns:', err);
    }
  }

  async function loadTableData(
    tableName: string,
    limit = 50,
    offset = 0,
    orderBy?: { column: string; dir: 'ASC' | 'DESC' } | null,
    filter?: string
  ) {
    setTableDataLoading(true);
    try {
      // Build data query
      let query = `SELECT * FROM "${tableName}"`;
      let countQuery = `SELECT COUNT(*) as total FROM "${tableName}"`;
      if (filter && filter.trim()) {
        query += ` WHERE ${filter}`;
        countQuery += ` WHERE ${filter}`;
      }
      if (orderBy) {
        query += ` ORDER BY "${orderBy.column}" ${orderBy.dir}`;
      }
      query += ` LIMIT ${limit} OFFSET ${offset}`;

      // Execute both queries
      const [dataResponse, countResponse] = await Promise.all([
        api.executeSQL(id, query),
        api.executeSQL(id, countQuery),
      ]);

      const totalCount = Number(countResponse.data.rows[0]?.total ?? 0);

      setTableData({
        columns: dataResponse.data.columns,
        rows: dataResponse.data.rows,
        rowCount: totalCount,
      });
    } catch (err) {
      console.error('Failed to load table data:', err);
      setTableData(null);
    } finally {
      setTableDataLoading(false);
    }
  }

  function handleTableSelect(tableName: string) {
    if (selectedTable === tableName) {
      setSelectedTable(null);
      setTableData(null);
      setTableColumns([]);
    } else {
      setSelectedTable(tableName);
      setTableOffset(0);
      setTableFilter('');
      setTableOrderBy(null);
    }
  }

  function handleColumnSort(column: string) {
    setTableOrderBy((prev) => {
      if (prev?.column === column) {
        return prev.dir === 'ASC' ? { column, dir: 'DESC' } : null;
      }
      return { column, dir: 'ASC' };
    });
  }

  function runTableQuery() {
    if (selectedTable) {
      loadTableData(selectedTable, tableLimit, tableOffset, tableOrderBy, tableFilter);
    }
  }

  async function loadBuckets() {
    try {
      const response = await api.listBuckets(id);
      setBuckets(response.data);
      if (response.data.length > 0 && !selectedBucket) {
        setSelectedBucket(response.data[0].name);
      }
    } catch (err) {
      console.error('Failed to load buckets:', err);
    }
  }

  async function loadFiles(bucketName: string) {
    try {
      const response = await api.listFiles(id, bucketName);
      setFiles(response.data);
    } catch (err) {
      console.error('Failed to load files:', err);
    }
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedBucket) return;

    setIsUploading(true);
    setUploadProgress(`Preparing to upload ${file.name}...`);

    try {
      // Get signed upload URL
      const { uploadUrl } = await api.getSignedUploadUrl(
        id,
        selectedBucket,
        file.name,
        file.type || 'application/octet-stream',
        file.size
      );

      setUploadProgress(`Uploading ${file.name}...`);

      // Upload directly to MinIO
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status}`);
      }

      setUploadProgress(`Upload complete!`);

      // Refresh file list
      await loadFiles(selectedBucket);

      // Clear the input
      event.target.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadProgress(null), 2000);
    }
  }

  async function handleDeleteFile(objectKey: string) {
    if (!selectedBucket) return;
    if (!confirm(`Are you sure you want to delete this file?\n\n${objectKey}`)) return;

    setDeletingFile(objectKey);
    try {
      await api.deleteFile(id, selectedBucket, objectKey);
      await loadFiles(selectedBucket);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingFile(null);
    }
  }

  async function handleDownloadFile(objectKey: string) {
    if (!selectedBucket) return;
    try {
      const { downloadUrl } = await api.getSignedDownloadUrl(id, selectedBucket, objectKey);
      window.open(downloadUrl, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  }

  async function handlePreviewFile(objectKey: string) {
    if (!selectedBucket) return;
    try {
      const { downloadUrl } = await api.getSignedDownloadUrl(id, selectedBucket, objectKey);
      window.open(downloadUrl, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    }
  }

  function isImageFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext || '');
  }

  async function handleRotateKey(keyType: 'publishable' | 'secret') {
    if (
      !confirm(
        `Are you sure you want to rotate the ${keyType} key? The old key will stop working immediately.`
      )
    ) {
      return;
    }
    try {
      const response = await api.rotateKey(id, keyType);
      alert(
        `New ${keyType} key: ${response.data.newKey}\n\nSave this key now. It will not be shown again.`
      );
      loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate key');
    }
  }

  async function handleExecuteSQL() {
    setIsExecuting(true);
    setSqlError(null);
    setSqlResult(null);

    try {
      const response = await api.executeSQL(id, sql);
      setSqlResult(response.data);
      // Refresh tables list in case a table was created/dropped
      loadTables();
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setIsExecuting(false);
    }
  }

  function copyToClipboard(text: string, keyId: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyId);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Project not found</h2>
          <Link href="/projects">
            <Button variant="outline">Back to Projects</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/projects">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          {project.description && <p className="text-muted-foreground">{project.description}</p>}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
      )}

      <Tabs defaultValue="tables" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tables">Tables</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="sql">SQL Editor</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
        </TabsList>

        <TabsContent value="tables" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Table List */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Tables</span>
                  <Button variant="ghost" size="icon" onClick={loadTables} className="h-6 w-6">
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                {tables.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    <Table2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No tables</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {tables.map((table) => (
                      <button
                        key={table.name}
                        type="button"
                        className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                          selectedTable === table.name
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted'
                        }`}
                        onClick={() => handleTableSelect(table.name)}
                      >
                        <Database className="h-3.5 w-3.5 shrink-0" />
                        <span className="font-mono truncate">{table.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Table Details Panel */}
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                {selectedTable ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-mono">{selectedTable}</CardTitle>
                      <CardDescription>
                        {tableViewMode === 'data' && tableData
                          ? `${tableData.rowCount} row${tableData.rowCount === 1 ? '' : 's'}`
                          : `${tableColumns.length} column${tableColumns.length === 1 ? '' : 's'}`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={tableViewMode === 'data' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTableViewMode('data')}
                      >
                        <Database className="h-3.5 w-3.5 mr-1" />
                        Data
                      </Button>
                      <Button
                        variant={tableViewMode === 'schema' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTableViewMode('schema')}
                      >
                        <Columns className="h-3.5 w-3.5 mr-1" />
                        Schema
                      </Button>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <HelpCircle className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-md">
                          <DialogHeader>
                            <DialogTitle>Table Browser Guide</DialogTitle>
                            <DialogDescription>
                              How to explore and filter your data
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 text-sm">
                            <div>
                              <h4 className="font-semibold mb-1">Data View</h4>
                              <p className="text-muted-foreground">
                                View and browse table rows with sorting, filtering, and pagination.
                              </p>
                            </div>
                            <div>
                              <h4 className="font-semibold mb-1">Schema View</h4>
                              <p className="text-muted-foreground">
                                See column names, types, nullability, and default values.
                              </p>
                            </div>
                            <div>
                              <h4 className="font-semibold mb-1">Filtering</h4>
                              <p className="text-muted-foreground mb-2">
                                Enter SQL WHERE conditions in the filter box:
                              </p>
                              <ul className="text-xs font-mono space-y-1 text-muted-foreground">
                                <li>• id = 123</li>
                                <li>• name LIKE &apos;%john%&apos;</li>
                                <li>• created_at &gt; &apos;2024-01-01&apos;</li>
                                <li>• status = &apos;active&apos; AND age &gt; 18</li>
                              </ul>
                            </div>
                            <div>
                              <h4 className="font-semibold mb-1">Sorting</h4>
                              <p className="text-muted-foreground">
                                Click any column header to sort. Click again to reverse, and a third
                                time to clear.
                              </p>
                            </div>
                            <div>
                              <h4 className="font-semibold mb-1">Pagination</h4>
                              <p className="text-muted-foreground">
                                Use Previous/Next buttons to navigate. Change rows per page with the
                                dropdown.
                              </p>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                ) : (
                  <div>
                    <CardTitle className="text-base">Select a Table</CardTitle>
                    <CardDescription>
                      Choose a table from the list to view its data and schema
                    </CardDescription>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {!selectedTable ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Table2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Select a table to browse its contents</p>
                  </div>
                ) : tableViewMode === 'schema' ? (
                  /* Schema View */
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Column</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Nullable</TableHead>
                          <TableHead>Default</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tableColumns.map((col) => (
                          <TableRow key={col.name}>
                            <TableCell className="font-mono text-xs">{col.name}</TableCell>
                            <TableCell className="text-xs">{col.type}</TableCell>
                            <TableCell className="text-xs">{col.nullable ? 'Yes' : 'No'}</TableCell>
                            <TableCell className="text-xs font-mono">
                              {col.default || '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  /* Data View */
                  <div className="space-y-4">
                    {/* Filter and Controls */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Filter: column = 'value' or column > 10..."
                          value={tableFilter}
                          onChange={(e) => setTableFilter(e.target.value)}
                          className="pl-9 font-mono text-sm"
                        />
                      </div>
                      <Button size="sm" onClick={runTableQuery} disabled={tableDataLoading}>
                        {tableDataLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                        <span className="ml-1">Apply</span>
                      </Button>
                    </div>

                    {/* Data Table */}
                    {tableDataLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : tableData && tableData.rows.length > 0 ? (
                      <>
                        <div className="rounded-md border overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {tableData.columns.map((col) => (
                                  <TableHead
                                    key={col}
                                    className="cursor-pointer hover:bg-muted/50 whitespace-nowrap"
                                    onClick={() => handleColumnSort(col)}
                                  >
                                    <div className="flex items-center gap-1">
                                      <span className="font-mono text-xs">{col}</span>
                                      {tableOrderBy?.column === col &&
                                        (tableOrderBy.dir === 'ASC' ? (
                                          <ArrowUp className="h-3 w-3" />
                                        ) : (
                                          <ArrowDown className="h-3 w-3" />
                                        ))}
                                    </div>
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {tableData.rows.map((row, idx) => (
                                <TableRow key={idx}>
                                  {tableData.columns.map((col) => (
                                    <TableCell
                                      key={col}
                                      className="font-mono text-xs max-w-50 truncate"
                                    >
                                      {row[col] === null ? (
                                        <span className="text-muted-foreground italic">null</span>
                                      ) : typeof row[col] === 'object' ? (
                                        JSON.stringify(row[col])
                                      ) : (
                                        String(row[col])
                                      )}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {/* Pagination */}
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-4">
                            <span className="text-muted-foreground">
                              Showing {tableOffset + 1} -{' '}
                              {Math.min(tableOffset + tableData.rows.length, tableData.rowCount)} of{' '}
                              {tableData.rowCount}
                            </span>
                            <select
                              value={tableLimit}
                              onChange={(e) => {
                                setTableLimit(Number(e.target.value));
                                setTableOffset(0);
                              }}
                              className="h-8 rounded-md border bg-background px-2 text-xs"
                            >
                              <option value={25}>25 rows</option>
                              <option value={50}>50 rows</option>
                              <option value={100}>100 rows</option>
                              <option value={250}>250 rows</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={tableOffset === 0}
                              onClick={() => setTableOffset(Math.max(0, tableOffset - tableLimit))}
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Previous
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={tableOffset + tableLimit >= tableData.rowCount}
                              onClick={() => setTableOffset(tableOffset + tableLimit)}
                            >
                              Next
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <Table2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No data found</p>
                        {tableFilter && <p className="text-sm mt-1">Try adjusting your filter</p>}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="storage" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Storage Buckets</CardTitle>
                  <CardDescription>
                    {buckets.length === 0
                      ? 'No buckets configured'
                      : `${buckets.length} bucket${buckets.length === 1 ? '' : 's'} available`}
                  </CardDescription>
                </div>
                {selectedBucket && (
                  <div className="flex items-center gap-2">
                    {uploadProgress && (
                      <span className="text-sm text-muted-foreground">{uploadProgress}</span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isUploading}
                      onClick={() => document.getElementById('file-upload')?.click()}
                    >
                      {isUploading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      Upload File
                    </Button>
                    <input
                      id="file-upload"
                      type="file"
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={isUploading}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => selectedBucket && loadFiles(selectedBucket)}
                      className="h-8 w-8"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {buckets.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No buckets found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    {buckets.map((bucket) => (
                      <Button
                        key={bucket.id}
                        variant={selectedBucket === bucket.name ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedBucket(bucket.name)}
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        {bucket.name}
                      </Button>
                    ))}
                  </div>
                  {selectedBucket && (
                    <div className="border rounded-lg">
                      {files.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No files in this bucket</p>
                          <p className="text-xs mt-1">Upload a file to get started</p>
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>File</TableHead>
                              <TableHead>Size</TableHead>
                              <TableHead>Last Modified</TableHead>
                              <TableHead className="w-28 text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {files.map((file) => (
                              <TableRow key={file.key}>
                                <TableCell className="font-mono text-xs">
                                  {file.key.replace(`${selectedBucket}/`, '')}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {file.size > 1024 * 1024
                                    ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
                                    : file.size > 1024
                                      ? `${(file.size / 1024).toFixed(2)} KB`
                                      : `${file.size} B`}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {new Date(file.lastModified).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-0.5">
                                    {isImageFile(file.key) && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => handlePreviewFile(file.key)}
                                        title="Preview image"
                                      >
                                        <Eye className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => handleDownloadFile(file.key)}
                                      title="Download file"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                      onClick={() => handleDeleteFile(file.key)}
                                      disabled={deletingFile === file.key}
                                      title="Delete file"
                                    >
                                      {deletingFile === file.key ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sql" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Query Editor</CardTitle>
                <Button onClick={handleExecuteSQL} disabled={isExecuting} size="sm">
                  {isExecuting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Run Query
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="border-t border-border">
                <Editor
                  height="200px"
                  language="sql"
                  theme="vs-dark"
                  value={sql}
                  onChange={(value) => setSql(value || '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    automaticLayout: true,
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {sqlError && (
            <Card className="border-destructive">
              <CardContent className="pt-6">
                <p className="text-sm text-destructive font-mono">{sqlError}</p>
              </CardContent>
            </Card>
          )}

          {sqlResult && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Results</CardTitle>
                  <CardDescription>
                    {sqlResult.rowCount} rows in {sqlResult.executionTimeMs}ms
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="border-t border-border overflow-auto max-h-96">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {sqlResult.columns.map((col) => (
                          <TableHead key={col} className="whitespace-nowrap">
                            {col}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sqlResult.rows.map((row, i) => (
                        <TableRow key={i}>
                          {sqlResult.columns.map((col) => (
                            <TableCell
                              key={col}
                              className="font-mono text-xs max-w-xs truncate"
                              title={String(row[col] ?? '')}
                            >
                              {row[col] === null ? (
                                <span className="text-muted-foreground italic">null</span>
                              ) : (
                                String(row[col])
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="keys" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">API Keys</CardTitle>
              <CardDescription>
                Use these keys to authenticate requests from your applications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {apiKeys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-md bg-muted">
                        <Key className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium capitalize">{key.keyType} Key</p>
                        <p className="text-sm text-muted-foreground font-mono">
                          {key.keyPrefix}...
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(key.keyPrefix, key.id)}
                      >
                        {copiedKey === key.id ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRotateKey(key.keyType)}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Rotate
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
