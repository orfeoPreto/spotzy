#!/usr/bin/env npx ts-node
/**
 * customise.ts — Friendly Tester Pack Generator
 *
 * Usage:
 *   npm run friendly-pack:build "Marie Dubois" spotter fr-BE
 *   npm run friendly-pack:build "Jan Janssen" host nl-BE
 *
 * Environment variables:
 *   FRIENDLY_DEFECT_FORM_URL       URL of the Google Form (required)
 *   FRIENDLY_CONTACT_EMAIL         Team contact email (required)
 *   FRIENDLY_TESTER_CREDIT_AMOUNT  Credit amount in EUR (default: 30)
 *
 * Reads:  scripts/uat-manifest.json          (produced by seed:uat)
 * Writes: scripts/uat-friendly-assignments.json
 *         outputs/friendly-pack-{testerSlug}/
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UatAccount {
  accountId: string;
  persona: "spotter" | "host";
  locale: string;
  email: string;
  password: string;
}

interface UatManifest {
  accounts: UatAccount[];
}

interface Assignment {
  testerName: string;
  testerSlug: string;
  accountId: string;
  persona: string;
  locale: string;
  assignedAt: string;
}

interface AssignmentStore {
  assignments: Assignment[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveRepoRoot(): string {
  // This file lives at docs/uat/friendly-testers/customise.ts
  // Repo root is three levels up.
  return path.resolve(__dirname, "../../..");
}

function readJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function readTemplate(templatePath: string): string {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  return fs.readFileSync(templatePath, "utf-8");
}

function fillPlaceholders(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    // Support both {{key}} and {key} forms so the templates work either way.
    result = result.replaceAll(`{{${key}}}`, value);
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error(
      'Usage: npx ts-node customise.ts "<Tester Name>" <persona> <locale>'
    );
    console.error('Example: npx ts-node customise.ts "Marie Dubois" spotter fr-BE');
    process.exit(1);
  }

  const [testerName, personaRaw, locale] = args;
  const persona = personaRaw.toLowerCase() as "spotter" | "host";

  if (!["spotter", "host"].includes(persona)) {
    console.error(`Invalid persona "${persona}". Must be "spotter" or "host".`);
    process.exit(1);
  }

  // Env vars
  const defectFormUrl =
    process.env.FRIENDLY_DEFECT_FORM_URL ?? "{{FRIENDLY_DEFECT_FORM_URL — set this env var}}";
  const contactEmail =
    process.env.FRIENDLY_CONTACT_EMAIL ?? "hello@spotzy.be";
  const creditAmount =
    process.env.FRIENDLY_TESTER_CREDIT_AMOUNT ?? "30";

  const repoRoot = resolveRepoRoot();
  const testerSlug = slugify(testerName);
  const packsDir = path.join(repoRoot, "outputs", `friendly-pack-${testerSlug}`);
  const manifestPath = path.join(repoRoot, "scripts", "uat-manifest.json");
  const assignmentsPath = path.join(
    repoRoot,
    "scripts",
    "uat-friendly-assignments.json"
  );
  const templateBase = path.join(repoRoot, "docs", "uat", "friendly-testers");

  // Load manifest
  let manifest: UatManifest;
  try {
    manifest = readJson<UatManifest>(manifestPath);
  } catch {
    console.error(
      `Could not read UAT manifest at ${manifestPath}.\n` +
        "Run 'npm run seed:uat' first to generate the manifest."
    );
    process.exit(1);
  }

  // Load or initialise assignment store
  let store: AssignmentStore = { assignments: [] };
  if (fs.existsSync(assignmentsPath)) {
    store = readJson<AssignmentStore>(assignmentsPath);
  }

  // Check for existing assignment (idempotent)
  const existing = store.assignments.find(
    (a) => a.testerSlug === testerSlug
  );

  let account: UatAccount;

  if (existing) {
    console.log(
      `Reusing existing assignment for "${testerName}": account ${existing.accountId}`
    );
    const found = manifest.accounts.find(
      (a) => a.accountId === existing.accountId
    );
    if (!found) {
      console.error(
        `Assignment references account ${existing.accountId} but it was not found in the manifest. ` +
          "Re-seed or fix uat-friendly-assignments.json manually."
      );
      process.exit(1);
    }
    account = found;
  } else {
    // Find an unassigned account matching persona + locale
    const assignedIds = new Set(store.assignments.map((a) => a.accountId));
    const available = manifest.accounts.filter(
      (a) =>
        a.persona === persona &&
        a.locale === locale &&
        !assignedIds.has(a.accountId)
    );

    if (available.length === 0) {
      console.error(
        `No unassigned ${persona} / ${locale} accounts available — re-seed or assign manually.`
      );
      process.exit(1);
    }

    account = available[0];

    // Record assignment
    store.assignments.push({
      testerName,
      testerSlug,
      accountId: account.accountId,
      persona,
      locale,
      assignedAt: new Date().toISOString(),
    });
    writeJson(assignmentsPath, store);
    console.log(
      `Assigned account ${account.accountId} (${account.email}) to "${testerName}".`
    );
  }

  // Resolve the staging URL — honour env var override, else default to production staging
  const loginUrl =
    process.env.FRIENDLY_LOGIN_URL ?? "https://staging.spotzy.be";

  // Placeholder map
  const placeholders: Record<string, string> = {
    testerName,
    accountEmail: account.email,
    accountPassword: account.password,
    loginUrl,
    stripeTestCard: "4242 4242 4242 4242",
    stripeTestIban: "BE71 0961 2345 6769",
    defectFormUrl,
    contactEmail,
    creditAmount,
  };

  // Build output directory
  fs.mkdirSync(packsDir, { recursive: true });

  // Helper to render a template file to the output directory
  function renderTemplate(
    srcRelPath: string,
    destFileName: string
  ): void {
    const srcPath = path.join(templateBase, srcRelPath);
    const raw = readTemplate(srcPath);
    const rendered = fillPlaceholders(raw, placeholders);
    const destPath = path.join(packsDir, destFileName);
    fs.writeFileSync(destPath, rendered, "utf-8");
  }

  // Invitation email
  renderTemplate(
    `invitation-email/invitation.${locale}.md`,
    "invitation-email.md"
  );

  // Runbook
  renderTemplate(
    `runbooks/${persona}/runbook-${persona}.${locale}.md`,
    "runbook.md"
  );

  // Defect form
  renderTemplate(
    `defect-form/defect-form-template.${locale}.md`,
    "defect-form-template.md"
  );

  // Generated README for the tester's pack folder
  const personaLabel =
    persona === "host"
      ? locale === "fr-BE"
        ? "hôte"
        : locale === "nl-BE"
        ? "verhuurder"
        : "Host"
      : "Spotter";

  const readmeContent = [
    `# Spotzy — Pack de test pour ${testerName}`,
    "",
    `**Persona:** ${personaLabel}`,
    `**Langue / Locale:** ${locale}`,
    `**Compte de test:** ${account.email}`,
    `**Généré le:** ${new Date().toISOString()}`,
    "",
    "## Fichiers dans ce dossier",
    "",
    "| Fichier | Contenu |",
    "|---------|---------|",
    "| `invitation-email.md` | E-mail d'invitation à envoyer au testeur |",
    "| `runbook.md` | Guide de test d'une page |",
    "| `defect-form-template.md` | Modèle de formulaire de signalement |",
    "",
    "## Instructions",
    "",
    "1. Ouvrez `invitation-email.md` et copiez le contenu dans un e-mail.",
    "2. Joignez ou collez le contenu de `runbook.md` dans l'e-mail ou un message de suivi.",
    "3. Partagez le lien du formulaire de signalement : " + defectFormUrl,
    "4. Les identifiants du compte sont déjà renseignés dans le guide.",
    "",
    "---",
    "",
    "_Généré par customise.ts — Spotzy UAT Pack_",
  ].join("\n");

  fs.writeFileSync(path.join(packsDir, "README.md"), readmeContent + "\n", "utf-8");

  console.log(`\nPack generated at: ${packsDir}`);
  console.log("  invitation-email.md");
  console.log("  runbook.md");
  console.log("  defect-form-template.md");
  console.log("  README.md");
}

main();
