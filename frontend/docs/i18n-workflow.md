# Spotzy i18n Workflow

## For the founder (daily use)

### Adding a new UI string
1. Add the English string to `src/locales/en/{namespace}.yaml`
2. Run `npm run i18n:translate` to auto-fill fr-BE and nl-BE
3. Review the generated translations
4. Commit all three files

### Retranslating everything
```bash
npm run i18n:translate -- --retranslate
```
Cost: ~$7 for the full v2.x catalog.

### Running linters
```bash
npm run lint:i18n          # Check for missing/extra keys, parameter mismatches
npm run lint:legal-docs    # Check legal document section parity
```

### Updating a legal document
1. Edit the English source: `public/legal/{document}.en.md`
2. Run: `npm run i18n:translate-legal -- --document={document}`
3. Review the generated fr-BE and nl-BE versions
4. Update the `reviewed: true` front matter
5. Commit

## For non-technical reviewers (GitHub web UI)

### Editing a translation
1. Navigate to `frontend/src/locales/{locale}/{namespace}.yaml`
2. Click the pencil icon to edit
3. Find the key you want to change
4. Edit the value (keep quotes if the original had them)
5. Commit with message: "fix: update {locale} translation for {key}"

### Common YAML errors
- **Missing quotes**: If a value contains `:` or `#`, wrap it in quotes
- **Wrong indentation**: Use 2 spaces, not tabs
- **Broken ICU syntax**: Don't change `{variable}` placeholders
