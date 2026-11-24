// Runs in every test file: after the file's tests, the temporary upload folder tests/setup/env.js
// chose for it is removed, so no test run leaves images behind (Phase 4B contract §1).
//
// ⚠️ It removes only a folder inside the system temp directory's fixora-test-uploads/, so a
// mistaken UPLOAD_PATH can never delete the repository's (or anyone's) real uploads.
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_UPLOADS = path.join(os.tmpdir(), 'fixora-test-uploads') + path.sep;

afterAll(() => {
  const folder = path.resolve(process.env.UPLOAD_PATH || '');
  if (folder.startsWith(TEST_UPLOADS)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
