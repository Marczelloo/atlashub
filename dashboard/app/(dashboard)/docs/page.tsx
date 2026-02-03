'use client';

import { useState } from 'react';
import {
  BookOpen,
  Database,
  HardDrive,
  Key,
  Code,
  Terminal,
  ChevronRight,
  Wrench,
  Clock,
  Archive,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SyntaxHighlighter } from '@/components/ui/syntax-highlighter';

const sections = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'api', label: 'API Reference', icon: Code },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'schema', label: 'Schema (DDL)', icon: Wrench },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'cron', label: 'Cron Jobs', icon: Clock },
  { id: 'backups', label: 'Backups', icon: Archive },
  { id: 'authentication', label: 'Authentication', icon: Key },
  { id: 'examples', label: 'Examples', icon: Terminal },
];

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('overview');

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Documentation</h1>
        <p className="text-muted-foreground">
          Learn how to integrate AtlasHub with your applications
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Navigation */}
        <Card className="lg:col-span-1 h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sections</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <nav className="space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeSection === section.id
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                  }`}
                >
                  <section.icon className="h-4 w-4" />
                  {section.label}
                  {activeSection === section.id && <ChevronRight className="h-4 w-4 ml-auto" />}
                </button>
              ))}
            </nav>
          </CardContent>
        </Card>

        {/* Content */}
        <div className="lg:col-span-3 space-y-6">
          {activeSection === 'overview' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>What is AtlasHub?</CardTitle>
                  <CardDescription>
                    A self-hosted backend platform for your applications
                  </CardDescription>
                </CardHeader>
                <CardContent className="prose prose-invert max-w-none">
                  <p className="text-zinc-300">
                    AtlasHub is a lightweight, self-hosted alternative to Supabase designed for
                    personal projects and small teams. It provides:
                  </p>
                  <ul className="space-y-2 text-zinc-300 mt-4">
                    <li className="flex items-start gap-2">
                      <Database className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                      <span>
                        <strong>Database per Project:</strong> Each project gets its own isolated
                        PostgreSQL database
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <HardDrive className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                      <span>
                        <strong>File Storage:</strong> S3-compatible storage using MinIO with signed
                        URLs
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Key className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                      <span>
                        <strong>API Keys:</strong> Publishable and secret keys for secure API access
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Code className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                      <span>
                        <strong>REST API:</strong> Simple REST endpoints for CRUD operations
                      </span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Quick Start</CardTitle>
                  <CardDescription>Get started in minutes</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">1. Set up environment variables</h4>
                    <SyntaxHighlighter
                      code={`# .env.local
ATLASHUB_API_URL=https://api.your-domain.com
ATLASHUB_PUBLISHABLE_KEY=pk_your_publishable_key
ATLASHUB_SECRET_KEY=sk_your_secret_key`}
                    />
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">2. Make your first request</h4>
                    <SyntaxHighlighter
                      code={`// Fetch data from your project
