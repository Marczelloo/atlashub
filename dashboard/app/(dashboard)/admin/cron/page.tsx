'use client';

import { useState, useEffect } from 'react';
import {
  Clock,
  Plus,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, type CronJob, type CronJobRun, type CreateCronJobInput } from '@/lib/api';
import { useDemo } from '@/lib/demo-context';

export default function CronJobsPage() {
  const { isDemo } = useDemo();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [runsDialogOpen, setRunsDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null);
  const [runs, setRuns] = useState<CronJobRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // Form state
  const [formData, setFormData] = useState<CreateCronJobInput>({
    name: '',
    jobType: 'http',
    scheduleCron: '*/5 * * * *',
    httpUrl: '',
    httpMethod: 'GET',
    enabled: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isDemo) {
      // Mock data for demo
      setJobs([
        {
          id: 'demo-1',
          projectId: null,
          name: 'Daily Backup',
          description: 'Automated daily platform backup',
          jobType: 'platform',
          scheduleCron: '0 2 * * *',
          timezone: 'UTC',
          httpUrl: null,
          httpMethod: null,
          httpHeaders: null,
          httpBody: null,
          platformAction: 'backup.platform',
          platformConfig: {},
          enabled: true,
          timeoutMs: 30000,
          retries: 2,
          retryBackoffMs: 5000,
          lastRunAt: new Date(Date.now() - 86400000).toISOString(),
          nextRunAt: new Date(Date.now() + 43200000).toISOString(),
          createdAt: new Date(Date.now() - 604800000).toISOString(),
          updatedAt: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: 'demo-2',
          projectId: 'proj-demo-1',
          name: 'Health Check',
          description: 'Check API health every 5 minutes',
          jobType: 'http',
          scheduleCron: '*/5 * * * *',
          timezone: 'UTC',
          httpUrl: 'https://api.example.com/health',
          httpMethod: 'GET',
          httpHeaders: null,
          httpBody: null,
          platformAction: null,
          platformConfig: null,
          enabled: true,
          timeoutMs: 10000,
          retries: 1,
          retryBackoffMs: 1000,
          lastRunAt: new Date(Date.now() - 180000).toISOString(),
          nextRunAt: new Date(Date.now() + 120000).toISOString(),
          createdAt: new Date(Date.now() - 1209600000).toISOString(),
          updatedAt: new Date(Date.now() - 180000).toISOString(),
        },
      ]);
      setLoading(false);
      return;
    }

    loadJobs();
  }, [isDemo]);

  async function loadJobs() {
    try {
      setLoading(true);
      const result = await api.listCronJobs();
      setJobs(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cron jobs');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (isDemo) {
      setError('Cannot create jobs in demo mode');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await api.createCronJob(formData);
      setSuccess('Cron job created successfully');
      setCreateDialogOpen(false);
      setFormData({
        name: '',
        jobType: 'http',
        scheduleCron: '*/5 * * * *',
        httpUrl: '',
        httpMethod: 'GET',
        enabled: true,
      });
      loadJobs();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cron job');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(job: CronJob) {
    if (isDemo) {
      setError('Cannot toggle jobs in demo mode');
      return;
    }

    try {
      await api.toggleCronJob(job.id, !job.enabled);
      loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle job');
    }
  }

  async function handleRun(job: CronJob) {
    if (isDemo) {
      setError('Cannot run jobs in demo mode');
      return;
    }

    try {
      await api.runCronJob(job.id);
      setSuccess(`Job "${job.name}" triggered`);
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger job');
    }
  }

  async function handleDelete(job: CronJob) {
    if (isDemo) {
      setError('Cannot delete jobs in demo mode');
      return;
    }

    if (!confirm(`Delete cron job "${job.name}"?`)) return;

    try {
      await api.deleteCronJob(job.id);
      setSuccess('Cron job deleted');
      loadJobs();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete job');
    }
  }

  async function handleViewRuns(job: CronJob) {
    setSelectedJob(job);
    setRunsDialogOpen(true);
    setRunsLoading(true);

    if (isDemo) {
      // Mock runs for demo
      setRuns([
        {
          id: 'run-1',
          jobId: job.id,
          startedAt: new Date(Date.now() - 180000).toISOString(),
          finishedAt: new Date(Date.now() - 178000).toISOString(),
          durationMs: 2000,
          status: 'success',
          httpStatus: 200,
          errorText: null,
          logObjectKey: null,
          logPreview: 'Health check passed',
          attemptNumber: 1,
          createdAt: new Date(Date.now() - 180000).toISOString(),
        },
        {
          id: 'run-2',
          jobId: job.id,
          startedAt: new Date(Date.now() - 480000).toISOString(),
          finishedAt: new Date(Date.now() - 479500).toISOString(),
          durationMs: 500,
          status: 'success',
          httpStatus: 200,
          errorText: null,
          logObjectKey: null,
          logPreview: 'Health check passed',
          attemptNumber: 1,
          createdAt: new Date(Date.now() - 480000).toISOString(),
        },
      ]);
      setRunsLoading(false);
      return;
    }

    try {
      const result = await api.getCronJobRuns(job.id, 20);
      setRuns(result.data);
    } catch (err) {
      console.error('Failed to load runs:', err);
    } finally {
      setRunsLoading(false);
    }
  }

  function getStatusIcon(status: CronJobRun['status']) {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-emerald-500" />;
      case 'fail':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'timeout':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <AlertCircle className="h-4 w-4 text-zinc-500" />;
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
          <h1 className="text-2xl font-bold tracking-tight">Cron Jobs</h1>
          <p className="text-muted-foreground">Schedule and manage automated tasks</p>
        </div>
        <div className="flex items-center gap-2">
          {!isDemo && (
            <Button variant="ghost" size="icon" onClick={loadJobs}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Job
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-emerald-500/10 text-emerald-500 rounded-lg">{success}</div>
      )}

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No cron jobs yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first scheduled job to automate tasks like backups and health checks.
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Job
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <Card key={job.id} className={!job.enabled ? 'opacity-60' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                        job.jobType === 'http' ? 'bg-blue-500/10' : 'bg-purple-500/10'
                      }`}
                    >
                      <Clock
                        className={`h-4 w-4 ${
                          job.jobType === 'http' ? 'text-blue-500' : 'text-purple-500'
                        }`}
                      />
                    </div>
                    <div>
                      <CardTitle className="text-base">{job.name}</CardTitle>
                      <CardDescription className="font-mono text-xs">
                        {job.scheduleCron}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewRuns(job)}
                      className="text-xs"
                    >
                      View Runs
                      <ChevronRight className="h-3 w-3 ml-1" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleRun(job)}>
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleToggle(job)}>
                      {job.enabled ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4 text-emerald-500" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(job)}
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
                    <span className="text-muted-foreground text-xs">Type</span>
                    <p className="font-medium capitalize">{job.jobType}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Status</span>
                    <p className={job.enabled ? 'text-emerald-500' : 'text-zinc-500'}>
                      {job.enabled ? 'Active' : 'Paused'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Last Run</span>
                    <p className="font-mono text-xs">
                      {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : 'Never'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Next Run</span>
                    <p className="font-mono text-xs">
                      {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : '-'}
                    </p>
                  </div>
                </div>
                {job.httpUrl && (
                  <div className="mt-3 p-2 bg-muted/50 rounded text-xs font-mono truncate">
                    {job.httpMethod} {job.httpUrl}
                  </div>
                )}
                {job.platformAction && (
                  <div className="mt-3 p-2 bg-muted/50 rounded text-xs">
                    Platform Action: <span className="font-mono">{job.platformAction}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Job Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Cron Job</DialogTitle>
            <DialogDescription>
              Schedule an HTTP request or platform action to run automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Daily Backup"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scheduleCron">Cron Expression</Label>
              <Input
                id="scheduleCron"
                value={formData.scheduleCron}
                onChange={(e) => setFormData({ ...formData, scheduleCron: e.target.value })}
                placeholder="*/5 * * * *"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Format: minute hour day month weekday (e.g., */5 * * * * = every 5 minutes)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="jobType">Job Type</Label>
              <select
                id="jobType"
                value={formData.jobType}
                onChange={(e) =>
                  setFormData({ ...formData, jobType: e.target.value as 'http' | 'platform' })
                }
                className="w-full px-3 py-2 rounded-md border bg-background"
              >
                <option value="http">HTTP Request</option>
                <option value="platform">Platform Action</option>
              </select>
            </div>
            {formData.jobType === 'http' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="httpUrl">URL</Label>
                  <Input
                    id="httpUrl"
                    value={formData.httpUrl || ''}
                    onChange={(e) => setFormData({ ...formData, httpUrl: e.target.value })}
                    placeholder="https://api.example.com/webhook"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="httpMethod">Method</Label>
                  <select
                    id="httpMethod"
                    value={formData.httpMethod || 'GET'}
                    onChange={(e) => setFormData({ ...formData, httpMethod: e.target.value })}
                    className="w-full px-3 py-2 rounded-md border bg-background"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                </div>
              </>
            )}
            {formData.jobType === 'platform' && (
              <div className="space-y-2">
                <Label htmlFor="platformAction">Platform Action</Label>
                <select
                  id="platformAction"
                  value={formData.platformAction || ''}
                  onChange={(e) => setFormData({ ...formData, platformAction: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border bg-background"
                >
                  <option value="">Select an action...</option>
                  <option value="backup.platform">Backup Platform DB</option>
                  <option value="backup.project">Backup Project DB</option>
                  <option value="cleanup.audit_logs">Cleanup Audit Logs</option>
                  <option value="cleanup.old_runs">Cleanup Old Job Runs</option>
                  <option value="cleanup.expired_backups">Cleanup Expired Backups</option>
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving || !formData.name}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Runs History Dialog */}
      <Dialog open={runsDialogOpen} onOpenChange={setRunsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Run History: {selectedJob?.name}</DialogTitle>
            <DialogDescription>Recent executions of this cron job</DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[400px] overflow-auto">
            {runsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : runs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No runs yet</p>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border"
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(run.status)}
                      <div>
                        <p className="font-mono text-sm">
                          {new Date(run.startedAt).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Duration: {run.durationMs ? `${run.durationMs}ms` : 'Running...'}
                          {run.httpStatus && ` • HTTP ${run.httpStatus}`}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        run.status === 'success'
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : run.status === 'fail'
                            ? 'bg-red-500/10 text-red-500'
                            : 'bg-zinc-500/10 text-zinc-500'
                      }`}
                    >
                      {run.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
