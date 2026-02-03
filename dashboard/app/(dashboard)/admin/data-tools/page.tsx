'use client';

import { useState, useEffect } from 'react';
import {
  FileUp,
  FileDown,
  FileText,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Table,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, type ImportExportJob, type Project } from '@/lib/api';
import { useDemo } from '@/lib/demo-context';

export default function DataToolsPage() {
  const { isDemo } = useDemo();
  const [jobs, setJobs] = useState<ImportExportJob[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('export');

  // Export form
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportForm, setExportForm] = useState({
    projectId: '',
    tableName: '',
    format: 'csv' as 'csv' | 'json',
  });

  // Import form
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importForm, setImportForm] = useState({
    projectId: '',
    tableName: '',
    mode: 'insert' as 'insert' | 'upsert',
    format: 'csv' as 'csv' | 'json',
    file: null as File | null,
  });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (isDemo) {
      // Mock data
      setJobs([
        {
          id: 'job-1',
          projectId: 'proj-demo-1',
          jobType: 'export',
          tableName: 'users',
          format: 'csv',
          objectKey: 'exports/users_2024-01-15.csv',
          rowCount: 150,
          status: 'completed',
          errorMessage: null,
          createdBy: 'user-1',
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000 + 5000).toISOString(),
        },
        {
          id: 'job-2',
          projectId: 'proj-demo-1',
          jobType: 'import',
          tableName: 'products',
          format: 'json',
          objectKey: 'imports/products_2024-01-15.json',
          rowCount: 45,
          status: 'completed',
          errorMessage: null,
          createdBy: 'user-1',
          createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          completedAt: new Date(Date.now() - 4 * 60 * 60 * 1000 + 8000).toISOString(),
        },
        {
          id: 'job-3',
          projectId: 'proj-demo-1',
          jobType: 'export',
          tableName: 'orders',
          format: 'json',
          objectKey: null,
          rowCount: null,
          status: 'failed',
          errorMessage: 'Table not found: orders',
          createdBy: 'user-1',
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 1000).toISOString(),
        },
      ]);
      setProjects([
        {
          id: 'proj-demo-1',
          name: 'Demo Project',
          description: null,
          createdAt: '',
          updatedAt: '',
        },
      ]);
      setLoading(false);
      return;
    }

    loadData();
  }, [isDemo]);

  async function loadData() {
    try {
      setLoading(true);
      const projectsRes = await api.listProjects();
      setProjects(projectsRes.data);

      // Load jobs from all projects
      const allJobs: ImportExportJob[] = [];
      await Promise.all(
        projectsRes.data.map(async (project) => {
          try {
            const jobsRes = await api.listDataToolsJobs(project.id);
            allJobs.push(...jobsRes.data);
          } catch {
            // Project may not have data tools enabled, skip
          }
        })
      );
      setJobs(
        allJobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (isDemo) {
      setError('Cannot export in demo mode');
      return;
    }

    try {
      setUploading(true);
      setError(null);
      const exportData = await api.exportTable(
        exportForm.projectId,
        exportForm.tableName,
        exportForm.format
      );
      // Trigger download
      const blob = new Blob([exportData], {
        type: exportForm.format === 'csv' ? 'text/csv' : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportForm.tableName}.${exportForm.format}`;
      a.click();
      URL.revokeObjectURL(url);

      setSuccess('Export completed successfully.');
      setExportDialogOpen(false);
      setExportForm({ projectId: '', tableName: '', format: 'csv' });
      loadData();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export');
    } finally {
      setUploading(false);
    }
  }

  async function handleImport() {
    if (isDemo) {
      setError('Cannot import in demo mode');
      return;
    }

    if (!importForm.file) {
      setError('Please select a file');
      return;
    }

    try {
      setUploading(true);
      setError(null);

      // Read file content
      const fileContent = await importForm.file.text();

      // Import table directly with data
      await api.importTable(
        importForm.projectId,
        importForm.tableName,
        importForm.format,
        fileContent,
        importForm.mode
      );

      setSuccess('Import started. Data will be imported shortly.');
      setImportDialogOpen(false);
      setImportForm({
        projectId: '',
        tableName: '',
        mode: 'insert',
        format: 'csv',
        file: null,
      });
      loadData();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setUploading(false);
    }
  }

  async function handleDownloadExport(job: ImportExportJob) {
    if (isDemo) {
      setError('Cannot download in demo mode');
      return;
    }

    if (!job.objectKey) {
      setError('No file available for download');
      return;
    }

    try {
      // Find the project to get bucket name
      const project = projects.find((p) => p.id === job.projectId);
      if (!project) {
        setError('Project not found');
        return;
      }
      const result = await api.getSignedDownloadUrl(job.projectId, 'exports', job.objectKey);
      window.open(result.downloadUrl, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get download URL');
    }
  }

  function getStatusIcon(status: ImportExportJob['status']) {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-emerald-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  }

  const exportJobs = jobs.filter((j) => j.jobType === 'export');
  const importJobs = jobs.filter((j) => j.jobType === 'import');

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-10 w-64 bg-muted rounded" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-muted rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Data Tools</h1>
          <p className="text-muted-foreground">Import and export table data</p>
        </div>
        {!isDemo && (
          <Button variant="ghost" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-emerald-500/10 text-emerald-500 rounded-lg">{success}</div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="export" className="flex items-center gap-2">
            <FileDown className="h-4 w-4" />
            Export
          </TabsTrigger>
          <TabsTrigger value="import" className="flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            Import
          </TabsTrigger>
        </TabsList>

        <TabsContent value="export">
          <div className="mb-6">
            <Button onClick={() => setExportDialogOpen(true)}>
              <FileDown className="h-4 w-4 mr-2" />
              New Export
            </Button>
          </div>

          {exportJobs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileDown className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No exports yet</h3>
                <p className="text-muted-foreground mb-4">Export your table data to CSV or JSON.</p>
                <Button onClick={() => setExportDialogOpen(true)}>
                  <FileDown className="h-4 w-4 mr-2" />
                  New Export
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {exportJobs.map((job) => (
                <Card key={job.id}>
                  <CardHeader className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                          <Table className="h-4 w-4 text-blue-500" />
                        </div>
                        <div>
                          <CardTitle className="text-sm flex items-center gap-2">
                            {job.tableName}
                            <span className="text-xs font-normal text-muted-foreground uppercase">
                              {job.format}
                            </span>
                            {getStatusIcon(job.status)}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {projects.find((p) => p.id === job.projectId)?.name || job.projectId} •{' '}
                            {new Date(job.createdAt).toLocaleString()}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {job.rowCount !== null && (
                          <span className="text-sm text-muted-foreground">
                            {job.rowCount.toLocaleString()} rows
                          </span>
                        )}
                        {job.status === 'completed' && job.objectKey && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadExport(job)}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </Button>
                        )}
                      </div>
                    </div>
                    {job.errorMessage && (
                      <div className="mt-2 p-2 bg-red-500/10 text-red-500 rounded text-xs">
                        {job.errorMessage}
                      </div>
                    )}
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="import">
          <div className="mb-6">
            <Button onClick={() => setImportDialogOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              New Import
            </Button>
          </div>

          {importJobs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No imports yet</h3>
                <p className="text-muted-foreground mb-4">Import data from CSV or JSON files.</p>
                <Button onClick={() => setImportDialogOpen(true)}>
                  <Upload className="h-4 w-4 mr-2" />
                  New Import
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {importJobs.map((job) => (
                <Card key={job.id}>
                  <CardHeader className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                          <FileUp className="h-4 w-4 text-emerald-500" />
                        </div>
                        <div>
                          <CardTitle className="text-sm flex items-center gap-2">
                            {job.tableName}
                            <span className="text-xs font-normal text-muted-foreground uppercase">
                              {job.format}
                            </span>
                            {getStatusIcon(job.status)}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {projects.find((p) => p.id === job.projectId)?.name || job.projectId} •{' '}
                            {new Date(job.createdAt).toLocaleString()}
                          </CardDescription>
                        </div>
                      </div>
                      {job.rowCount !== null && (
                        <span className="text-sm text-muted-foreground">
                          {job.rowCount.toLocaleString()} rows
                        </span>
                      )}
                    </div>
                    {job.errorMessage && (
                      <div className="mt-2 p-2 bg-red-500/10 text-red-500 rounded text-xs">
                        {job.errorMessage}
                      </div>
                    )}
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Export Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Export Table</DialogTitle>
            <DialogDescription>Export table data to CSV or JSON format.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <select
                value={exportForm.projectId}
                onChange={(e) => setExportForm({ ...exportForm, projectId: e.target.value })}
                className="w-full px-3 py-2 rounded-md border bg-background"
              >
                <option value="">Select a project...</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Table Name</Label>
              <input
                type="text"
                value={exportForm.tableName}
                onChange={(e) => setExportForm({ ...exportForm, tableName: e.target.value })}
                placeholder="users"
                className="w-full px-3 py-2 rounded-md border bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label>Format</Label>
              <select
                value={exportForm.format}
                onChange={(e) =>
                  setExportForm({ ...exportForm, format: e.target.value as 'csv' | 'json' })
                }
                className="w-full px-3 py-2 rounded-md border bg-background"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleExport}
              disabled={uploading || !exportForm.projectId || !exportForm.tableName}
            >
              {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Data</DialogTitle>
            <DialogDescription>Import data from a CSV or JSON file.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <select
                value={importForm.projectId}
                onChange={(e) => setImportForm({ ...importForm, projectId: e.target.value })}
                className="w-full px-3 py-2 rounded-md border bg-background"
              >
                <option value="">Select a project...</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Table Name</Label>
              <input
                type="text"
                value={importForm.tableName}
                onChange={(e) => setImportForm({ ...importForm, tableName: e.target.value })}
                placeholder="users"
                className="w-full px-3 py-2 rounded-md border bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label>Format</Label>
              <select
                value={importForm.format}
                onChange={(e) =>
                  setImportForm({ ...importForm, format: e.target.value as 'csv' | 'json' })
                }
                className="w-full px-3 py-2 rounded-md border bg-background"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Import Mode</Label>
              <select
                value={importForm.mode}
                onChange={(e) =>
                  setImportForm({
                    ...importForm,
                    mode: e.target.value as 'insert' | 'upsert',
                  })
                }
                className="w-full px-3 py-2 rounded-md border bg-background"
              >
                <option value="insert">Insert (add new rows)</option>
                <option value="upsert">Upsert (insert or update by primary key)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {importForm.mode === 'insert' && 'Inserts rows without checking for duplicates.'}
                {importForm.mode === 'upsert' &&
                  'Updates existing rows by primary key, inserts new ones.'}
              </p>
            </div>

            <div className="space-y-2">
              <Label>File</Label>
              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                {importForm.file ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm">{importForm.file.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setImportForm({ ...importForm, file: null })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <label className="cursor-pointer">
                    <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-1">Click to select a file</p>
                    <p className="text-xs text-muted-foreground">
                      {importForm.format.toUpperCase()} format only
                    </p>
                    <input
                      type="file"
                      accept={
                        importForm.format === 'csv' ? '.csv,text/csv' : '.json,application/json'
                      }
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setImportForm({ ...importForm, file });
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={
                uploading || !importForm.projectId || !importForm.tableName || !importForm.file
              }
            >
              {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
