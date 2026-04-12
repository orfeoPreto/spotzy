import { Construct } from 'constructs';
import * as ses from 'aws-cdk-lib/aws-ses';
import { readFileSync } from 'fs';
import { join } from 'path';

const SUPPORTED_LOCALES = ['en', 'fr-BE', 'nl-BE'] as const;

export interface LocalizedEmailTemplateProps {
  family: string;
  templatesDir: string;
}

/**
 * CDK construct that creates one SES template per supported locale.
 *
 * Reads HTML and text content from `{templatesDir}/{family}.{locale}.html`
 * and `{templatesDir}/{family}.{locale}.txt`, plus a subject line from
 * `{templatesDir}/{family}.{locale}.subject.txt`.
 *
 * Emits one CfnTemplate per locale, named `{family}-{locale}`.
 */
export class LocalizedEmailTemplate extends Construct {
  constructor(scope: Construct, id: string, props: LocalizedEmailTemplateProps) {
    super(scope, id);

    for (const locale of SUPPORTED_LOCALES) {
      const html = this.tryReadFile(join(props.templatesDir, `${props.family}.${locale}.html`));
      const text = this.tryReadFile(join(props.templatesDir, `${props.family}.${locale}.txt`));
      const subject = this.tryReadFile(join(props.templatesDir, `${props.family}.${locale}.subject.txt`));

      if (!html || !text || !subject) {
        throw new Error(
          `LocalizedEmailTemplate: missing template files for ${props.family}-${locale}. ` +
          `Expected: ${props.family}.${locale}.{html,txt,subject.txt} in ${props.templatesDir}`,
        );
      }

      new ses.CfnTemplate(this, `Template-${locale}`, {
        template: {
          templateName: `${props.family}-${locale}`,
          subjectPart: subject.trim(),
          htmlPart: html,
          textPart: text,
        },
      });
    }
  }

  private tryReadFile(path: string): string | null {
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      return null;
    }
  }
}
