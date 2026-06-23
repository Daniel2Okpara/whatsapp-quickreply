const fs = require('fs');
const path = require('path');

// Extension files to include in Chrome Web Store package
const extensionFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'styles.css',
  'options.html',
  'options.js'
];

const extensionFolders = [
  'icons'
];

const distDir = path.join(__dirname, 'dist');

// Create dist directory if it doesn't exist
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
  console.log('Created dist directory');
}

// Copy individual files
extensionFiles.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(distDir, file);
  
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${file}`);
  } else {
    console.warn(`Warning: ${file} not found`);
  }
});

// Copy folders
extensionFolders.forEach(folder => {
  const src = path.join(__dirname, folder);
  const dest = path.join(distDir, folder);
  
  if (fs.existsSync(src)) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    const files = fs.readdirSync(src);
    files.forEach(file => {
      const srcFile = path.join(src, file);
      const destFile = path.join(dest, file);
      fs.copyFileSync(srcFile, destFile);
    });
    console.log(`Copied folder: ${folder}/`);
  } else {
    console.warn(`Warning: ${folder}/ not found`);
  }
});

console.log('\n✅ Extension build complete!');
console.log(`📦 Package location: ${distDir}`);
console.log('\nFiles included in package:');
console.log('- manifest.json');
console.log('- background.js');
console.log('- content.js');
console.log('- styles.css');
console.log('- options.html');
console.log('- options.js');
console.log('- icons/');
console.log('\n⚠️  Backend files are NOT included (server.js, controllers, models, etc.)');
console.log('📤 Zip the "dist" folder for Chrome Web Store submission.');
