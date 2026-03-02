# @atlashub/sdk

Official TypeScript SDK for AtlasHub - A Supabase-like backend-as-a-service platform.

## Installation

```bash
npm install @atlashub/sdk
# or
yarn add @atlashub/sdk
# or
pnpm add @atlashub/sdk
```

## Quick Start

```typescript
import { createClient } from '@atlashub/sdk'

const client = createClient({
  url: 'https://api.yoursite.com',  // Your AtlasHub gateway URL
  apiKey: 'pk_your_publishable_key' // Your publishable or secret key
})
```

## Features

- **Database Client**: Chainable query builder with TypeScript support
- **Storage Client**: File upload/download with presigned URLs
- **Auth Client**: Email/password authentication with session management

## Database Operations

### Select Queries

```typescript
// Select all columns
const { data, error } = await client
  .from('users')
  .select('*')

// Select specific columns
const { data, error } = await client
  .from('users')
  .select('id, name, email')

// Select with filters
const { data, error } = await client
  .from('users')
  .select('*')
  .eq('status', 'active')
  .order('created_at', { ascending: false })
  .limit(10)

// Get a single row
const { data, error } = await client
  .from('users')
  .select('*')
  .eq('id', 1)
  .single()
```

### Filter Operators

```typescript
// Equality
.eq('status', 'active')
.neq('status', 'deleted')

// Comparison
.gt('age', 18)
.gte('age', 18)
.lt('age', 65)
.lte('age', 65)

// Pattern matching
.like('email', '%@gmail.com')      // Case-sensitive
.ilike('name', '%john%')           // Case-insensitive

// Array membership
.in('status', ['active', 'pending'])

// Null checks
.is('deleted_at', null)
.not('deleted_at', null)
```

### Insert Operations

```typescript
// Insert a single row
const { data, error } = await client
  .from('users')
  .insert({
    name: 'John Doe',
    email: 'john@example.com'
  })

// Insert multiple rows
const { data, error } = await client
  .from('users')
  .insert([
    { name: 'John', email: 'john@example.com' },
    { name: 'Jane', email: 'jane@example.com' }
  ])
```

### Update Operations

```typescript
// Update rows matching a filter
const { data, error } = await client
  .from('users')
  .update({ status: 'inactive' })
  .eq('id', 1)

// Update with multiple filters
const { data, error } = await client
  .from('users')
  .update({ status: 'verified' })
  .eq('email_verified', true)
  .is('deleted_at', null)
```

### Delete Operations

```typescript
// Delete rows matching a filter
const { data, error } = await client
  .from('users')
  .delete()
  .eq('id', 1)
```

### Pagination

```typescript
// Using limit and offset
const { data, error } = await client
  .from('users')
  .select('*')
  .limit(10)
  .offset(20)

// Using range (inclusive)
const { data, error } = await client
  .from('users')
  .select('*')
  .range(0, 9)  // First 10 results
```

### Raw SQL Queries

```typescript
// Execute raw SQL (requires secret key)
const { data, error } = await client.raw(
  'SELECT * FROM users WHERE created_at > $1',
  ['2024-01-01']
)
```

## Storage Operations

### Upload Files

```typescript
// Method 1: Direct upload
const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
const { data, error } = await client.storage.upload({
  bucket: 'uploads',
  path: 'files/test.txt',
  file: file
})

// Method 2: Using bucket reference
const bucket = client.storage.from('images')
const { data, error } = await bucket.upload('avatars/user123.png', file, 'image/png')

// Method 3: Get presigned URL and upload manually
const { data, error } = await client.storage.getUploadUrl({
  bucket: 'images',
  path: 'avatars/user123.png',
  contentType: 'image/png'
})

if (data) {
  // Upload directly to storage provider
  await fetch(data.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': 'image/png' }
  })
}
```

### Download Files

```typescript
// Method 1: Direct download
const { data: blob, error } = await client.storage.download({
  bucket: 'images',
  objectKey: 'avatars/user123.png'
})

if (blob) {
  const url = URL.createObjectURL(blob)
  // Use the blob URL
}

// Method 2: Get presigned URL
const { data, error } = await client.storage.getDownloadUrl({
  bucket: 'images',
  objectKey: 'avatars/user123.png'
})

if (data) {
  // Share or use the download URL
  console.log(data.downloadUrl)
}

// Method 3: Using bucket reference
const bucket = client.storage.from('images')
const { data: blob } = await bucket.download('avatars/user123.png')
```

### List Objects

```typescript
const { data, error } = await client.storage.list({
  bucket: 'images',
  prefix: 'avatars/',
  limit: 100
})

// Or using bucket reference
const bucket = client.storage.from('images')
const { data } = await bucket.list({ prefix: 'avatars/' })
```

### Delete Objects

