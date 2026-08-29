import { dedent, tool } from '@livekit/agents';
import { z } from 'zod';
import { isWorkEmail } from './email.ts';

// Notifies the support team on Slack once a visitor has provided everything needed to book a
// demo. Fire-and-forget: the webhook call doesn't block the voice response.
export const notifySupportTeam = tool({
  name: 'notifySupportTeam',
  description: dedent`
    Use this tool to notify the support team that a client wants to book a demo.
    Only call it with values the visitor actually said, never a guessed or placeholder
    email — if you don't have a real work email from the visitor yet, ask for it first.

    The visitor's work email is required. Company name and service interest are helpful
    but optional — include them if the visitor provided them, otherwise omit them.

    Only work email addresses are accepted, not personal ones (e.g. gmail.com, yahoo.com,
    outlook.com, hotmail.com, icloud.com). If this tool reports the email was rejected,
    tell the visitor only work emails are accepted and ask them to provide one instead.
  `,
  parameters: z.object({
    // .nullish() (not .optional()) because some models send an explicit `null` for an
    // unset field instead of omitting the key, which .optional() alone rejects.
    companyName: z.string().nullish().describe("The visitor's company name, if provided."),
    serviceInterest: z
      .string()
      .nullish()
      .describe('The training program the visitor is interested in, if provided.'),
    workEmail: z.string().email().describe("The visitor's work email address. Required."),
  }),
  execute: async ({ companyName, serviceInterest, workEmail }) => {
    if (!isWorkEmail(workEmail)) {
      return 'Rejected: that is a personal email address. Only work email addresses are accepted — ask the visitor for their work email instead.';
    }

    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error('SLACK_WEBHOOK_URL is not set; skipping Slack notification.');
      return 'success';
    }

    const lines = [
      'New demo request',
      `Work email: ${workEmail}`,
      companyName ? `Company: ${companyName}` : null,
      serviceInterest ? `Interested in: ${serviceInterest}` : null,
    ].filter((line): line is string => line !== null);

    void fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
    }).catch((err: unknown) => {
      console.error('Failed to notify Slack:', err);
    });

    return 'success';
  },
});
