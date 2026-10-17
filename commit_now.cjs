const cp = require('child_process');
function run(cmd, args) {
  const r = cp.spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status);
}
run('git', ['add', '-A']);
try {
  run('git', ['commit', '-m', 'Reconstruct: remove experimental dot-date workaround; integrate server-side S-Curve logic as authoritative; prepare editable source for Candidate C replacement']);
  console.log('Committed');
} catch (e) {
  console.log('no changes to commit');
}
