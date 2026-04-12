import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LocalizedEmailTemplate } from './constructs/localized-email-template';
import * as path from 'path';

export class EmailTemplatesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const EMAIL_FAMILIES = [
      'welcome-spotter', 'welcome-host', 'welcome-spot-manager',
      'email-verification', 'password-reset',
      'booking-confirmed', 'booking-reminder',
      'booking-cancelled-by-host', 'booking-cancelled-by-spotter', 'booking-completed',
      'review-request', 'dispute-opened', 'dispute-resolved', 'payout-sent',
      'rc-submission-confirmation', 'rc-submission-approved', 'rc-submission-rejected',
      'rc-submission-clarification-requested',
      'rc-expiry-reminder-30d', 'rc-expiry-reminder-7d', 'rc-expiry-suspended',
      'bay-swap-notification',
      'block-confirmation', 'block-magic-link', 'block-auth-success', 'block-auth-failed',
      'block-auto-cancelled', 'block-cancellation-receipt', 'block-settlement',
    ];

    for (const family of EMAIL_FAMILIES) {
      new LocalizedEmailTemplate(this, `EmailTemplate-${family}`, {
        family,
        templatesDir: path.join(__dirname, `../email-templates/${family}`),
      });
    }
  }
}