const response = await fetch(\`\${process.env.ATLASHUB_API_URL}/v1/db/your_table\`, {
  headers: {
    'x-api-key': process.env.ATLASHUB_SECRET_KEY!,
  },
});
const data = await response.json();`}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === 'api' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>API Reference</CardTitle>
                  <CardDescription>All API requests require the x-api-key header</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-lg mb-2">Base URL</h4>
                    <SyntaxHighlighter code="https://api.your-domain.com/v1" />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2">Authentication</h4>
                    <p className="text-zinc-400 text-sm mb-2">
                      Include your API key in the request headers:
                    </p>
                    <SyntaxHighlighter
                      code={`headers: {
  'x-api-key': 'sk_your_secret_key'
}`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2">Key Types</h4>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900">
                        <h5 className="font-medium text-emerald-400">Publishable Key (pk_)</h5>
                        <p className="text-sm text-zinc-400 mt-1">
                          Safe to use in client-side code. Limited to read operations.
                        </p>
                      </div>
                      <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900">
                        <h5 className="font-medium text-amber-400">Secret Key (sk_)</h5>
                        <p className="text-sm text-zinc-400 mt-1">
                          Server-side only. Full read/write access.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Response Format</CardTitle>
                </CardHeader>
                <CardContent>
                  <SyntaxHighlighter
                    code={`// Success response
{
  "data": [...],
  "meta": {
    "total": 100,
    "limit": 50,
    "offset": 0
  }
}

// Error response
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}`}
                  />
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === 'database' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Database API</CardTitle>
                  <CardDescription>CRUD operations for your project database</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-emerald-400">
                      GET /v1/db/tables
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">List all tables in your database</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/db/tables', {
  headers: { 'x-api-key': apiKey }
});
// Response: { "data": [{ "name": "users", "type": "table" }] }`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-emerald-400">
                      GET /v1/db/:table
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">Select rows from a table</p>
                    <SyntaxHighlighter
                      code={`// With filters, pagination, and ordering
const res = await fetch('/v1/db/users?select=id,name,email&limit=10&offset=0&order=created_at.desc&eq.status=active', {
  headers: { 'x-api-key': apiKey }
});

// Available operators:
// eq.<col>=value     - Equal
// neq.<col>=value    - Not equal
// lt.<col>=value     - Less than
// lte.<col>=value    - Less than or equal
// gt.<col>=value     - Greater than
// gte.<col>=value    - Greater than or equal
// like.<col>=value   - LIKE pattern match
// ilike.<col>=value  - Case-insensitive LIKE
// in.<col>=a,b,c     - IN list`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-blue-400">POST /v1/db/:table</h4>
                    <p className="text-zinc-400 text-sm mb-2">Insert rows into a table</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/db/users', {
  method: 'POST',
  headers: {
    'x-api-key': secretKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    rows: [
      { name: 'John', email: 'john@example.com' },
      { name: 'Jane', email: 'jane@example.com' }
    ]
  })
});`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-amber-400">
                      PATCH /v1/db/:table
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">
                      Update rows (requires at least one filter)
                    </p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/db/users?eq.id=123', {
  method: 'PATCH',
  headers: {
    'x-api-key': secretKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    values: { status: 'inactive' }
  })
});`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-red-400">
                      DELETE /v1/db/:table
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">
                      Delete rows (requires at least one filter)
                    </p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/db/users?eq.id=123', {
  method: 'DELETE',
  headers: { 'x-api-key': secretKey }
});`}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === 'storage' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Storage API</CardTitle>
                  <CardDescription>File upload and download using signed URLs</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-emerald-400">
                      POST /v1/storage/signed-upload
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">Get a signed URL for uploading</p>
                    <SyntaxHighlighter
                      code={`// Step 1: Get signed upload URL
const res = await fetch('/v1/storage/signed-upload', {
  method: 'POST',
  headers: {
    'x-api-key': apiKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    bucket: 'uploads',
    path: 'images/photo.jpg',
    contentType: 'image/jpeg',
    maxSize: 5242880 // 5MB
  })
});
const { uploadUrl, objectKey } = await res.json();

// Step 2: Upload directly to storage
await fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': file.type }
});`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-emerald-400">
                      GET /v1/storage/signed-download
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">Get a signed URL for downloading</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/storage/signed-download?bucket=uploads&objectKey=images/photo.jpg', {
  headers: { 'x-api-key': apiKey }
});
const { downloadUrl, expiresIn } = await res.json();

// Use downloadUrl to fetch the file`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-emerald-400">
                      GET /v1/storage/list
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">List files in a bucket</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/storage/list?bucket=uploads&prefix=images/', {
  headers: { 'x-api-key': secretKey }
});
const { objects } = await res.json();`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-red-400">
                      DELETE /v1/storage/object
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">Delete a file</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/storage/object?bucket=uploads&objectKey=images/photo.jpg', {
  method: 'DELETE',
  headers: { 'x-api-key': secretKey }
});`}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === 'schema' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Schema Management (DDL)</CardTitle>
                  <CardDescription>
                    Create and modify tables programmatically (requires secret key)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
                    <h4 className="font-medium text-amber-400 mb-2">Secret Key Required</h4>
                    <p className="text-sm text-zinc-300">
                      All schema operations require your secret key for security. Never expose DDL

                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-blue-400">
                      POST /v1/db/schema/tables
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">Create a new table</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/db/schema/tables', {
  method: 'POST',
  headers: {
    'x-api-key': secretKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'posts',
    columns: [
      { name: 'id', type: 'uuid', primaryKey: true, default: 'gen_random_uuid()' },
      { name: 'title', type: 'text', nullable: false },
      { name: 'content', type: 'text' },
      { name: 'author_id', type: 'uuid', nullable: false },
      { name: 'created_at', type: 'timestamptz', default: 'now()' }
    ]
  })
});`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-red-400">
                      DELETE /v1/db/schema/tables/:table
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">Drop a table (irreversible!)</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/db/schema/tables/old_posts', {
  method: 'DELETE',
  headers: { 'x-api-key': secretKey }
});`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-amber-400">
                      PATCH /v1/db/schema/tables/:table/rename
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">Rename a table</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/db/schema/tables/posts/rename', {
  method: 'PATCH',
  headers: {
    'x-api-key': secretKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ newName: 'articles' })
});`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-blue-400">
                      POST /v1/db/schema/tables/:table/columns
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">Add a column to existing table</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/db/schema/tables/posts/columns', {
  method: 'POST',
  headers: {
    'x-api-key': secretKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'published',
    type: 'boolean',
    default: 'false'
  })
});`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-red-400">
                      DELETE /v1/db/schema/tables/:table/columns/:column
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">Drop a column</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/db/schema/tables/posts/columns/old_field', {
  method: 'DELETE',
  headers: { 'x-api-key': secretKey }
});`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-amber-400">
                      PATCH /v1/db/schema/tables/:table/columns/rename
                    </h4>
                    <p className="text-zinc-400 text-sm mb-2">Rename a column</p>
                    <SyntaxHighlighter
                      code={`const res = await fetch('/v1/db/schema/tables/posts/columns/rename', {
  method: 'PATCH',
  headers: {
    'x-api-key': secretKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    oldName: 'title',
    newName: 'headline'
  })
});`}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === 'cron' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Cron Jobs</CardTitle>
<<<<<<< HEAD
                  <CardDescription>Schedule recurring tasks and HTTP webhooks</CardDescription>
=======
                  <CardDescription>
                    Schedule recurring tasks and HTTP webhooks
                  </CardDescription>
>>>>>>> 9dfe009ac3cb9e92329e076eb72381879f14fcbd
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-lg mb-2">About Cron Jobs</h4>
                    <p className="text-zinc-400 text-sm mb-4">
<<<<<<< HEAD
                      AtlasHub includes a built-in scheduler for running HTTP webhooks on a
                      schedule. Cron jobs are managed through the dashboard or admin API.
=======
                      AtlasHub includes a built-in scheduler for running HTTP webhooks on a schedule.
                      Cron jobs are managed through the dashboard or admin API.
>>>>>>> 9dfe009ac3cb9e92329e076eb72381879f14fcbd
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2 text-emerald-400">
                      Common Cron Expressions
                    </h4>
                    <SyntaxHighlighter
                      code={`// Every minute
