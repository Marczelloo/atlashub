import { startScheduler, stopScheduler } from './scheduler.js';

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await stopScheduler();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await stopScheduler();
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Start the scheduler
startScheduler().catch((err) => {
  console.error('Failed to start scheduler:', err);
  process.exit(1);
});
