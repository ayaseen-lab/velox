const fs = require('fs');
const path = require('path');

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const projectRoot = path.join(__dirname, '..');
const writableRoot = isServerless ? path.join('/tmp', 'velox') : projectRoot;

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create directory ${dir}:`, err.message);
  }
  return dir;
}

const dataDir = ensureDir(path.join(writableRoot, 'data'));
const uploadsDir = ensureDir(path.join(writableRoot, 'uploads'));
const attachmentsDir = ensureDir(path.join(writableRoot, 'attachments'));

module.exports = {
  isServerless,
  projectRoot,
  writableRoot,
  dataDir,
  uploadsDir,
  attachmentsDir,
};
