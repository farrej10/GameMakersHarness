// tsx asks Node for the current Unix user ID while choosing a temporary
// directory. On some Windows hosts os.userInfo() intermittently returns
// ERR_SYSTEM_ERROR/ENOMEM. Supplying the existing Windows username avoids
// that platform call while preserving tsx's per-user temporary directory.
if (process.platform === 'win32' && typeof process.geteuid !== 'function') {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => process.env.USERNAME || 'windows-user',
  });
}