* * * * *

// Every hour at minute 0
0 * * * *

// Every day at midnight
0 0 * * *

// Every Monday at 9am
0 9 * * 1

// Every 5 minutes
*/5 * * * *

// First day of month at midnight
0 0 1 * *`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2">Use Cases</h4>
                    <ul className="text-sm text-zinc-400 space-y-2 list-disc list-inside">
                      <li>Trigger database cleanup jobs</li>
                      <li>Send scheduled email digests via webhook</li>
                      <li>Sync data with external services</li>
                      <li>Generate scheduled reports</li>
                      <li>Ping health check endpoints</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2">Admin API Endpoints</h4>
                    <SyntaxHighlighter
                      code={`// List cron jobs
GET /admin/cron

// Create cron job
POST /admin/cron
{
  "name": "Daily Cleanup",
  "projectId": "uuid",
  "type": "http",
  "scheduleCron": "0 0 * * *",
  "timezone": "UTC",
  "httpUrl": "https://api.example.com/cleanup",
  "httpMethod": "POST"
}

// Toggle job on/off
POST /admin/cron/:id/toggle

// Trigger job manually
POST /admin/cron/:id/run

// View run history
GET /admin/cron/:id/runs`}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === 'backups' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Backups</CardTitle>
<<<<<<< HEAD
                  <CardDescription>Database backup and restore functionality</CardDescription>
=======
                  <CardDescription>
                    Database backup and restore functionality
                  </CardDescription>
>>>>>>> 9dfe009ac3cb9e92329e076eb72381879f14fcbd
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-lg mb-2">About Backups</h4>
                    <p className="text-zinc-400 text-sm mb-4">
                      AtlasHub supports automated and manual backups of your project databases.
                      Backups are stored in MinIO and can be downloaded or restored.
                    </p>
                  </div>

                  <div>
<<<<<<< HEAD
                    <h4 className="font-semibold text-lg mb-2 text-emerald-400">Backup Types</h4>
                    <ul className="text-sm text-zinc-400 space-y-2 list-disc list-inside">
                      <li>
                        <strong>Platform backup:</strong> Backs up the main AtlasHub database
                      </li>
                      <li>
                        <strong>Project backup:</strong> Backs up a specific project database
                      </li>
=======
                    <h4 className="font-semibold text-lg mb-2 text-emerald-400">
                      Backup Types
                    </h4>
                    <ul className="text-sm text-zinc-400 space-y-2 list-disc list-inside">
                      <li><strong>Platform backup:</strong> Backs up the main AtlasHub database</li>
                      <li><strong>Project backup:</strong> Backs up a specific project database</li>
>>>>>>> 9dfe009ac3cb9e92329e076eb72381879f14fcbd
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2">Admin API Endpoints</h4>
                    <SyntaxHighlighter
                      code={`// List backups
GET /admin/backups

// Create backup
POST /admin/backups
{
  "type": "project",
  "projectId": "uuid",
  "retentionDays": 7
}

// Get backup details
GET /admin/backups/:id

// Download backup (returns signed URL)
GET /admin/backups/:id/download

