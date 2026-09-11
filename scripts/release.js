import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const packageJsonPath = path.join(rootDir, "package.json");
const pyprojectTomlPath = path.join(rootDir, "pyproject.toml");
const pyInitPath = path.join(rootDir, "src", "sharedstate", "__init__.py");

function run(cmd) {
    console.log(`> ${cmd}`);
    execSync(cmd, { cwd: rootDir, stdio: "inherit" });
}

const args = process.argv.slice(2);
let targetVersion = args.find((arg) => !arg.startsWith("--"));
const isSyncOnly = args.includes("--sync-only");

if (!targetVersion) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    targetVersion = pkg.version;
}

if (targetVersion.startsWith("v")) {
    targetVersion = targetVersion.slice(1);
}

const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
if (!semverRegex.test(targetVersion)) {
    console.error(`Invalid version format: "${targetVersion}". Must be SemVer (e.g. 1.0.0 or 1.0.0-rc.1).`);
    process.exit(1);
}

console.log(`Preparing release for version v${targetVersion}...`);

// 1. Update package.json
const pkgJsonRaw = fs.readFileSync(packageJsonPath, "utf-8");
const pkg = JSON.parse(pkgJsonRaw);
pkg.version = targetVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
console.log(`✓ Updated package.json version to ${targetVersion}`);

// 2. Update pyproject.toml
let pyproject = fs.readFileSync(pyprojectTomlPath, "utf-8");
pyproject = pyproject.replace(/^version\s*=\s*"[^"]+"/m, `version = "${targetVersion}"`);
fs.writeFileSync(pyprojectTomlPath, pyproject, "utf-8");
console.log(`✓ Updated pyproject.toml version to ${targetVersion}`);

// 3. Update src/sharedstate/__init__.py
let pyInit = fs.readFileSync(pyInitPath, "utf-8");
pyInit = pyInit.replace(/^__version__\s*=\s*"[^"]+"/m, `__version__ = "${targetVersion}"`);
fs.writeFileSync(pyInitPath, pyInit, "utf-8");
console.log(`✓ Updated src/sharedstate/__init__.py __version__ to ${targetVersion}`);

// 4. Build JS client distribution bundles
console.log("Building JS client distribution bundles...");
run("npm run build");

// 5. Git commit & tag (unless --sync-only)
if (!isSyncOnly) {
    console.log("Staging release files...");
    run("git add package.json pyproject.toml src/sharedstate/__init__.py dist/");

    const commitMsg = `release: v${targetVersion}`;
    const tagName = `v${targetVersion}`;

    console.log(`Creating git commit and tag ${tagName}...`);
    try {
        run(`git commit -m "${commitMsg}"`);
    } catch (e) {
        console.log("Git commit warning: files might already be committed or no changes to commit.");
    }

    try {
        run(`git tag -a ${tagName} -m "Release ${tagName}"`);
        console.log(`✓ Created git tag ${tagName}`);
    } catch (e) {
        console.warn(`Warning: Could not create tag ${tagName} (it may already exist).`);
    }

    console.log("\n=======================================================");
    console.log(`🚀 Release v${targetVersion} prepared and tagged successfully!`);
    console.log("To publish to GitHub, run:");
    console.log("  git push origin main --tags");
    console.log("=======================================================\n");
}
