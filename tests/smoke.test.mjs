import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const startedAt = performance.now();
const passed = [];
const warnings = [];
const failures = [];

function fromRoot(...parts) {
  return path.join(root, ...parts);
}

function readText(relativePath) {
  return fs.readFileSync(fromRoot(relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function exists(relativePath) {
  return fs.existsSync(fromRoot(relativePath));
}

function pass(label) {
  passed.push(label);
}

function warn(label) {
  warnings.push(label);
}

function fail(label) {
  failures.push(label);
}

function check(label, condition, details = "") {
  if (condition) {
    pass(label);
  } else {
    fail(details ? `${label} (${details})` : label);
  }
}

function includesAll(source, tokens) {
  return tokens.every((token) => source.includes(token));
}

function syntaxCheckFile(relativePath) {
  const result = spawnSync(process.execPath, ["--check", fromRoot(relativePath)], {
    cwd: root,
    encoding: "utf8"
  });
  check(
    `${relativePath} has valid JavaScript syntax`,
    result.status === 0,
    (result.stderr || result.stdout || "").trim()
  );
}

function compileInlineScripts(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]))
    .map((match) => ({ attrs: match[1], code: match[2].trim() }))
    .filter((script) => script.code);

  check("index.html contains startup JavaScript", scripts.length > 0);

  scripts.forEach(({ attrs, code }, index) => {
    const isModule = /type=["']module["']/i.test(attrs);
    try {
      // Parse only. The app code is not executed and no browser/Firebase call is made.
      if (isModule) new Function(`return (async () => {\n${code}\n});`);
      else new Function(code);
      pass(`index.html inline script #${index + 1} parses`);
    } catch (error) {
      fail(`index.html inline script #${index + 1} has a blocking syntax error: ${error.message}`);
    }
  });
}

function checkCriticalFiles() {
  ["index.html", "manifest.json", "service-worker.js", "version.json"].forEach((file) => {
    check(`${file} exists`, exists(file));
  });

  [
    "firebase-config.js",
    "data/products-fallback.json",
    "data/parts-fallback.json",
    "images/manifest.json"
  ].forEach((file) => {
    check(`${file} exists`, exists(file));
  });
}

function checkViews(html) {
  const requiredViews = [
    ["homeView", "Accueil"],
    ["collectionView", "Collection"],
    ["missingView", "Manquants"],
    ["statsView", "Statistiques"],
    ["settingsView", "Parametres"],
    ["adminView", "Admin"]
  ];

  requiredViews.forEach(([id, label]) => {
    check(`view ${label} exists`, html.includes(`id="${id}"`));
  });

  ["Collection", "Manquants", "Statistiques", "Paramètres", "Admin"].forEach((label) => {
    check(`label ${label} is present`, html.includes(label));
  });
}

function checkPwa(html, serviceWorker) {
  const manifest = readJson("manifest.json");
  const version = readJson("version.json");
  const appVersion = serviceWorker.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];

  check("index.html links the manifest", html.includes('rel="manifest"') && html.includes("./manifest.json"));
  check("manifest has install display mode", ["standalone", "fullscreen", "minimal-ui"].includes(manifest.display));
  check("manifest declares app icons", icons.length > 0);
  check("manifest has a 192px icon", icons.some((icon) => String(icon.sizes || "").includes("192x192")));
  check("manifest has a 512px icon", icons.some((icon) => String(icon.sizes || "").includes("512x512")));

  const missingIcons = icons
    .map((icon) => String(icon.src || "").replace(/^\.\//, ""))
    .filter((src) => src && !exists(src));
  check("all manifest icons exist on disk", missingIcons.length === 0, missingIcons.join(", "));

  check("service worker calls skipWaiting", serviceWorker.includes("skipWaiting()"));
  check("service worker claims clients", serviceWorker.includes("clients.claim()"));
  check("service worker has network-first strategy", serviceWorker.includes("networkFirst"));
  check("service worker has cache-first strategy", serviceWorker.includes("cacheFirst"));
  check("version.json has a version", typeof version.version === "string" && version.version.length > 0);
  check("service worker version matches version.json", appVersion === version.version, `${appVersion} !== ${version.version}`);

  if (String(manifest.name || "").includes("Beyblade X")) {
    warn("manifest name still mentions Beyblade X while the app is becoming multi-generation");
  }
}

function checkFirebase(html) {
  const firebaseConfig = readText("firebase-config.js");

  check("firebase-config exports firebaseConfig", firebaseConfig.includes("firebaseConfig"));
  check("firebase config contains required keys", includesAll(firebaseConfig, ["apiKey", "authDomain", "projectId", "appId"]));
  check("Firebase app SDK is imported", html.includes("firebase-app.js") && html.includes("initializeApp"));
  check("Firebase Auth SDK is imported", html.includes("firebase-auth.js") && html.includes("getAuth"));
  check(
    "email/password auth handlers are present",
    includesAll(html, [
      "createUserWithEmailAndPassword",
      "signInWithEmailAndPassword",
      "sendPasswordResetEmail",
      "signOut"
    ])
  );
  check("Firebase Analytics is optional and isolated", html.includes("firebase-analytics.js") && html.includes("getAnalytics") && html.includes("logEvent"));
  check("Firebase Auth failure keeps app usable", html.includes("Firebase Auth indisponible"));
}

function checkFirestoreAndFallback(html) {
  const productsData = readJson("data/products-fallback.json");
  const partsData = readJson("data/parts-fallback.json");
  const products = Array.isArray(productsData) ? productsData : productsData.products || [];
  const parts = Array.isArray(partsData) ? partsData : partsData.parts || [];

  check("products fallback contains products", products.length > 0);
  check("parts fallback contains parts", parts.length > 0);
  check("Firestore SDK is imported", html.includes("firebase-firestore.js"));
  check("products Firestore loader exists", html.includes("bladeLoadFirestoreProducts"));
  check("parts Firestore loader exists", html.includes("bladeLoadFirestoreParts"));
  check("fallback products are loaded at startup", html.includes("loadFallbackProducts();"));
  check("fallback parts are loaded at startup", html.includes("loadFallbackParts();"));
  check("Firestore/fallback merge is present", html.includes("mergeFirestoreWithFallback"));
  check("Firestore unavailable keeps fallback", html.includes("fallback conservé") || html.includes("fallback conserve"));
}

function checkImageManifest() {
  const manifest = readJson("images/manifest.json");
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const missing = files.filter((file) => !exists(path.join("images", file)));

  check("image manifest has files", files.length > 0);
  check("image manifest entries exist on disk", missing.length === 0, missing.slice(0, 8).join(", "));
}

function printReport() {
  const elapsed = Math.round(performance.now() - startedAt);

  console.log("\nBladeBase automated test report");
  console.log(`Temps d'execution: ${elapsed} ms`);
  console.log(`\n✅ Tests reussis (${passed.length})`);
  passed.forEach((item) => console.log(`  - ${item}`));

  console.log(`\n⚠️ Avertissements (${warnings.length})`);
  if (warnings.length) warnings.forEach((item) => console.log(`  - ${item}`));
  else console.log("  - Aucun avertissement");

  console.log(`\n❌ Echecs (${failures.length})`);
  if (failures.length) failures.forEach((item) => console.log(`  - ${item}`));
  else console.log("  - Aucun echec");

  if (elapsed > 10_000) {
    fail(`test suite is slower than expected (${elapsed} ms)`);
  }
}

checkCriticalFiles();

const html = readText("index.html");
const serviceWorker = readText("service-worker.js");

compileInlineScripts(html);
syntaxCheckFile("service-worker.js");
syntaxCheckFile("firebase-config.js");
syntaxCheckFile("scripts/import-products-firestore.mjs");
syntaxCheckFile("scripts/import-parts-firestore.mjs");

checkViews(html);
checkPwa(html, serviceWorker);
checkFirebase(html);
checkFirestoreAndFallback(html);
checkImageManifest();

printReport();

if (failures.length > 0) {
  process.exitCode = 1;
}
