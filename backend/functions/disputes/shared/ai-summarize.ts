import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'eu-west-3' });

interface SummaryContext {
  disputeId: string;
  listingAddress: string;
  startTime: string;
  endTime: string;
  hostDisplayName: string;
  guestDisplayName: string;
  chatHistory: Array<{ senderRole: string; text: string }>;
}

export async function generateEscalationSummary(ctx: SummaryContext): Promise<string | null> {
  const summaryPrompt = `You are summarising a parking dispute for a human support agent.

Dispute ID: ${ctx.disputeId}
Booking: ${ctx.listingAddress}, ${ctx.startTime} to ${ctx.endTime}
Host: ${ctx.hostDisplayName} | Guest: ${ctx.guestDisplayName}

Dispute chat history:
${ctx.chatHistory.map((m) => `[${m.senderRole}] ${m.text}`).join('\n')}

Write a concise paragraph (max 100 words) explaining:
1. What the dispute is about
2. What resolution the bot attempted
3. Why human intervention is needed
4. What outcome the parties expect

Be factual and neutral. Do not recommend a resolution.`;

  const response = await bedrock.send(new ConverseCommand({
    modelId: 'eu.anthropic.claude-sonnet-4-6',
    system: [{ text: 'You are a factual dispute summariser for Spotzy customer support.' }],
    messages: [{ role: 'user', content: [{ text: summaryPrompt }] }],
    inferenceConfig: { maxTokens: 200, temperature: 1.3 },
  }));

  const text = response.output?.message?.content?.[0]?.text;
  return text ?? null;
}
