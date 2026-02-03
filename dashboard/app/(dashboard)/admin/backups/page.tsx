'use client';

import { useState, useEffect } from 'react';
import {
  Archive,
  Plus,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Database,
  Table,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, type Backup, type CreateBackupInput, type Project } from '@/lib/api';
import { useDemo } from '@/lib/demo-context';

export default function BackupsPage() {
  const { isDemo } = useDemo();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [formData, setFormData] = useState<CreateBackupInput>({
    backupType: 'platform',
    format: 'sql',
    retentionDays: 7,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isDemo) {
      // Mock data for demo
      setBackups([
        {
          id: 'backup-1',
          projectId: null,
          backupType: 'platform',
          tableName: null,
          objectKey: 'platform/platform_2024-01-15.sql',
          sizeBytes: 1024 * 1024 * 5, // 5MB
          format: 'sql',
          status: 'completed',
          errorMessage: null,
          retentionDays: 7,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          createdBy: 'user-1',
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 30000).toISOString(),
        },
        {
          id: 'backup-2',
          projectId: 'proj-demo-1',
          backupType: 'project',
          tableName: null,
          objectKey: 'projects/proj-demo-1/full_2024-01-14.sql',
          sizeBytes: 1024 * 1024 * 2, // 2MB
          format: 'sql',
          status: 'completed',
          errorMessage: null,
          retentionDays: 14,
          expiresAt: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString(),
          createdBy: 'user-1',
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          completedAt: new Date(Date.now() - 48 * 60 * 60 * 1000 + 15000).toISOString(),
        },
        {
          id: 'backup-3',
          projectId: 'proj-demo-1',
          backupType: 'table',
          tableName: 'users',
          objectKey: 'projects/proj-demo-1/tables/users_2024-01-15.csv',
          sizeBytes: 1024 * 50, // 50KB
          format: 'csv',
          status: 'completed',
          errorMessage: null,
          retentionDays: 7,
          expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
          createdBy: 'user-1',
          createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
          completedAt: new Date(Date.now() - 12 * 60 * 60 * 1000 + 5000).toISOString(),
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
      const [backupsRes, projectsRes] = await Promise.all([api.listBackups(), api.listProjects()]);
      setBackups(backupsRes.data);
      setProjects(projectsRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (isDemo) {
      setError('Cannot create backups in demo mode');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await api.createBackup(formData);
      setSuccess('Backup started. It will complete in the background.');
      setCreateDialogOpen(false);
      setFormData({
        backupType: 'platform',
        format: 'sql',
        retentionDays: 7,
      });
      loadData();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup');
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload(backup: Backup) {
    if (isDemo) {
      setError('Cannot download backups in demo mode');
      return;
    }

    try {
      const result = await api.getBackupDownloadUrl(backup.id);
      window.open(result.data.downloadUrl, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get download URL');
    }
  }

  async function handleDelete(backup: Backup) {
    if (isDemo) {
      setError('Cannot delete backups in demo mode');
      return;
    }

    if (!confirm('Delete this backup? This cannot be undone.')) return;

    try {
      await api.deleteBackup(backup.id);
      setSuccess('Backup deleted');
      loadData();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete backup');
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function getStatusIcon(status: Backup['status']) {
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

  function getTypeIcon(type: Backup['backupType']) {
    switch (type) {
      case 'platform':
        return <Database className="h-4 w-4 text-purple-500" />;
      case 'project':
        return <Database className="h-4 w-4 text-blue-500" />;
      case 'table':
        return <Table className="h-4 w-4 text-emerald-500" />;
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-muted rounded-xl" />
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
          <h1 className="text-2xl font-bold tracking-tight">Backups</h1>
          <p className="text-muted-foreground">Manage database backups and exports</p>
        </div>
        <div className="flex items-center gap-2">
          {!isDemo && (
            <Button variant="ghost" size="icon" onClick={loadData}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Backup
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-emerald-500/10 text-emerald-500 rounded-lg">{success}</div>
      )}

      {backups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Archive className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No backups yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first backup to protect your data.
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Backup
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {backups.map((backup) => (
            <Card key={backup.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                      {getTypeIcon(backup.backupType)}
                    </div>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {backup.backupType === 'platform' && 'Platform Database'}
                        {backup.backupType === 'project' && (
                          <>
                            Project:{' '}
                            {projects.find((p) => p.id === backup.projectId)?.name ||
                              backup.projectId}
                          </>
                        )}
                        {backup.backupType === 'table' && <>Table: {backup.tableName}</>}
                        {getStatusIcon(backup.status)}
                      </CardTitle>
                      <CardDescription className="font-mono text-xs">
                        {new Date(backup.createdAt).toLocaleString()}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {backup.status === 'completed' && (
                      <Button variant="ghost" size="sm" onClick={() => handleDownload(backup)}>
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(backup)}
                      className="text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Format</span>
                    <p className="font-medium uppercase">{backup.format}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Size</span>
                    <p className="font-medium">{formatBytes(backup.sizeBytes)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Status</span>
                    <p className="font-medium capitalize">{backup.status}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Expires</span>
                    <p className="font-mono text-xs">
                      {backup.expiresAt ? new Date(backup.expiresAt).toLocaleDateString() : 'Never'}
                    </p>
                  </div>
                </div>
                {backup.errorMessage && (
                  <div className="mt-3 p-2 bg-red-500/10 text-red-500 rounded text-xs">
                    {backup.errorMessage}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Backup Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Backup</DialogTitle>
            <DialogDescription>
              Create a backup of your database or export specific tables.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Backup Type</Label>
              <select
                value={formData.backupType}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    backupType: e.target.value as 'platform' | 'project' | 'table',
                    projectId: undefined,
                    tableName: undefined,
                  })
                }
                className="w-full px-3 py-2 rounded-md border bg-background"
              >
                <option value="platform">Platform Database (Full)</option>
                <option value="project">Project Database</option>
                <option value="table">Single Table</option>
              </select>
            </div>

            {(formData.backupType === 'project' || formData.backupType === 'table') && (
              <div className="space-y-2">
                <Label>Project</Label>
                <select
                  value={formData.projectId || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, projectId: e.target.value || undefined })
                  }
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
            )}

            {formData.backupType === 'table' && (
              <>
                <div className="space-y-2">
                  <Label>Table Name</Label>
                  <input
                    type="text"
                    value={formData.tableName || ''}
                    onChange={(e) => setFormData({ ...formData, tableName: e.target.value })}
                    placeholder="users"
                    className="w-full px-3 py-2 rounded-md border bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Format</Label>
                  <select
                    value={formData.format}
                    onChange={(e) =>
                      setFormData({ ...formData, format: e.target.value as 'sql' | 'csv' | 'json' })
                    }
                    className="w-full px-3 py-2 rounded-md border bg-background"
                  >
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </select>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label>Retention (days)</Label>
              <input
                type="number"
                min={1}
                max={365}
                value={formData.retentionDays || 7}
                onChange={(e) =>
                  setFormData({ ...formData, retentionDays: parseInt(e.target.value) || 7 })
                }
                className="w-full px-3 py-2 rounded-md border bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Backups will be automatically deleted after this period.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                saving ||
                ((formData.backupType === 'project' || formData.backupType === 'table') &&
                  !formData.projectId) ||
                (formData.backupType === 'table' && !formData.tableName)
              }
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