// Delete backup
DELETE /admin/backups/:id

// Cleanup expired backups
POST /admin/backups/cleanup`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2">Per-Project Data Tools</h4>
                    <p className="text-zinc-400 text-sm mb-2">
                      Export and import tables in CSV or JSON format
                    </p>
                    <SyntaxHighlighter
                      code={`// Export table
POST /admin/projects/:id/data-tools/export
{
  "table": "users",
  "format": "json"  // or "csv"
}

// Get upload URL for import
POST /admin/projects/:id/data-tools/upload-url
{
  "filename": "users.json"
}

// Import table
POST /admin/projects/:id/data-tools/import
{
  "table": "users",
  "format": "json",
  "objectKey": "imports/users.json",
  "mode": "insert"  // or "upsert"
}`}
                    />
                  </div>

                  <div className="p-4 rounded-lg border border-blue-500/30 bg-blue-500/10">
                    <h4 className="font-medium text-blue-400 mb-2">Dashboard Access</h4>
                    <p className="text-sm text-zinc-300">
<<<<<<< HEAD
                      All backup and data tools features are available in the dashboard under each
                      project&apos;s Data Tools section.
=======
                      All backup and data tools features are available in the dashboard under each project&apos;s Data Tools section.
>>>>>>> 9dfe009ac3cb9e92329e076eb72381879f14fcbd
                    </p>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === 'authentication' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>API Key Security</CardTitle>
                  <CardDescription>Best practices for using API keys</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
                    <h4 className="font-medium text-amber-400 mb-2">Important Security Notes</h4>
                    <ul className="text-sm text-zinc-300 space-y-1 list-disc list-inside">
                      <li>Never expose your secret key in client-side code</li>
                      <li>Use environment variables for all keys</li>
                      <li>Rotate keys regularly, especially if compromised</li>
                      <li>Use publishable keys only for read operations</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">Server-Side Usage (Recommended)</h4>
                    <SyntaxHighlighter
                      code={`// Next.js Server Action
'use server';

export async function getUsers() {
  const res = await fetch(\`\${process.env.ATLASHUB_API_URL}/v1/db/users\`, {
    headers: {
      'x-api-key': process.env.ATLASHUB_SECRET_KEY!
    }
  });
  return res.json();
}`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">API Route Handler</h4>
                    <SyntaxHighlighter
                      code={`// app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { filename, contentType } = await req.json();
  
  const res = await fetch(\`\${process.env.ATLASHUB_API_URL}/v1/storage/signed-upload\`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ATLASHUB_SECRET_KEY!,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bucket: 'uploads',
      path: filename,
      contentType
    })
  });
  
  return NextResponse.json(await res.json());
}`}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === 'examples' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Complete Examples</CardTitle>
                  <CardDescription>Copy-paste ready code for common use cases</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-lg mb-2">File Upload with React</h4>
                    <SyntaxHighlighter
                      code={`// components/FileUpload.tsx
'use client';

import { useState } from 'react';

export function FileUpload() {
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // 1. Get signed URL from your API route
      const signedRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type
        })
      });
      const { uploadUrl, objectKey } = await signedRes.json();

      // 2. Upload directly to storage
      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type }
      });

      console.log('Uploaded:', objectKey);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }

  return (
    <input
      type="file"
      onChange={handleUpload}
      disabled={uploading}
    />
  );
}`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2">
                      Data Fetching with Server Components
                    </h4>
                    <SyntaxHighlighter
                      code={`// app/users/page.tsx
async function getUsers() {
  const res = await fetch(\`\${process.env.ATLASHUB_API_URL}/v1/db/users?select=id,name,email&limit=50\`, {
    headers: {
      'x-api-key': process.env.ATLASHUB_SECRET_KEY!
    },
    next: { revalidate: 60 } // Cache for 60 seconds
  });
  
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

export default async function UsersPage() {
  const { data } = await getUsers();
  
  return (
    <ul>
      {data.map((user) => (
        <li key={user.id}>{user.name} - {user.email}</li>
      ))}
    </ul>
  );
}`}
                    />
                  </div>

                  <div>
                    <h4 className="font-semibold text-lg mb-2">Insert Data with Server Action</h4>
                    <SyntaxHighlighter
                      code={`// actions/createUser.ts
'use server';

import { revalidatePath } from 'next/cache';

export async function createUser(formData: FormData) {
  const name = formData.get('name') as string;
  const email = formData.get('email') as string;

  const res = await fetch(\`\${process.env.ATLASHUB_API_URL}/v1/db/users\`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ATLASHUB_SECRET_KEY!,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      rows: [{ name, email }]
    })
  });

  if (!res.ok) {
    throw new Error('Failed to create user');
  }

  revalidatePath('/users');
}`}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