```typescript
const { error } = await client.storage.delete({
  bucket: 'images',
  objectKey: 'avatars/user123.png'
})

// Or using bucket reference
const bucket = client.storage.from('images')
const { error } = await bucket.delete('avatars/user123.png')
```

## Authentication

### Sign Up

```typescript
const { data, error } = await client.auth.signUp({
  email: 'user@example.com',
  password: 'secure-password',
  inviteKey: 'inv_xxx' // If registration requires invite
})
```

### Sign In

```typescript
const { data, error } = await client.auth.signIn({
  email: 'user@example.com',
  password: 'secure-password'
})

if (data) {
  console.log('Logged in as:', data.user.email)
  console.log('Access token:', data.accessToken)
}
```

### Sign Out

```typescript
const { error } = await client.auth.signOut()
```

### Get Current User

```typescript
const { data: user, error } = await client.auth.getUser()

if (user) {
  console.log('User:', user.email, user.role)
}
```

### Auth State Changes

```typescript
// Subscribe to auth state changes
const { unsubscribe } = client.auth.onAuthStateChange((event, session) => {
  console.log('Auth event:', event)

  if (event === 'SIGNED_IN') {
    console.log('User signed in:', session?.user.email)
  }

  if (event === 'SIGNED_OUT') {
    console.log('User signed out')
  }
})

// Later, unsubscribe
unsubscribe()
```

### Check Authentication Status

```typescript
// Check if user is authenticated
if (client.auth.isAuthenticated()) {
  // User is logged in
}

// Get access token
const token = client.auth.getAccessToken()
```

## Error Handling

```typescript
import { AtlasHubError } from '@atlashub/sdk'

try {
  const { data, error } = await client.from('users').select('*')

  if (error) {
    console.error('Query error:', error)
  }
} catch (err) {
  if (err instanceof AtlasHubError) {
    console.error('API Error:', err.message)
    console.error('Status Code:', err.statusCode)
    console.error('Details:', err.details)
  }
}
```

## Configuration Options

```typescript
const client = createClient({
  // Required: Your AtlasHub gateway URL
  url: 'https://api.yoursite.com',

  // Required: Your API key (publishable or secret)
  apiKey: 'pk_your_publishable_key',

  // Optional: Custom headers
  headers: {
    'X-Custom-Header': 'value'
  },

  // Optional: Request timeout in milliseconds (default: 30000)
  timeout: 60000,

  // Optional: Custom fetch function (useful for testing)
  fetch: customFetch
})
```

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions.

```typescript
// Define your database row types
interface User {
  id: number
  name: string
  email: string
  created_at: string
}

// Use with the client
const { data } = await client
  .from<User>('users')
  .select('*')

// data is typed as User[]
```

## API Reference

### Client Methods

| Method | Description |
|--------|-------------|
| `from(table)` | Create a query builder for a table |
| `getTables()` | Get list of available tables |
| `raw(sql, params?)` | Execute raw SQL (requires secret key) |

### Query Builder Methods

| Method | Description |
|--------|-------------|
| `select(columns)` | Specify columns to select |
| `eq(column, value)` | Filter by equality |
| `neq(column, value)` | Filter by inequality |
| `gt(column, value)` | Filter by greater than |
| `gte(column, value)` | Filter by greater than or equal |
| `lt(column, value)` | Filter by less than |
| `lte(column, value)` | Filter by less than or equal |
| `like(column, pattern)` | Filter by LIKE pattern |
| `ilike(column, pattern)` | Filter by ILIKE pattern (case-insensitive) |
| `in(column, values)` | Filter by array membership |
| `order(column, options?)` | Order results |
| `limit(count)` | Limit number of results |
| `offset(count)` | Skip number of results |
| `range(from, to)` | Select a range of results |
| `single()` | Return a single row |
| `maybeSingle()` | Return a single row or throw |
| `insert(rows)` | Insert rows |
| `update(values)` | Update rows |
| `delete()` | Delete rows |

### Storage Methods

| Method | Description |
|--------|-------------|
| `from(bucket)` | Get bucket reference |
| `upload(options)` | Upload a file |
| `download(options)` | Download a file |
| `getUploadUrl(options)` | Get presigned upload URL |
| `getDownloadUrl(options)` | Get presigned download URL |
| `list(options)` | List objects in bucket |
| `delete(options)` | Delete an object |

### Auth Methods

| Method | Description |
|--------|-------------|
| `signUp(credentials)` | Register a new user |
| `signIn(credentials)` | Sign in a user |
| `signOut()` | Sign out current user |
| `getUser()` | Get current user |
| `getSession()` | Get current session |
| `isAuthenticated()` | Check if user is logged in |
| `getAccessToken()` | Get access token |
| `onAuthStateChange(callback)` | Subscribe to auth changes |

## License

MIT
